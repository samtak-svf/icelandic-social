//! The sync engine against the real Worker under `wrangler dev`, over HTTP
//! and the WebSocket. Ignored by `cargo test`; interop.yml runs it with
//! the Worker started from `backend/dev/worker.ts`:
//!
//! ```text
//! SPJALL_DEV_URL=http://127.0.0.1:8787 cargo test -p spjall-client --test backend -- --ignored
//! ```

use std::cell::RefCell;
use std::net::TcpStream;
use std::rc::Rc;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use spjall_client::api::{Method, Request, Response, Transport, Unreachable};
use spjall_client::{Client, Event};
use spjall_envelope::Body;
use tempfile::TempDir;
use tungstenite::client::IntoClientRequest as _;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

const KEY: [u8; 32] = [7; 32];
const PATIENCE: Duration = Duration::from_secs(20);

fn base() -> String {
    std::env::var("SPJALL_DEV_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".into())
}

/// What an app's transport does: the base URL, the token, JSON.
struct Http {
    agent: ureq::Agent,
    base: String,
    /// Empty until the device is registered.
    token: Rc<RefCell<String>>,
}

impl Transport for Http {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let auth = format!("Bearer {}", self.token.borrow());
        let answer = match request.method {
            Method::Get => self.agent.get(&url).header("authorization", &auth).call(),
            Method::Post => self
                .agent
                .post(&url)
                .header("authorization", &auth)
                .header("content-type", "application/json")
                .send(request.body.unwrap_or_default()),
        };
        let mut answer = answer.map_err(|e| Unreachable(e.to_string()))?;
        let status = answer.status().as_u16();
        let body = answer
            .body_mut()
            .read_to_string()
            .map_err(|e| Unreachable(e.to_string()))?;
        Ok(Response { status, body })
    }
}

struct Phone {
    account: String,
    _dir: TempDir,
    client: Client<Http>,
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl Phone {
    /// Registers a device through the dev Worker's `/dev/devices`, since
    /// Kenni sign-in does not exist yet, and opens its socket.
    fn new(run: &str, account: &str, device: &str) -> Self {
        let (account, device) = (format!("{account}_{run}"), format!("{device}_{run}"));
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        let dir = tempfile::tempdir().unwrap();
        let token = Rc::new(RefCell::new(String::new()));
        let transport = Http {
            agent: agent.clone(),
            base: base(),
            token: token.clone(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        let public = client.device_key().unwrap();
        let body = serde_json::json!({
            "accountId": account,
            "deviceId": device,
            "devicePublic": STANDARD.encode(public),
        });
        let mut answer = agent
            .post(format!("{}/dev/devices", base()))
            .header("content-type", "application/json")
            .send(body.to_string())
            .unwrap();
        assert_eq!(
            answer.status(),
            200,
            "is wrangler dev running dev/worker.ts?"
        );
        let registered: serde_json::Value =
            serde_json::from_str(&answer.body_mut().read_to_string().unwrap()).unwrap();
        *token.borrow_mut() = registered["token"].as_str().unwrap().to_owned();
        client.registered(&account, &device).unwrap();
        assert_eq!(client.stock_key_packages(3).unwrap(), 3);

        let mut request = format!("{}/v1/ws", base().replacen("http", "ws", 1))
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {}", token.borrow()).parse().unwrap(),
        );
        let (socket, _) = tungstenite::connect(request).unwrap();
        if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
        }
        Self {
            account,
            _dir: dir,
            client,
            socket,
        }
    }

    fn forward(&mut self, frames: Vec<String>) {
        for frame in frames {
            self.socket.send(Message::text(frame)).unwrap();
        }
    }

    fn sync(&mut self) -> Vec<Event> {
        let outcome = self.client.sync().unwrap();
        self.forward(outcome.frames);
        outcome.events
    }

    /// Reads the socket, handing each frame to the client, until the events
    /// so far satisfy `done`.
    fn deliver_until(&mut self, done: impl Fn(&[Event]) -> bool) -> Vec<Event> {
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

    fn send(&mut self, conversation: &str, text: &str) {
        self.client
            .send(conversation, Body::Text { text: text.into() })
            .unwrap();
    }

    fn texts(&mut self, conversation: &str) -> Vec<String> {
        self.client
            .history(conversation, None, 100)
            .unwrap()
            .into_iter()
            .filter_map(|m| match m.envelope.body {
                Body::Text { text } => Some(text),
                _ => None,
            })
            .collect()
    }
}

fn texts(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Message(m) => match &m.envelope.body {
                Body::Text { text } => Some(text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn has(want: Event) -> impl Fn(&[Event]) -> bool {
    move |events| events.contains(&want)
}

fn count(n: usize) -> impl Fn(&[Event]) -> bool {
    move |events| texts(events).len() >= n
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
#[ignore = "needs `wrangler dev dev/worker.ts`; run by interop.yml"]
fn devices_talk_through_the_worker() {
    // Ids of their own, so a run never meets an earlier one's state.
    let run = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let mut a1 = Phone::new(&run, "a", "a1");
    let mut a2 = Phone::new(&run, "a", "a2");
    let mut b1 = Phone::new(&run, "b", "b1");
    let mut c1 = Phone::new(&run, "c", "c1");
    let mut d1 = Phone::new(&run, "d", "d1");
    let (b, c, d) = (b1.account.clone(), c1.account.clone(), d1.account.clone());

    // A conversation reaches the other account and the creator's other device.
    let conversation = a1
        .client
        .create_conversation(std::slice::from_ref(&b))
        .unwrap();
    a1.sync();
    let joined = Event::Joined {
        conversation: conversation.clone(),
    };
    b1.deliver_until(has(joined.clone()));
    a2.deliver_until(has(joined.clone()));

    a1.send(&conversation, "halló");
    assert_eq!(texts(&a1.sync()), strings(&["halló"]));
    assert_eq!(texts(&b1.deliver_until(count(1))), strings(&["halló"]));
    assert_eq!(texts(&a2.deliver_until(count(1))), strings(&["halló"]));

    for text in ["eitt", "tvö", "þrjú"] {
        b1.send(&conversation, text);
    }
    b1.sync();
    assert_eq!(
        texts(&a1.deliver_until(count(3))),
        strings(&["eitt", "tvö", "þrjú"])
    );

    // Typing goes through the socket and is never stored.
    let frame = a1.client.typing(&conversation, true).unwrap();
    a1.forward(vec![frame]);
    b1.deliver_until(has(Event::Typing {
        conversation: conversation.clone(),
        active: true,
    }));

    // Two commits on one epoch: the server takes b's, and a commits its
    // intent again on the epoch that won.
    a1.client
        .add_accounts(&conversation, std::slice::from_ref(&c))
        .unwrap();
    b1.client
        .add_accounts(&conversation, std::slice::from_ref(&d))
        .unwrap();
    b1.sync();
    let added = |who: &str| Event::Membership {
        conversation: conversation.clone(),
        added: vec![who.to_owned()],
        removed: Vec::new(),
    };
    assert_eq!(a1.sync(), vec![added(&d), added(&c)]);
    c1.deliver_until(has(joined.clone()));
    d1.deliver_until(has(joined.clone()));

    // A removed account learns it, and the others go on without it.
    a1.client
        .remove_accounts(&conversation, std::slice::from_ref(&b))
        .unwrap();
    a1.sync();
    b1.deliver_until(has(Event::Removed {
        conversation: conversation.clone(),
    }));
    c1.send(&conversation, "án b");
    c1.sync();
    for phone in [&mut a1, &mut a2, &mut d1] {
        phone.deliver_until(|events| texts(events).contains(&"án b".to_owned()));
    }

    assert_eq!(
        a2.texts(&conversation),
        strings(&["halló", "eitt", "tvö", "þrjú", "án b"])
    );
    assert_eq!(
        b1.texts(&conversation),
        strings(&["halló", "eitt", "tvö", "þrjú"])
    );
    assert_eq!(d1.texts(&conversation), strings(&["án b"]));
}
