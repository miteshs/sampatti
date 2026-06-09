// The native layer. Two responsibilities the webview must NOT handle directly:
//  1. The bring-your-own Anthropic key — stored in the OS keychain, never in JS.
//  2. The call to Claude — made from here so the key never crosses into the web context.
//
// `claude_stream` streams Anthropic's SSE response back to the UI over a Channel, emitting
// only the text deltas (the same shape the web transport parses).

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
        let mut b = client.post(&relay_url).header("content-type", "application/json");
        if let Some(token) = app_token.as_deref().filter(|t| !t.is_empty()) {
            b = b.header("x-app-token", token);
        }
        b
    };

    let resp = builder.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Claude request failed ({code}). {}", &text[..text.len().min(300)]));
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
        .user_agent("Mozilla/5.0 (Macintosh) Sampatti")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            has_api_key,
            clear_api_key,
            claude_stream,
            market_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sampatti");
}
