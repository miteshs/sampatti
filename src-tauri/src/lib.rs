// The native layer. Two responsibilities the webview must NOT handle directly:
//  1. The bring-your-own Anthropic key — stored in the OS keychain, never in JS.
//  2. The call to Claude — made from here so the key never crosses into the web context.
//
// `claude_stream` streams Anthropic's SSE response back to the UI over a Channel, emitting
// only the text deltas (the same shape the web transport parses).

// Desktop only: the embedded llama.cpp engine is excluded from mobile builds (Cargo.toml
// target cfg). On iOS the on-device engine is gated off by the RAM floor (SPEC §6.10).
#[cfg(desktop)]
pub mod local_llm; // pub: examples/local_eval.rs drives the same inference path

use futures_util::StreamExt;
use serde_json::Value;
use tauri::ipc::Channel;

const KEY_SERVICE: &str = "sampatti";
const KEY_USER: &str = "anthropic-api-key";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, KEY_USER).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    entry()?.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_api_key() -> bool {
    entry().and_then(|e| e.get_password().map_err(|x| x.to_string())).is_ok()
}

#[tauri::command]
fn clear_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Truncate to at most `n` CHARS on a boundary — byte-slicing a String can panic mid-UTF-8
// (error bodies are attacker/upstream-controlled text, so this must never be able to panic).
fn truncate_chars(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

// The brief (and the app token, when present) travel to the relay URL, which is a user
// setting — require https so a tampered/social-engineered setting can't downgrade the
// transport to plaintext. Loopback http stays allowed for local relay development.
fn allowed_relay_url(u: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(u).map_err(|_| format!("Relay URL is not a valid URL: {u}"))?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if loopback => Ok(parsed),
        s => Err(format!("Relay URL must be https (got {s}://) — refusing to send the brief over plaintext.")),
    }
}

// Stream a Claude completion. `mode` is "relay" | "byo"; for "byo" we read the keychain.
#[tauri::command]
async fn claude_stream(
    req: Value,
    mode: String,
    relay_url: String,
    app_token: Option<String>,
    on_event: Channel<String>,
) -> Result<(), String> {
    let mut body = req.clone();
    body["stream"] = Value::Bool(true);

    let client = reqwest::Client::new();
    let builder = if mode == "byo" {
        let key = entry()?.get_password().map_err(|_| "No Anthropic key set in the keychain.".to_string())?;
        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
    } else {
        // Relay mode: include the shared app token when configured so the worker
        // (if it has APP_TOKEN set) accepts the request.
        let url = allowed_relay_url(&relay_url)?;
        let mut b = client.post(url).header("content-type", "application/json");
        if let Some(token) = app_token.as_deref().filter(|t| !t.is_empty()) {
            b = b.header("x-app-token", token);
        }
        b
    };

    let resp = builder.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Claude request failed ({code}). {}", truncate_chars(&text, 300)));
    }

    // Parse the SSE stream incrementally, emitting text_delta content.
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = buf.find("\n\n") {
            let event: String = buf.drain(..idx + 2).collect();
            for line in event.lines() {
                let data = match line.strip_prefix("data:") {
                    Some(d) => d.trim(),
                    None => continue,
                };
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    // Surface a mid-stream error instead of ending with a truncated reply.
                    if json["type"] == "error" {
                        let msg = json["error"]["message"].as_str().unwrap_or("unknown");
                        return Err(format!("Claude stream error: {msg}"));
                    }
                    if json["type"] == "content_block_delta" && json["delta"]["type"] == "text_delta" {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            on_event.send(text.to_string()).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// Public market-data fetch (live & historical prices) from an allow-listed set of hosts.
// Made from Rust so it isn't blocked by the webview's CORS/CSP. Only a ticker/ISIN/scheme
// code is ever sent — never the user's holdings. Returns the raw body for the JS to parse.
const MARKET_HOSTS: [&str; 5] = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "www.amfiindia.com",
    "portal.amfiindia.com",
    "api.mfapi.in",
];

// A plausible browser UA for the current platform (Yahoo throttles obviously non-browser agents).
const MARKET_UA: &str = if cfg!(target_os = "windows") {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sampatti"
} else if cfg!(target_os = "macos") {
    "Mozilla/5.0 (Macintosh) Sampatti"
} else {
    "Mozilla/5.0 (X11; Linux x86_64) Sampatti"
};

// https + allow-listed host, checked on the INITIAL url and on every redirect hop — an
// allow-listed host must never be able to bounce the request to plaintext or elsewhere.
fn allowed_market_url(u: &reqwest::Url) -> bool {
    u.scheme() == "https" && u.host_str().map(|h| MARKET_HOSTS.contains(&h)).unwrap_or(false)
}

#[tauri::command]
async fn market_fetch(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !allowed_market_url(&parsed) {
        return Err(format!(
            "blocked: only https GETs to allow-listed market-data hosts (got {})",
            parsed.host_str().unwrap_or("?")
        ));
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    let client = reqwest::Client::builder()
        .user_agent(MARKET_UA)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 4 || !allowed_market_url(attempt.url()) {
                attempt.stop() // surfaces as a non-success status below
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{host} returned {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn market_allowlist_accepts_each_host_https_only() {
        for h in MARKET_HOSTS {
            assert!(allowed_market_url(&url(&format!("https://{h}/any/path?q=1"))), "{h} should pass");
            assert!(!allowed_market_url(&url(&format!("http://{h}/any/path"))), "plain http must fail for {h}");
        }
    }

    // The exact bug this guards: error bodies are arbitrary UTF-8, and a multibyte char
    // straddling the old byte-300 cut made the command panic instead of reporting.
    #[test]
    fn truncate_chars_never_splits_a_codepoint() {
        let s = "₹".repeat(150); // 150 chars, 450 bytes — byte-300 lands mid-rupee
        assert_eq!(truncate_chars(&s, 300), s); // shorter than the cap → untouched
        let long = "₹".repeat(400);
        assert_eq!(truncate_chars(&long, 300).chars().count(), 300);
        assert_eq!(truncate_chars("plain ascii", 300), "plain ascii");
        assert_eq!(truncate_chars("", 300), "");
    }

    #[test]
    fn relay_url_requires_https_except_loopback() {
        assert!(allowed_relay_url("https://sampatti-relay.sampatti.workers.dev").is_ok());
        assert!(allowed_relay_url("https://my-own-relay.example.workers.dev/path").is_ok());
        assert!(allowed_relay_url("http://localhost:8787").is_ok()); // wrangler dev
        assert!(allowed_relay_url("http://127.0.0.1:8787").is_ok());
        for bad in [
            "http://evil.example/collect",       // plaintext to a remote host
            "ftp://relay.example",               // non-http scheme
            "file:///etc/passwd",                // local scheme
            "not a url",
        ] {
            assert!(allowed_relay_url(bad).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn market_allowlist_rejects_lookalikes_and_url_tricks() {
        for bad in [
            "https://evil.example/",
            "https://query1.finance.yahoo.com.evil.example/",  // allow-listed host as a subdomain of another
            "https://xquery1.finance.yahoo.com/",               // prefixed lookalike
            "https://query1.finance.yahoo.com@evil.example/",   // userinfo trick — real host is evil.example
            "ftp://query1.finance.yahoo.com/",                  // non-https scheme
            "https://api.mfapi.in.evil.example/x",
        ] {
            assert!(!allowed_market_url(&url(bad)), "{bad} must be rejected");
        }
    }

    // The BYO key must land in a REAL persistent OS store (macOS Keychain / Windows
    // Credential Manager). keyring v3 silently substitutes an in-memory mock when the
    // platform feature flag is missing — the mock reports EntryOnly persistence and the
    // saved key would die with the process (the regression this test exists to catch).
    #[test]
    fn keystore_backend_is_a_persistent_os_store() {
        use keyring::credential::CredentialPersistence;
        let p = keyring::default::default_credential_builder().persistence();
        assert!(
            matches!(p, CredentialPersistence::UntilDelete),
            "keyring default backend is not a persistent OS store — check the platform feature flags in Cargo.toml"
        );
    }

    // Round-trip through the real OS store, with a test-only service name so the app's
    // actual saved credential is never touched. Exercises Keychain on macOS and
    // Credential Manager on Windows (where it runs in CI).
    #[test]
    fn keystore_roundtrip_set_get_delete() {
        let e = keyring::Entry::new("sampatti-test", "roundtrip").expect("entry");
        e.set_password("s3cret-roundtrip").expect("set");
        // A FRESH entry must see the credential — the mock store fails exactly here.
        let e2 = keyring::Entry::new("sampatti-test", "roundtrip").expect("entry2");
        assert_eq!(e2.get_password().expect("get"), "s3cret-roundtrip");
        e2.delete_credential().expect("delete");
        assert!(matches!(e2.get_password(), Err(keyring::Error::NoEntry)));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // The on-device LLM commands exist only on desktop (Cargo.toml excludes llama.cpp on
    // mobile). Register the full handler set on desktop; the network/keystore-only set on
    // mobile. The keystore + Claude + market paths are identical on every platform.
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        set_api_key,
        has_api_key,
        clear_api_key,
        claude_stream,
        market_fetch,
        local_llm::local_model_status,
        local_llm::local_model_download,
        local_llm::local_model_remove,
        local_llm::local_generate
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        set_api_key,
        has_api_key,
        clear_api_key,
        claude_stream,
        market_fetch
    ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while running Sampatti")
        .run(|_app, event| {
            // Release the cached llama engine before process teardown: ggml-metal's static
            // destructors abort when model buffers are still alive at exit, which surfaces
            // as "Sampatti quit unexpectedly" after any on-device AI use. Desktop only.
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = event {
                local_llm::unload_engine();
            }
            #[cfg(mobile)]
            let _ = event;
        });
}
