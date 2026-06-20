// The embedded on-device model — Sampatti's privacy/offline AI tier. Inference runs
// IN-PROCESS via llama.cpp (no second app, no localhost server); the model file is
// downloaded once from a pinned, sha256-verified HuggingFace URL into app-data and can be
// removed from the Privacy screen.
//
// Hard rule (see docs/local-ai.md + contracts): `local_generate` performs NO network I/O —
// the only networked function in this module is the explicit model download, which refuses
// anything but https://huggingface.co and the exact pinned digest.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::Manager;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;

// ---- the model registry (see docs/local-ai.md "Decisions log") ----------------
// On-device AI is a USER CHOICE among pinned models, not a single hard pin: each entry is
// downloaded on demand into app-data and verified against its exact sha256. Adding a model
// later is one more row here (+ its chat template) — no structural change. Every model must
// be Apache/permissively licensed and hosted on huggingface.co (allowed_model_url enforces
// the host; the sha256 enforces the bytes).

// Each model family wraps a single user turn differently — the wrong delimiters yield garbage,
// so the template travels WITH the model, never assumed. Verified against each GGUF's embedded
// tokenizer.chat_template.
#[derive(Clone, Copy, PartialEq)]
pub enum ChatTemplate {
    Gemma4,
    Qwen3,
}

// Build the single-turn prompt for `model`. `json_mode` output is further constrained by the
// JSON grammar downstream, so it needs no think-suppression; text mode prefills an empty
// reasoning block to stop a thinking model from spending the whole budget on raw reasoning
// before any answer (caught by the Phase-2 quick-take probe).
fn wrap_prompt(t: ChatTemplate, prompt: &str, json_mode: bool) -> String {
    match t {
        // Gemma 4: <bos> is added by the tokenizer (AddBos::Always). Turn tokens are the
        // model's real `<|turn>…<turn|>` / `<|turn>model`; thinking is off by default, so text
        // mode opens+closes an empty `<|channel>thought` to keep it that way.
        ChatTemplate::Gemma4 => {
            if json_mode {
                format!("<|turn>user\n{prompt}<turn|>\n<|turn>model\n")
            } else {
                format!("<|turn>user\n{prompt}<turn|>\n<|turn>model\n<|channel>thought\n\n<channel|>\n\n")
            }
        }
        // Qwen3: ChatML turn tokens; text mode prefills an EMPTY <think> block (Qwen3 is a
        // thinking model and otherwise reasons until the budget is gone).
        ChatTemplate::Qwen3 => {
            if json_mode {
                format!("<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n")
            } else {
                format!("<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")
            }
        }
    }
}

pub struct Model {
    pub id: &'static str,           // stable key persisted in settings + passed from the UI
    pub display_name: &'static str,
    pub file: &'static str,         // filename in <appdata>/models/
    pub url: &'static str,          // huggingface.co https URL (host re-checked at download)
    pub sha256: &'static str,       // exact digest of the full file
    pub bytes: u64,
    pub license: &'static str,
    pub template: ChatTemplate,
}

pub const MODELS: &[Model] = &[
    Model {
        id: "gemma-4-e4b",
        display_name: "Gemma 4 E4B",
        file: "gemma-4-E4B-it-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        sha256: "519b9793ed6ce0ff530f1b7c96e848e08e49e7af4d57bb97f76215963a54146d",
        bytes: 4_977_169_568,
        license: "Apache-2.0",
        template: ChatTemplate::Gemma4,
    },
    Model {
        id: "qwen3-4b",
        display_name: "Qwen3-4B",
        file: "Qwen3-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        bytes: 2_497_280_256,
        license: "Apache-2.0",
        template: ChatTemplate::Qwen3,
    },
];

// The model selected when settings carry none (first run / older save files).
pub const DEFAULT_MODEL_ID: &str = "gemma-4-e4b";

fn model_by_id(id: &str) -> Result<&'static Model, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("unknown on-device model id: {id}"))
}

// Resolve a template from a .gguf path by matching its filename against the registry — lets
// the eval driver run any registered model through the exact shipping prompt path. Unknown
// files fall back to Gemma 4 (the default pin).
pub fn template_for_path(path: &std::path::Path) -> ChatTemplate {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    MODELS
        .iter()
        .find(|m| m.file == name)
        .map(|m| m.template)
        .unwrap_or(ChatTemplate::Gemma4)
}

// Downloads may come ONLY from the pinned host over https.
pub fn allowed_model_url(u: &str) -> bool {
    match reqwest::Url::parse(u) {
        Ok(url) => url.scheme() == "https" && url.host_str() == Some("huggingface.co"),
        Err(_) => false,
    }
}

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn model_path(app: &tauri::AppHandle, model: &Model) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(model.file))
}

pub fn sha256_of_file(path: &std::path::Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(serde::Serialize)]
pub struct ModelInfo {
    id: String,
    display_name: String,
    state: String, // "absent" | "partial" | "ready"
    size_bytes: u64,
    expected_bytes: u64,
    license: String,
}

fn model_info(app: &tauri::AppHandle, model: &Model) -> Result<ModelInfo, String> {
    let path = model_path(app, model)?;
    let part = path.with_extension("gguf.part");
    let (state, size) = if path.exists() {
        ("ready", std::fs::metadata(&path).map_err(|e| e.to_string())?.len())
    } else if part.exists() {
        ("partial", std::fs::metadata(&part).map_err(|e| e.to_string())?.len())
    } else {
        ("absent", 0)
    };
    Ok(ModelInfo {
        id: model.id.into(),
        display_name: model.display_name.into(),
        state: state.into(),
        size_bytes: size,
        expected_bytes: model.bytes,
        license: model.license.into(),
    })
}

// The whole registry plus each model's on-disk state — one call drives the Settings picker.
#[tauri::command]
pub fn local_models_list(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    MODELS.iter().map(|m| model_info(&app, m)).collect()
}

#[tauri::command]
pub fn local_model_remove(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let model = model_by_id(&model_id)?;
    let path = model_path(&app, model)?;
    let part = path.with_extension("gguf.part");
    for p in [path, part] {
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    // Drop any loaded context so the memory is released too.
    *engine_guard() = None;
    Ok(())
}

// Download with resume + integrity: stream into MODEL.gguf.part (Range-resumed when bytes
// already exist), then verify the FULL file's sha256 against the pin before renaming into
// place. A wrong hash deletes the file — never leaves an unverified model on disk.
#[tauri::command]
pub async fn local_model_download(app: tauri::AppHandle, model_id: String, on_progress: Channel<serde_json::Value>) -> Result<(), String> {
    let model = model_by_id(&model_id)?;
    if !allowed_model_url(model.url) {
        return Err("model URL pin is invalid".into());
    }
    let path = model_path(&app, model)?;
    if path.exists() {
        return Ok(()); // already there
    }
    let part = path.with_extension("gguf.part");
    let existing = if part.exists() {
        std::fs::metadata(&part).map_err(|e| e.to_string())?.len()
    } else {
        0
    };

    if existing < model.bytes {
        let client = reqwest::Client::new();
        let mut req = client.get(model.url);
        if existing > 0 {
            req = req.header("Range", format!("bytes={existing}-"));
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if resp.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = std::fs::remove_file(&part);
            return Err("local partial download size mismatch (HTTP 416) — deleted; please retry".into());
        }
        if !resp.status().is_success() {
            return Err(format!("model download failed: HTTP {}", resp.status()));
        }
        let resumed = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(resumed)
            .write(true)
            .truncate(!resumed)
            .open(&part)
            .map_err(|e| e.to_string())?;
        let mut received = if resumed { existing } else { 0 };

        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            received += bytes.len() as u64;
            if last_emit.elapsed().as_millis() > 250 {
                last_emit = std::time::Instant::now();
                let _ = on_progress.send(serde_json::json!({ "received": received, "total": model.bytes }));
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
    }

    let digest = sha256_of_file(&part)?;
    if digest != model.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("downloaded model failed integrity verification — removed; please retry".into());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    let _ = on_progress.send(serde_json::json!({ "received": model.bytes, "total": model.bytes }));
    Ok(())
}

// ---- inference ----------------------------------------------------------------

// llama.cpp's canonical JSON grammar (GBNF): generation is hard-constrained to emit valid
// JSON, which the existing extractJson/validateDrafts pipeline then shapes and verifies.
pub const JSON_GBNF: &str = r#"
root   ::= object
value  ::= object | array | string | number | ("true" | "false" | "null") ws
object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws
array  ::= "[" ws ( value ("," ws value)* )? "]" ws
string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4}) )* "\"" ws
number ::= ("-"? ([0-9] | [1-9] [0-9]{0,15})) ("." [0-9]+)? ([eE] [-+]? [0-9] [1-9]{0,15})? ws
ws     ::= | " " | "\n" [ \t]{0,20}
"#;

struct Engine {
    backend: LlamaBackend,
    model: LlamaModel,
    path: PathBuf,
}

// One loaded model per process; loading takes seconds and ~3GB RAM, so cache it. Keyed by
// path so the eval harness can swap candidate models within one process.
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

// Lock the engine, tolerating poisoning: if a generation thread ever panicked mid-inference it
// would poison the mutex, and a plain .unwrap() would then brick ALL on-device AI for the rest
// of the process. The cached model is just a perf optimization, so recovering the guard and
// carrying on (a later ensure_engine reloads if needed) is strictly better than bricking.
fn engine_guard() -> std::sync::MutexGuard<'static, Option<Engine>> {
    ENGINE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ensure_engine(path: &std::path::Path) -> Result<(), String> {
    let mut guard = engine_guard();
    if guard.as_ref().is_some_and(|e| e.path == path) {
        return Ok(());
    }
    if !path.exists() {
        return Err("Local model not downloaded — get it on the Privacy screen first.".into());
    }
    // The llama backend may only be initialized once per process — reuse it on model swap.
    let backend = match guard.take() {
        Some(e) => e.backend,
        None => LlamaBackend::init().map_err(|e| e.to_string())?,
    };
    let params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(&backend, path, &params).map_err(|e| e.to_string())?;
    *guard = Some(Engine { backend, model, path: path.to_path_buf() });
    Ok(())
}

// Drop the cached model/backend. Rust never drops statics, and ggml-metal's own static
// teardown aborts if model buffers are still alive at process exit — so short-lived
// callers (the eval binary) must unload explicitly before returning from main.
pub fn unload_engine() {
    *engine_guard() = None;
}

// The whole on-device generation path — shared verbatim by the `local_generate` command and
// the eval harness (examples/local_eval.rs), so what we evaluate IS what ships. Synchronous
// and CPU-heavy: callers run it off the async runtime. `on_piece` returns false to abort
// (e.g. the IPC channel died). NO network I/O anywhere below.
pub fn run_generate(
    model_file: &std::path::Path,
    template: ChatTemplate,
    prompt: &str,
    json_mode: bool,
    max_tokens: u32,
    on_piece: &mut dyn FnMut(String) -> bool,
) -> Result<(), String> {
    ensure_engine(model_file)?;
    let guard = engine_guard();
    let engine = guard.as_ref().ok_or("engine not loaded")?;
    let model = &engine.model;

    const N_CTX: u32 = 8192;
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(std::num::NonZeroU32::new(N_CTX));
    let mut ctx = model
        .new_context(&engine.backend, ctx_params)
        .map_err(|e| e.to_string())?;

    // Per-model chat template (the wrong delimiters yield garbage), built in wrap_prompt.
    let wrapped = wrap_prompt(template, prompt, json_mode);
    let tokens = model
        .str_to_token(&wrapped, AddBos::Always)
        .map_err(|e| e.to_string())?;

    // Leave room to answer: clamp generation into what's left of the window, and refuse
    // outright (a normal Err, surfaced in the UI) when the prompt alone nearly fills it.
    let budget = (N_CTX as usize).saturating_sub(tokens.len());
    if budget < 64 {
        return Err(format!(
            "Prompt too long for the on-device model ({} tokens of a {N_CTX}-token window). \
             Switch this task to Claude or shorten the conversation.",
            tokens.len()
        ));
    }
    let max_tokens = max_tokens.min(budget as u32);

    // Decode the prompt in chunks no larger than n_batch (llama.cpp default 2048):
    // llama_decode ABORTS the process on an oversized batch — the analysis prompt
    // (persona + brief + chat) crashed the app exactly there (SIGABRT inside
    // llama_context::decode, 2026-06-11). Only the final token requests logits.
    const CHUNK: usize = 1024;
    let mut batch = LlamaBatch::new(CHUNK, 1);
    let last_idx = tokens.len() - 1;
    for (ci, chunk) in tokens.chunks(CHUNK).enumerate() {
        batch.clear();
        for (j, tok) in chunk.iter().enumerate() {
            let pos = ci * CHUNK + j;
            batch
                .add(*tok, pos as i32, &[0], pos == last_idx)
                .map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
    }

    let mut sampler = if json_mode {
        let grammar = LlamaSampler::grammar(model, JSON_GBNF, "root")
            .map_err(|e| format!("grammar: {e}"))?;
        LlamaSampler::chain_simple([
            grammar,
            LlamaSampler::temp(0.2),
            LlamaSampler::dist(42),
        ])
    } else {
        LlamaSampler::chain_simple([LlamaSampler::temp(0.4), LlamaSampler::dist(42)])
    };

    let mut n_cur = tokens.len() as i32; // next position — NOT batch.n_tokens(), which is just the final chunk
    let mut produced = 0u32;
    loop {
        // NB: llama_sampler_sample applies the chain AND accepts the token into it — a
        // second accept() here double-advances the grammar and aborts the process the
        // moment the grammar completes (caught by the Phase-2 real-model eval).
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        if model.is_eog_token(token) || produced >= max_tokens {
            break;
        }
        let piece = model
            .token_to_str(token, Special::Tokenize)
            .unwrap_or_default();
        if !piece.is_empty() && !on_piece(piece) {
            break; // receiver gone — stop burning CPU
        }
        batch.clear();
        batch.add(token, n_cur, &[0], true).map_err(|e| e.to_string())?;
        n_cur += 1;
        produced += 1;
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Generate a completion on-device, streaming tokens over the channel. `json_mode` applies
// the JSON grammar so output is syntactically valid JSON by construction. NO network I/O.
#[tauri::command]
pub async fn local_generate(
    app: tauri::AppHandle,
    model_id: String,
    prompt: String,
    json_mode: bool,
    max_tokens: u32,
    on_token: Channel<String>,
) -> Result<(), String> {
    let model = model_by_id(&model_id)?;
    let path = model_path(&app, model)?;
    let template = model.template;
    // llama.cpp inference is CPU-heavy and synchronous; run it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        run_generate(&path, template, &prompt, json_mode, max_tokens, &mut |piece| {
            on_token.send(piece).is_ok()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_model_url_pin_is_https_huggingface_only() {
        for m in MODELS {
            assert!(allowed_model_url(m.url), "{} url must be allowed", m.id);
        }
        for bad in [
            "http://huggingface.co/x", // plaintext
            "https://evil.example/model.gguf",
            "https://huggingface.co.evil.example/m",
            "file:///tmp/model.gguf",
        ] {
            assert!(!allowed_model_url(bad), "{bad} must be rejected");
        }
    }

    #[test]
    fn registry_is_wellformed_and_default_exists() {
        assert!(model_by_id(DEFAULT_MODEL_ID).is_ok(), "default model id must resolve");
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{} sha256 must be 64 hex chars", m.id);
            assert!(m.bytes > 0, "{} bytes must be set", m.id);
            assert!(m.file.ends_with(".gguf"), "{} file must be a .gguf", m.id);
            // ids are the persisted key — they must be unique.
            assert_eq!(MODELS.iter().filter(|x| x.id == m.id).count(), 1, "{} id not unique", m.id);
        }
    }

    #[test]
    fn sha256_verification_works() {
        let tmp = std::env::temp_dir().join("sampatti-sha-test.bin");
        std::fs::write(&tmp, b"hello sampatti").unwrap();
        let d = sha256_of_file(&tmp).unwrap();
        std::fs::remove_file(&tmp).ok();
        assert_eq!(d, "7851b97c5022296193fa748a31c2463c5dfa98f38c10ee45a2051a06acdae2aa");
    }
}
