use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_millis(900);
const GATEWAY_PORT_SIGNAL_PREFIX: &str = "CYBARA_GATEWAY_PORT=";

#[derive(Clone)]
pub struct GatewayEndpoint {
    pub addr: String,
    pub url: String,
}

struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

impl GatewayEndpoint {
    pub fn loopback(port: u16) -> Self {
        Self {
            addr: format!("127.0.0.1:{port}"),
            url: format!("http://127.0.0.1:{port}"),
        }
    }
}

fn http_get(addr: &str, path: &str) -> Option<HttpResponse> {
    let mut stream = TcpStream::connect(addr).ok()?;
    stream.set_read_timeout(Some(PROBE_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(PROBE_TIMEOUT)).ok()?;
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nAccept: */*\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    let mut lines = head.lines();
    let status = lines.next()?.split_whitespace().nth(1)?.parse().ok()?;
    let headers = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    Some(HttpResponse {
        status,
        headers,
        body: body.to_string(),
    })
}

fn ui_response(addr: &str) -> Option<HttpResponse> {
    let response = http_get(addr, "/")?;
    if !(300..400).contains(&response.status) {
        return Some(response);
    }
    let location = response.headers.get("location")?;
    let path = if location.starts_with('/') {
        location.as_str()
    } else {
        return None;
    };
    http_get(addr, path)
}

pub fn is_compatible_gateway_at(addr: &str, expected_version: &str) -> bool {
    let Some(health) = http_get(addr, "/api/health") else {
        return false;
    };
    if health.status != 200 {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&health.body) else {
        return false;
    };
    if !matches!(
        value.get("status").and_then(serde_json::Value::as_str),
        Some("healthy" | "warning" | "critical")
    ) || value.get("version").and_then(serde_json::Value::as_str) != Some(expected_version)
    {
        return false;
    }
    let Some(ui) = ui_response(addr) else {
        return false;
    };
    if ui.status != 200 {
        return false;
    }
    let normalized = ui.body.to_ascii_lowercase();
    normalized.contains("<!doctype html")
        && normalized.contains("/assets/")
        && !normalized.contains("ui not built")
}

pub fn parse_gateway_port_signal(value: &str) -> Option<u16> {
    value
        .split(GATEWAY_PORT_SIGNAL_PREFIX)
        .skip(1)
        .find_map(|suffix| {
            let (port, _) = suffix.split_once(';')?;
            port.parse::<u16>().ok().filter(|value| *value > 0)
        })
}

#[derive(Default)]
pub struct GatewayPortSignalParser {
    buffer: String,
}

impl GatewayPortSignalParser {
    pub fn push(&mut self, value: &str) -> Option<u16> {
        self.buffer.push_str(value);
        if let Some(port) = parse_gateway_port_signal(&self.buffer) {
            self.buffer.clear();
            return Some(port);
        }
        if self.buffer.len() > 4096 {
            let suffix = self.buffer.chars().rev().take(256).collect::<String>();
            self.buffer = suffix.chars().rev().collect();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GatewayEndpoint, GatewayPortSignalParser, is_compatible_gateway_at,
        parse_gateway_port_signal,
    };
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn serve(responses: Vec<String>) -> (GatewayEndpoint, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test gateway");
        let port = listener.local_addr().expect("read gateway address").port();
        let handle = thread::spawn(move || {
            for body in responses {
                let (mut stream, _) = listener.accept().expect("accept test request");
                let mut request = [0; 1024];
                let _ = stream.read(&mut request);
                let content_type = if body.starts_with('{') {
                    "application/json"
                } else {
                    "text/html"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write test response");
            }
        });
        (GatewayEndpoint::loopback(port), handle)
    }

    #[test]
    fn accepts_matching_gateway_with_production_ui() {
        let (endpoint, handle) = serve(vec![
            r#"{"status":"healthy","version":"1.2.3"}"#.into(),
            r#"<!doctype html><html><script src="/assets/index.js"></script></html>"#.into(),
        ]);
        assert!(is_compatible_gateway_at(&endpoint.addr, "1.2.3"));
        handle.join().expect("join test gateway");
    }

    #[test]
    fn rejects_gateway_with_missing_ui_or_wrong_version() {
        let (missing_ui, missing_handle) = serve(vec![
            r#"{"status":"healthy","version":"1.2.3"}"#.into(),
            "<!DOCTYPE html><html><p>UI not built.</p></html>".into(),
        ]);
        assert!(!is_compatible_gateway_at(&missing_ui.addr, "1.2.3"));
        missing_handle.join().expect("join missing UI gateway");

        let (wrong_version, version_handle) =
            serve(vec![r#"{"status":"healthy","version":"1.2.2"}"#.into()]);
        assert!(!is_compatible_gateway_at(&wrong_version.addr, "1.2.3"));
        version_handle.join().expect("join wrong version gateway");
    }

    #[test]
    fn parses_only_valid_gateway_port_signals() {
        assert_eq!(
            parse_gateway_port_signal("CYBARA_GATEWAY_PORT=4271;\n"),
            Some(4271)
        );
        assert_eq!(
            parse_gateway_port_signal("log line\nCYBARA_GATEWAY_PORT=4269;\nnext"),
            Some(4269)
        );
        assert_eq!(parse_gateway_port_signal("CYBARA_GATEWAY_PORT=0;"), None);
        assert_eq!(
            parse_gateway_port_signal("CYBARA_GATEWAY_PORT=invalid;"),
            None
        );
        assert_eq!(parse_gateway_port_signal("PORT=4269"), None);
    }

    #[test]
    fn parses_fragmented_gateway_port_signals() {
        let mut parser = GatewayPortSignalParser::default();
        assert_eq!(parser.push("startup\nCYBARA_GATEWAY_"), None);
        assert_eq!(parser.push("PORT=42"), None);
        assert_eq!(parser.push("71;\n"), Some(4271));
    }
}
