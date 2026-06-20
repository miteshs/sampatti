// Eval-only driver for the embedded engine (docs/local-ai.md Phase 2). Runs the SAME
// run_generate path the shipping app uses — so what we evaluate IS what ships — against an
// arbitrary local .gguf, reading the prompt from a file and writing the completion to
// stdout (timing to stderr). Dev tool only; never part of the app bundle; no network.
//
//   cargo run --release --example local_eval -- <model.gguf> <prompt-file> <json|text> <max-tokens>

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: local_eval <model.gguf> <prompt-file> <json|text> <max-tokens>");
        std::process::exit(2);
    }
    let model = std::path::PathBuf::from(&args[1]);
    let prompt = std::fs::read_to_string(&args[2]).expect("read prompt file");
    let json_mode = args[3] == "json";
    let max_tokens: u32 = args[4].parse().expect("max-tokens must be a number");

    let t0 = std::time::Instant::now();
    let mut pieces = 0u32;
    let mut stdout = std::io::stdout();
    // Pick the prompt template by matching the .gguf filename against the registry, so the
    // eval runs each model through the exact wrapping the app ships.
    let template = sampatti_lib::local_llm::template_for_path(&model);
    let result = sampatti_lib::local_llm::run_generate(&model, template, &prompt, json_mode, max_tokens, &mut |piece| {
        pieces += 1;
        stdout.write_all(piece.as_bytes()).is_ok() && stdout.flush().is_ok()
    });
    // Release the model BEFORE process teardown — ggml-metal's static destructors abort
    // when buffers are still alive at exit.
    sampatti_lib::local_llm::unload_engine();
    if let Err(e) = result {
        eprintln!("ERROR: {e}");
        std::process::exit(1);
    }
    eprintln!(
        "\n[local_eval] {pieces} pieces in {:.1}s ({:.1} tok/s)",
        t0.elapsed().as_secs_f32(),
        pieces as f32 / t0.elapsed().as_secs_f32().max(0.001),
    );
}
