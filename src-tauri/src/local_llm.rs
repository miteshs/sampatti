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

// ---- the pinned model (see docs/local-ai.md "Decisions log") -----------------
pub const MODEL_FILE: &str = "gemma-4-E4B-it-Q4_K_M.gguf";
pub const MODEL_URL: &str = "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf";
pub const MODEL_SHA256: &str = "519b9793ed6ce0ff530f1b7c96e848e08e49e7af4d57bb97f76215963a54146d";
pub const MODEL_BYTES: u64 = 4_977_169_568;
pub const MODEL_LICENSE: &str = "Apache-2.0 (Gemma 4 E4B)";

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

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(MODEL_FILE))
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
pub struct ModelStatus {
    state: String, // "absent" | "partial" | "ready"
    size_bytes: u64,
    expected_bytes: u64,
    license: String,
}

#[tauri::command]
pub fn local_model_status(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    let path = model_path(&app)?;
    let part = path.with_extension("gguf.part");
    let (state, size) = if path.exists() {
        ("ready", std::fs::metadata(&path).map_err(|e| e.to_string())?.len())
    } else if part.exists() {
        ("partial", std::fs::metadata(&part).map_err(|e| e.to_string())?.len())
    } else {
        ("absent", 0)
    };
    Ok(ModelStatus {
        state: state.into(),
        size_bytes: size,
        expected_bytes: MODEL_BYTES,
        license: MODEL_LICENSE.into(),
    })
}

#[tauri::command]
pub fn local_model_remove(app: tauri::AppHandle) -> Result<(), String> {
    let path = model_path(&app)?;
    let part = path.with_extension("gguf.part");
    for p in [path, part] {
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    // Drop any loaded context so the memory is released too.
    *ENGINE.lock().unwrap() = None;
    Ok(())
}

// Download with resume + integrity: stream into MODEL.gguf.part (Range-resumed when bytes
// already exist), then verify the FULL file's sha256 against the pin before renaming into
// place. A wrong hash deletes the file — never leaves an unverified model on disk.
#[tauri::command]
pub async fn local_model_download(app: tauri::AppHandle, on_progress: Channel<serde_json::Value>) -> Result<(), String> {
    if !allowed_model_url(MODEL_URL) {
        return Err("model URL pin is invalid".into());
    }
    let path = model_path(&app)?;
    if path.exists() {
        return Ok(()); // already there
    }
    let part = path.with_extension("gguf.part");
    let existing = if part.exists() {
        std::fs::metadata(&part).map_err(|e| e.to_string())?.len()
    } else {
        0
    };

    if existing < MODEL_BYTES {
        let client = reqwest::Client::new();
        let mut req = client.get(MODEL_URL);
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
                let _ = on_progress.send(serde_json::json!({ "received": received, "total": MODEL_BYTES }));
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
    }

    let digest = sha256_of_file(&part)?;
    if digest != MODEL_SHA256 {
        let _ = std::fs::remove_file(&part);
        return Err("downloaded model failed integrity verification — removed; please retry".into());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    let _ = on_progress.send(serde_json::json!({ "received": MODEL_BYTES, "total": MODEL_BYTES }));
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

fn ensure_engine(path: &std::path::Path) -> Result<(), String> {
    let mut guard = ENGINE.lock().unwrap();
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
    *ENGINE.lock().unwrap() = None;
}

// The whole on-device generation path — shared verbatim by the `local_generate` command and
// the eval harness (examples/local_eval.rs), so what we evaluate IS what ships. Synchronous
// and CPU-heavy: callers run it off the async runtime. `on_piece` returns false to abort
// (e.g. the IPC channel died). NO network I/O anywhere below.
pub fn run_generate(
    model_file: &std::path::Path,
    prompt: &str,
    json_mode: bool,
    max_tokens: u32,
    on_piece: &mut dyn FnMut(String) -> bool,
) -> Result<(), String> {
    ensure_engine(model_file)?;
    let guard = ENGINE.lock().unwrap();
    let engine = guard.as_ref().ok_or("engine not loaded")?;
    let model = &engine.model;

    const N_CTX: u32 = 8192;
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(std::num::NonZeroU32::new(N_CTX));
    let mut ctx = model
        .new_context(&engine.backend, ctx_params)
        .map_err(|e| e.to_string())?;

    // Gemma 4 chat template, minimal single-turn form. In text mode, prefill an EMPTY thought
    // channel — Gemma 4 is a thinking model and otherwise burns the whole token budget on raw
    // reasoning before any answer (caught by the Phase-2 quick-take probe). JSON
    // mode needs no prefill: the grammar makes thought tokens illegal from the first token.
    let wrapped = if json_mode {
        format!("<|turn>user\n{prompt}<turn|>\n<|turn>model\n")
    } else {
        format!("<|turn>user\n{prompt}<turn|>\n<|turn>model\n<|channel>thought\n\n<channel|>\n\n")
    };
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
    prompt: String,
    json_mode: bool,
    max_tokens: u32,
    on_token: Channel<String>,
) -> Result<(), String> {
    let path = model_path(&app)?;
    // llama.cpp inference is CPU-heavy and synchronous; run it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        run_generate(&path, &prompt, json_mode, max_tokens, &mut |piece| {
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
    fn model_url_pin_is_https_huggingface_only() {
        assert!(allowed_model_url(MODEL_URL));
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
    fn sha256_verification_works_and_pin_is_wellformed() {
        assert_eq!(MODEL_SHA256.len(), 64);
        let tmp = std::env::temp_dir().join("sampatti-sha-test.bin");
        std::fs::write(&tmp, b"hello sampatti").unwrap();
        let d = sha256_of_file(&tmp).unwrap();
        std::fs::remove_file(&tmp).ok();
        assert_eq!(d, "7851b97c5022296193fa748a31c2463c5dfa98f38c10ee45a2051a06acdae2aa");
    }
}
