//! The test's device and the dev Worker: an app's transport over ureq, the fake
//! Kenni's sign-in, and the reads of a build that decodes everything.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use spjall_client::Client;
use spjall_client::api::{Method, Platform, Provider, Request, Response, Transport, Unreachable};
use tempfile::TempDir;

const KEY: [u8; 32] = [7; 32];

/// A client past every version the Worker compares against: what it reads and
/// the release does not is what was withheld.
pub const KNOWING: &str = "android/99.0.0";

/// One orange pixel, a PNG: an image the Worker's Images binding takes.
pub const PIXEL: [u8; 69] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xdf, 0xc0, 0x00,
    0x00, 0x04, 0x01, 0x01, 0x80, 0xc5, 0x2a, 0x18, 0x5d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

pub fn base() -> String {
    std::env::var("SPJALL_DEV_URL").expect("SPJALL_DEV_URL, the Worker of the tree under test")
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

/// The status, and the body as text. workerd marks even an empty 204 as gzip,
/// which ureq cannot read, so a 204 is not read.
fn answered(mut answer: ureq::http::Response<ureq::Body>) -> Result<Response, Unreachable> {
    let status = answer.status().as_u16();
    if status == 204 {
        return Ok(Response {
            status,
            body: String::new(),
        });
    }
    let body = answer
        .body_mut()
        .read_to_string()
        .map_err(|e| Unreachable(e.to_string()))?;
    Ok(Response { status, body })
}

/// What an app's transport does: the base URL, the core's token, JSON.
#[derive(Clone)]
pub struct Http {
    agent: ureq::Agent,
    base: String,
}

impl Transport for Http {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let client = request.client.unwrap_or_default();
        let bearer = request.bearer.map(|token| format!("Bearer {token}"));
        macro_rules! headed {
            ($call:expr) => {{
                let call = $call.header("spjall-client", &client);
                match &bearer {
                    Some(token) => call.header("authorization", token),
                    None => call,
                }
            }};
        }
        let answer = match request.method {
            Method::Get => headed!(self.agent.get(&url)).call(),
            Method::Delete => headed!(self.agent.delete(&url)).call(),
            Method::Post => headed!(self.agent.post(&url))
                .header("content-type", "application/json")
                .send(request.body.unwrap_or_default()),
            Method::Put => {
                let call = headed!(self.agent.put(&url));
                match request.body {
                    Some(body) => call.header("content-type", "application/json").send(body),
                    None => call.send_empty(),
                }
            }
            Method::Patch => headed!(self.agent.patch(&url))
                .header("content-type", "application/json")
                .send(request.body.unwrap_or_default()),
        };
        answered(answer.map_err(|e| Unreachable(e.to_string()))?)
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let blob = std::fs::read(file).map_err(|e| Unreachable(e.to_string()))?;
        let mut call = self
            .agent
            .put(&url)
            .header("content-type", "application/octet-stream")
            .header("spjall-client", request.client.unwrap_or_default());
        if let Some(token) = request.bearer {
            call = call.header("authorization", format!("Bearer {token}"));
        }
        answered(
            call.send(&blob[..])
                .map_err(|e| Unreachable(e.to_string()))?,
        )
    }

    fn download(&self, _request: Request, _to: &Path) -> Result<Response, Unreachable> {
        unreachable!("this test downloads nothing")
    }
}

/// The kennitala of test person `n` of this run, born on a day in 2099: valid,
/// so the fake Kenni takes it, and nobody's. Computed, because
/// tooling/pii-guard.mjs refuses a valid kennitala in any file.
pub fn kennitala(run: u64, n: u64) -> String {
    const WEIGHTS: [u32; 8] = [3, 2, 7, 6, 5, 4, 3, 2];
    (run.wrapping_add(n * 7919)..)
        .find_map(|k| {
            let first = format!(
                "{:02}{:02}99{:02}",
                1 + k % 28,
                1 + (k / 28) % 12,
                20 + (k / 336) % 80
            );
            let sum: u32 = first
                .bytes()
                .zip(WEIGHTS)
                .map(|(d, w)| u32::from(d - b'0') * w)
                .sum();
            match sum % 11 {
                1 => None,
                0 => Some(format!("{first}00")),
                r => Some(format!("{first}{}0", 11 - r)),
            }
        })
        .unwrap()
}

/// A device of the release, signed in through the fake Kenni.
pub struct Phone {
    pub account: String,
    _dir: TempDir,
    pub client: Client<Http>,
}

impl Phone {
    pub fn new(kennitala: &str, invite: Option<&str>, platform: Platform) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let transport = Http {
            agent: agent(),
            base: base(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        let app = std::env::var("SPJALL_OLD_APP").expect("SPJALL_OLD_APP, the release's version");
        client.set_client_version(platform, &app).unwrap();
        let url = client.begin_sign_in(Provider::Kenni).unwrap();
        let answer = agent()
            .get(format!("{url}&login_hint={kennitala}"))
            .call()
            .expect("is `cf dev --mode interop` running, with its fake issuers?");
        assert_eq!(answer.status(), 302);
        let callback = answer.headers()["location"].to_str().unwrap().to_owned();
        let device = client
            .complete_sign_in(&callback, invite, platform)
            .unwrap();
        Self {
            account: device.account,
            _dir: dir,
            client,
        }
    }

    pub fn token(&self) -> String {
        format!("Bearer {}", self.client.device_token().unwrap())
    }

    /// A GET as a build that decodes everything: its status and raw JSON.
    pub fn knowing(&self, path: &str) -> (u16, Value) {
        let mut answer = agent()
            .get(format!("{}{path}", base()))
            .header("authorization", self.token())
            .header("spjall-client", KNOWING)
            .call()
            .unwrap();
        let status = answer.status().as_u16();
        let body = answer.body_mut().read_to_string().unwrap();
        (status, serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    /// A POST as a build that decodes everything, which must succeed.
    pub fn knowing_post(&self, path: &str, body: &Value) {
        let answer = agent()
            .post(format!("{}{path}", base()))
            .header("authorization", self.token())
            .header("spjall-client", KNOWING)
            .header("content-type", "application/json")
            .send(body.to_string())
            .unwrap();
        assert!(answer.status().is_success(), "{path}: {}", answer.status());
    }
}

/// A POST of the dev Worker's that must answer 204.
pub fn dev(path: &str) {
    let answer = agent()
        .post(format!("{}{path}", base()))
        .send_empty()
        .unwrap();
    assert_eq!(answer.status(), 204, "{path}");
}
