use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_millis(900);
const LIVENESS_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const GATEWAY_PORT_SIGNAL_PREFIX: &str = "CYBARA_GATEWAY_PORT=";
const DESKTOP_GATEWAY_API_VERSION: u64 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GatewayProbeStatus {
    Available,
    Busy,
    NonCybara,
    UnhealthyCybara { gateway_version: Option<String> },
    CybaraGateway(GatewayCompatibility),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GatewayCompatibility {
    Compatible {
        gateway_version: String,
        exact_match: bool,
    },
    Incompatible {
        gateway_version: Option<String>,
        reason: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GatewayLivenessStatus {
    Live,
    Busy,
    Unhealthy,
    Unreachable,
}

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

struct GatewayHealth {
    version: Option<String>,
    healthy: bool,
    api_version: Option<u64>,
    min_client_api_version: Option<u64>,
    compatibility_declared: bool,
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
    http_get_with_timeout(addr, path, PROBE_TIMEOUT)
}

fn http_get_with_timeout(addr: &str, path: &str, timeout: Duration) -> Option<HttpResponse> {
    let mut stream = TcpStream::connect(addr).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
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

pub fn probe_gateway_at(addr: &str, client_version: &str) -> GatewayProbeStatus {
    let Some(health) = http_get(addr, "/api/health") else {
        return if port_accepts_connections(addr) {
            GatewayProbeStatus::Busy
        } else {
            GatewayProbeStatus::Available
        };
    };
    let Some(health) = cybara_health(&health) else {
        return GatewayProbeStatus::NonCybara;
    };
    if !health.healthy {
        return GatewayProbeStatus::UnhealthyCybara {
            gateway_version: health.version,
        };
    }
    let Some(gateway_version) = health.version else {
        return GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible {
            gateway_version: None,
            reason: "The Cybara gateway returned a missing version.".to_string(),
        });
    };
    let compatibility = gateway_compatibility_with_api(
        &gateway_version,
        client_version,
        health.api_version,
        health.min_client_api_version,
        health.compatibility_declared,
    );
    let GatewayCompatibility::Compatible { .. } = compatibility else {
        return GatewayProbeStatus::CybaraGateway(compatibility);
    };
    let Some(ui) = ui_response(addr) else {
        return GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible {
            gateway_version: Some(gateway_version),
            reason: "The Cybara gateway did not return its web interface.".to_string(),
        });
    };
    let normalized = ui.body.to_ascii_lowercase();
    if ui.status == 200
        && normalized.contains("<!doctype html")
        && normalized.contains("/assets/")
        && !normalized.contains("ui not built")
    {
        GatewayProbeStatus::CybaraGateway(compatibility)
    } else {
        GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible {
            gateway_version: Some(gateway_version),
            reason: "The Cybara gateway web interface is unavailable.".to_string(),
        })
    }
}

pub fn is_compatible_gateway_at(addr: &str, client_version: &str) -> bool {
    matches!(
        probe_gateway_at(addr, client_version),
        GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Compatible { .. })
    )
}

fn port_accepts_connections(addr: &str) -> bool {
    let Ok(address) = addr.parse() else {
        return false;
    };
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

pub fn gateway_liveness_at(addr: &str) -> GatewayLivenessStatus {
    let Some(response) = http_get_with_timeout(addr, "/api/health/live", LIVENESS_PROBE_TIMEOUT)
    else {
        return if port_accepts_connections(addr) {
            GatewayLivenessStatus::Busy
        } else {
            GatewayLivenessStatus::Unreachable
        };
    };
    if response.status != 200 {
        return GatewayLivenessStatus::Unhealthy;
    }
    if serde_json::from_str::<serde_json::Value>(&response.body)
        .ok()
        .and_then(|value| value.get("live").and_then(serde_json::Value::as_bool))
        == Some(true)
    {
        GatewayLivenessStatus::Live
    } else {
        GatewayLivenessStatus::Unhealthy
    }
}

fn cybara_health(response: &HttpResponse) -> Option<GatewayHealth> {
    let value = serde_json::from_str::<serde_json::Value>(&response.body).ok()?;
    let status = value.get("status").and_then(serde_json::Value::as_str)?;
    if !matches!(status, "healthy" | "warning" | "critical" | "unhealthy") {
        return None;
    }
    let compatibility = value.get("compatibility");
    let product = value.get("product").and_then(serde_json::Value::as_str);
    let structural_markers = ["timestamp", "uptime", "system", "checks"]
        .iter()
        .filter(|key| value.get(**key).is_some())
        .count();
    if product != Some("cybara") && compatibility.is_none() && structural_markers < 2 {
        return None;
    }
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string);
    Some(GatewayHealth {
        version,
        healthy: response.status == 200 && matches!(status, "healthy" | "warning" | "critical"),
        api_version: compatibility
            .and_then(|entry| entry.get("api_version"))
            .and_then(serde_json::Value::as_u64),
        min_client_api_version: compatibility
            .and_then(|entry| entry.get("min_client_api_version"))
            .and_then(serde_json::Value::as_u64),
        compatibility_declared: compatibility.is_some(),
    })
}

fn version_components(value: &str) -> Option<[u64; 3]> {
    let core = value.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let version = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    parts.next().is_none().then_some(version)
}

pub fn gateway_compatibility(gateway_version: &str, client_version: &str) -> GatewayCompatibility {
    gateway_compatibility_with_api(gateway_version, client_version, None, None, false)
}

fn gateway_compatibility_with_api(
    gateway_version: &str,
    client_version: &str,
    api_version: Option<u64>,
    min_client_api_version: Option<u64>,
    compatibility_declared: bool,
) -> GatewayCompatibility {
    let Some(gateway) = version_components(gateway_version) else {
        return GatewayCompatibility::Incompatible {
            gateway_version: None,
            reason: "The Cybara gateway returned an unparseable version.".to_string(),
        };
    };
    let Some(client) = version_components(client_version) else {
        return GatewayCompatibility::Incompatible {
            gateway_version: Some(gateway_version.to_string()),
            reason: "The desktop client version is unparseable.".to_string(),
        };
    };
    if gateway[0] != client[0] {
        return GatewayCompatibility::Incompatible {
            gateway_version: Some(gateway_version.to_string()),
            reason: format!(
                "Gateway major version {} is incompatible with desktop major version {}.",
                gateway[0], client[0]
            ),
        };
    }
    if compatibility_declared {
        let (Some(api_version), Some(min_client_api_version)) =
            (api_version, min_client_api_version)
        else {
            return GatewayCompatibility::Incompatible {
                gateway_version: Some(gateway_version.to_string()),
                reason: "The Cybara gateway returned invalid API compatibility metadata."
                    .to_string(),
            };
        };
        if api_version == 0 || min_client_api_version == 0 {
            return GatewayCompatibility::Incompatible {
                gateway_version: Some(gateway_version.to_string()),
                reason: "The Cybara gateway returned invalid API compatibility metadata."
                    .to_string(),
            };
        }
        if DESKTOP_GATEWAY_API_VERSION < min_client_api_version {
            return GatewayCompatibility::Incompatible {
                gateway_version: Some(gateway_version.to_string()),
                reason: format!(
                    "Gateway API requires desktop API {min_client_api_version} or newer; this desktop supports API {DESKTOP_GATEWAY_API_VERSION}."
                ),
            };
        }
        if DESKTOP_GATEWAY_API_VERSION > api_version {
            return GatewayCompatibility::Incompatible {
                gateway_version: Some(gateway_version.to_string()),
                reason: format!(
                    "This desktop requires gateway API {DESKTOP_GATEWAY_API_VERSION}; the gateway supports API {api_version}."
                ),
            };
        }
    }
    GatewayCompatibility::Compatible {
        gateway_version: gateway_version.to_string(),
        exact_match: gateway == client,
    }
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
        GatewayCompatibility, GatewayEndpoint, GatewayLivenessStatus, GatewayPortSignalParser,
        GatewayProbeStatus, gateway_compatibility, gateway_liveness_at, is_compatible_gateway_at,
        parse_gateway_port_signal, probe_gateway_at,
    };
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

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
            r#"{"product":"cybara","status":"healthy","version":"1.2.3"}"#.into(),
            r#"<!doctype html><html><script src="/assets/index.js"></script></html>"#.into(),
        ]);
        assert!(is_compatible_gateway_at(&endpoint.addr, "1.2.3"));
        handle.join().expect("join test gateway");
    }

    #[test]
    fn accepts_same_major_gateway_patch_drift_in_both_directions() {
        for gateway_version in ["1.0.2275", "1.0.2287"] {
            let (endpoint, handle) = serve(vec![
                format!(
                    r#"{{"product":"cybara","status":"healthy","version":"{gateway_version}"}}"#
                ),
                r#"<!doctype html><html><script src="/assets/index.js"></script></html>"#.into(),
            ]);
            assert!(is_compatible_gateway_at(&endpoint.addr, "1.0.2281"));
            handle.join().expect("join compatible drift gateway");
        }
        assert_eq!(
            gateway_compatibility("1.0.2275", "1.0.2281"),
            GatewayCompatibility::Compatible {
                gateway_version: "1.0.2275".into(),
                exact_match: false,
            }
        );
        assert_eq!(
            gateway_compatibility("1.0.2281", "1.0.2281"),
            GatewayCompatibility::Compatible {
                gateway_version: "1.0.2281".into(),
                exact_match: true,
            }
        );
    }

    #[test]
    fn rejects_different_major_and_unparseable_gateway_versions() {
        assert!(matches!(
            gateway_compatibility("2.0.0", "1.0.2281"),
            GatewayCompatibility::Incompatible {
                gateway_version: Some(version),
                reason,
            } if version == "2.0.0" && reason.contains("major version 2")
        ));
        assert!(matches!(
            gateway_compatibility("development", "1.0.2281"),
            GatewayCompatibility::Incompatible {
                gateway_version: None,
                reason,
            } if reason.contains("unparseable")
        ));
    }

    #[test]
    fn api_compatibility_metadata_can_require_a_desktop_update() {
        let (endpoint, handle) = serve(vec![
            r#"{"product":"cybara","status":"healthy","version":"1.0.2287","compatibility":{"api_version":2,"min_client_api_version":2}}"#.into(),
        ]);
        assert!(matches!(
            probe_gateway_at(&endpoint.addr, "1.0.2281"),
            GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible {
                gateway_version: Some(version),
                reason,
            }) if version == "1.0.2287" && reason.contains("desktop API 2 or newer")
        ));
        handle.join().expect("join API-incompatible gateway");
    }

    #[test]
    fn invalid_api_compatibility_metadata_fails_closed() {
        let (endpoint, handle) = serve(vec![
            r#"{"product":"cybara","status":"healthy","version":"1.0.2281","compatibility":{"api_version":"new"}}"#
                .into(),
        ]);
        assert!(matches!(
            probe_gateway_at(&endpoint.addr, "1.0.2281"),
            GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible { reason, .. })
                if reason.contains("invalid API compatibility metadata")
        ));
        handle.join().expect("join invalid compatibility gateway");
    }

    #[test]
    fn classifies_non_cybara_health_json_as_an_occupied_port() {
        let (endpoint, handle) = serve(vec![r#"{"status":"ok","version":"1.0.2281"}"#.into()]);
        assert_eq!(
            probe_gateway_at(&endpoint.addr, "1.0.2281"),
            GatewayProbeStatus::NonCybara
        );
        handle.join().expect("join unrelated service");
    }

    #[test]
    fn classifies_busy_gateway_without_treating_its_port_as_available() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind busy gateway");
        let port = listener.local_addr().expect("read busy address").port();
        let handle = thread::spawn(move || {
            let _ = listener.accept().expect("accept health probe");
            thread::sleep(Duration::from_millis(1_100));
            let _ = listener.accept().expect("accept occupancy probe");
        });
        assert_eq!(
            probe_gateway_at(&format!("127.0.0.1:{port}"), "1.2.3"),
            GatewayProbeStatus::Busy
        );
        handle.join().expect("join busy gateway");
    }

    #[test]
    fn classifies_released_port_as_available() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind available port");
        let port = listener
            .local_addr()
            .expect("read available address")
            .port();
        drop(listener);
        assert_eq!(
            probe_gateway_at(&format!("127.0.0.1:{port}"), "1.2.3"),
            GatewayProbeStatus::Available
        );
    }

    #[test]
    fn rejects_gateway_with_missing_ui_or_wrong_version() {
        let (missing_ui, missing_handle) = serve(vec![
            r#"{"product":"cybara","status":"healthy","version":"1.2.3"}"#.into(),
            "<!DOCTYPE html><html><p>UI not built.</p></html>".into(),
        ]);
        assert!(!is_compatible_gateway_at(&missing_ui.addr, "1.2.3"));
        missing_handle.join().expect("join missing UI gateway");

        let (wrong_major, version_handle) = serve(vec![
            r#"{"product":"cybara","status":"healthy","version":"2.0.0"}"#.into(),
        ]);
        assert!(matches!(
            probe_gateway_at(&wrong_major.addr, "1.2.3"),
            GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible { .. })
        ));
        version_handle.join().expect("join wrong major gateway");
    }

    #[test]
    fn liveness_probe_accepts_live_payload() {
        let (live, live_handle) = serve(vec![r#"{"live":true}"#.into()]);
        assert_eq!(gateway_liveness_at(&live.addr), GatewayLivenessStatus::Live);
        live_handle.join().expect("join live gateway");
    }

    #[test]
    fn liveness_probe_tolerates_a_busy_event_loop() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind delayed gateway");
        let port = listener.local_addr().expect("read delayed address").port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept delayed request");
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            thread::sleep(Duration::from_millis(1_100));
            let body = r#"{"live":true}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write delayed response");
        });
        assert_eq!(
            gateway_liveness_at(&format!("127.0.0.1:{port}")),
            GatewayLivenessStatus::Live
        );
        handle.join().expect("join delayed gateway");
    }

    #[test]
    fn stalled_liveness_probe_is_busy_and_not_dead() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind stalled gateway");
        let port = listener.local_addr().expect("read stalled address").port();
        let handle = thread::spawn(move || {
            let _ = listener.accept().expect("accept stalled request");
            thread::sleep(Duration::from_secs(3));
        });
        let started = std::time::Instant::now();
        assert_eq!(
            gateway_liveness_at(&format!("127.0.0.1:{port}")),
            GatewayLivenessStatus::Busy
        );
        assert!(started.elapsed() < Duration::from_millis(2_500));
        handle.join().expect("join stalled gateway");
    }

    #[test]
    fn liveness_probe_distinguishes_unhealthy_and_unreachable_gateways() {
        let (not_live, not_live_handle) = serve(vec![r#"{"live":false}"#.into()]);
        assert_eq!(
            gateway_liveness_at(&not_live.addr),
            GatewayLivenessStatus::Unhealthy
        );
        not_live_handle.join().expect("join unhealthy gateway");

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind unreachable port");
        let port = listener.local_addr().expect("read unreachable port").port();
        drop(listener);
        assert_eq!(
            gateway_liveness_at(&format!("127.0.0.1:{port}")),
            GatewayLivenessStatus::Unreachable
        );
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
