//! The Worker under `cf dev`, from a client's side: HTTP and the socket, and
//! `Phone`, a device signed in through the fake issuers. Shared by backend.rs
//! and browser.rs; each test binary uses a part, so unused items are fine.

#![allow(dead_code)]
#![allow(clippy::disallowed_methods)] // tests use files

use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use spjall_client::api::{Method, Platform, Provider, Request, Response, Transport, Unreachable};
use spjall_client::{Client, Event};
use spjall_envelope::Body;
use tempfile::TempDir;
use tungstenite::client::IntoClientRequest as _;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

pub const KEY: [u8; 32] = [7; 32];
pub const PATIENCE: Duration = Duration::from_secs(20);

pub fn base() -> String {
    std::env::var("SPJALL_DEV_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".into())
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

/// The status, and the body as text. workerd marks even an empty 204 as
/// gzip, which ureq cannot read, so a 204 is not read.
pub fn answered(mut answer: ureq::http::Response<ureq::Body>) -> Result<Response, Unreachable> {
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
    pub agent: ureq::Agent,
    pub base: String,
    /// A browser's session cookies, sent where there is no bearer token.
    pub cookie: Option<String>,
    /// The status of each `setPushToken` the core made.
    pub pushes: Arc<Mutex<Vec<u16>>>,
}

impl Http {
    /// The request's credential: the core's token, or else what a browser
    /// sends with its session cookie, the web host's Origin included, which
    /// the Worker requires of a cookie on any request that changes state.
    pub fn credential<B>(
        &self,
        call: ureq::RequestBuilder<B>,
        bearer: Option<&str>,
    ) -> ureq::RequestBuilder<B> {
        if let Some(token) = bearer {
            call.header("authorization", format!("Bearer {token}"))
        } else if let Some(cookie) = &self.cookie {
            call.header("cookie", cookie).header("origin", web_origin())
        } else {
            call
        }
    }
}

/// The origin the Worker takes a session cookie from, read from the frozen
/// ids the way the Worker reads it.
pub fn web_origin() -> String {
    let ids: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../identifiers/ids.json"
    )))
    .unwrap();
    format!("https://{}", ids["hosts"]["web"].as_str().unwrap())
}

impl Transport for Http {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let client = request.client.unwrap_or_default();
        let answer = match request.method {
            Method::Get => {
                let mut call = self.agent.get(&url).header("spjall-client", &client);
                call = self.credential(call, request.bearer.as_deref());
                call.call()
            }
            Method::Delete => {
                let mut call = self.agent.delete(&url).header("spjall-client", &client);
                call = self.credential(call, request.bearer.as_deref());
                call.call()
            }
            Method::Post => {
                let mut call = self
                    .agent
                    .post(&url)
                    .header("content-type", "application/json")
                    .header("spjall-client", &client);
                call = self.credential(call, request.bearer.as_deref());
                call.send(request.body.unwrap_or_default())
            }
            Method::Put => {
                let mut call = self.agent.put(&url).header("spjall-client", &client);
                call = self.credential(call, request.bearer.as_deref());
                match request.body {
                    Some(body) => call.header("content-type", "application/json").send(body),
                    None => call.send_empty(),
                }
            }
            Method::Patch => {
                let mut call = self
                    .agent
                    .patch(&url)
                    .header("content-type", "application/json")
                    .header("spjall-client", &client);
                call = self.credential(call, request.bearer.as_deref());
                call.send(request.body.unwrap_or_default())
            }
        };
        let answer = answered(answer.map_err(|e| Unreachable(e.to_string()))?)?;
        if request.method == Method::Put && request.path.ends_with("/push") {
            self.pushes.lock().unwrap().push(answer.status);
        }
        Ok(answer)
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let blob = std::fs::read(file).map_err(|e| Unreachable(e.to_string()))?;
        let mut call = self
            .agent
            .put(&url)
            .header("content-type", "application/octet-stream")
            .header("spjall-client", request.client.unwrap_or_default());
        call = self.credential(call, request.bearer.as_deref());
        answered(
            call.send(&blob[..])
                .map_err(|e| Unreachable(e.to_string()))?,
        )
    }

    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let mut call = self
            .agent
            .get(&url)
            .header("spjall-client", request.client.unwrap_or_default());
        call = self.credential(call, request.bearer.as_deref());
        if let Some((first, last)) = request.range {
            call = call.header("range", format!("bytes={first}-{last}"));
        }
        let mut answer = call.call().map_err(|e| Unreachable(e.to_string()))?;
        let status = answer.status().as_u16();
        if status != 200 && status != 206 {
            return answered(answer);
        }
        let mut file = std::fs::File::create(to).map_err(|e| Unreachable(e.to_string()))?;
        std::io::copy(&mut answer.body_mut().as_reader(), &mut file)
            .map_err(|e| Unreachable(e.to_string()))?;
        Ok(Response {
            status,
            body: String::new(),
        })
    }
}

/// Who a phone signs in as: a Kenni kennitala, or a Google subject.
pub enum Person<'a> {
    Kenni(&'a str),
    Google(&'a str),
}

/// What the browser does with an authorize URL: the fake issuer answers at
/// once with a redirect, and Google's link host page hands the app its
/// scheme, which is drawn here.
pub fn browse(url: &str, hint: &str) -> String {
    let answer = agent()
        .get(format!("{url}&login_hint={hint}"))
        .call()
        .expect("is `cf dev --mode interop` running, with its fake issuers?");
    assert_eq!(answer.status(), 302);
    let location = answer.headers()["location"].to_str().unwrap().to_owned();
    match location.split_once("/oauth/google?") {
        Some((_, query)) => format!("is.samtak.spjall:/google?{query}"),
        None => location,
    }
}

pub struct Phone {
    pub account: String,
    pub device: String,
    pub pushes: Arc<Mutex<Vec<u16>>>,
    pub _dir: TempDir,
    pub client: Client<Http>,
    pub socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl Phone {
    /// Signs a new device in as an app does, with the fake Kenni standing
    /// in for the browser, and opens its socket.
    pub fn new(kennitala: &str, invite: Option<&str>) -> Self {
        Self::signed_in(Person::Kenni(kennitala), invite)
    }

    pub fn signed_in(person: Person, invite: Option<&str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let pushes = Arc::new(Mutex::new(Vec::new()));
        let transport = Http {
            agent: agent(),
            base: base(),
            cookie: None,
            pushes: pushes.clone(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        client
            .set_client_version(Platform::Android, env!("CARGO_PKG_VERSION"))
            .unwrap();
        let (provider, hint) = match person {
            Person::Kenni(kennitala) => (Provider::Kenni, kennitala),
            Person::Google(subject) => (Provider::Google, subject),
        };
        let url = client.begin_sign_in(provider).unwrap();
        let callback = browse(&url, hint);
        let device = client
            .complete_sign_in(&callback, invite, Platform::Android)
            .unwrap();
        assert_eq!(client.stock_key_packages(3).unwrap(), 3);

        let mut request = format!("{}/v1/ws", base().replacen("http", "ws", 1))
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {}", client.device_token().unwrap())
                .parse()
                .unwrap(),
        );
        // The app sets Spjall-Client on the upgrade itself, as on every request.
        request.headers_mut().insert(
            "spjall-client",
            client.client_header().unwrap().parse().unwrap(),
        );
        let (socket, _) = tungstenite::connect(request).unwrap();
        if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
        }
        Self {
            account: device.account,
            device: device.device,
            pushes,
            _dir: dir,
            client,
            socket,
        }
    }

    pub fn forward(&mut self, frames: Vec<String>) {
        for frame in frames {
            self.socket.send(Message::text(frame)).unwrap();
        }
    }

    pub fn sync(&mut self) -> Vec<Event> {
        let outcome = self.client.sync().unwrap();
        self.forward(outcome.frames);
        outcome.events
    }

    /// Reads the socket, handing each frame to the client, until the events
    /// so far satisfy `done`.
    pub fn deliver_until(&mut self, done: impl Fn(&[Event]) -> bool) -> Vec<Event> {
        let deadline = Instant::now() + PATIENCE;
        let mut events = Vec::new();
        while !done(&events) {
            assert!(
                Instant::now() < deadline,
                "{} waited for {events:?}",
                self.account
            );
            let frame = match self.socket.read() {
                Ok(Message::Text(text)) => text.to_string(),
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e))
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue;
                }
                Err(e) => panic!("socket: {e}"),
            };
            let outcome = self.client.on_frame(&frame).unwrap();
            events.extend(outcome.events);
            self.forward(outcome.frames);
        }
        events
    }

    pub fn send(&mut self, conversation: &str, text: &str) {
        self.client
            .send(
                conversation,
                Body::Text {
                    text: text.into(),
                    forwarded: false,
                },
            )
            .unwrap();
    }

    pub fn texts(&mut self, conversation: &str) -> Vec<String> {
        self.client
            .history(conversation, None, 100)
            .unwrap()
            .into_iter()
            .filter_map(|m| match m.envelope.body {
                Body::Text { text, .. } => Some(text),
                _ => None,
            })
            .collect()
    }
}

pub fn texts(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Message(m) => match &m.envelope.body {
                Body::Text { text, .. } => Some(text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

pub fn has(want: Event) -> impl Fn(&[Event]) -> bool {
    move |events| events.contains(&want)
}

pub fn count(n: usize) -> impl Fn(&[Event]) -> bool {
    move |events| texts(events).len() >= n
}

pub fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}
