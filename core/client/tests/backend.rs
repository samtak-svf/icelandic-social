//! The sync engine against the real Worker under `wrangler dev`, over HTTP
//! and the WebSocket. Ignored by `cargo test`; interop.yml runs it with
//! the Worker started from `backend/dev/worker.ts`, its fake Kenni as the
//! issuer, and an operator invite to let the first account in:
//!
//! ```text
//! SPJALL_DEV_URL=http://127.0.0.1:8787 SPJALL_INVITE=<link> \
//!   cargo test -p spjall-client --test backend -- --ignored
//! ```

use std::net::TcpStream;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use spjall_client::api::{ApiError, Method, Platform, Request, Response, Transport, Unreachable};
use spjall_client::{Client, ClientError, Content, Event, invite_token};
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

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

/// The status, and the body as text. workerd marks even an empty 204 as
/// gzip, which ureq cannot read, so a 204 is not read.
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
struct Http {
    agent: ureq::Agent,
    base: String,
}

impl Transport for Http {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let auth = request.bearer.map(|token| format!("Bearer {token}"));
        let answer = match request.method {
            Method::Get => {
                let mut call = self.agent.get(&url);
                if let Some(auth) = &auth {
                    call = call.header("authorization", auth);
                }
                call.call()
            }
            Method::Delete => {
                let mut call = self.agent.delete(&url);
                if let Some(auth) = &auth {
                    call = call.header("authorization", auth);
                }
                call.call()
            }
            Method::Post => {
                let mut call = self
                    .agent
                    .post(&url)
                    .header("content-type", "application/json");
                if let Some(auth) = &auth {
                    call = call.header("authorization", auth);
                }
                call.send(request.body.unwrap_or_default())
            }
            Method::Put => {
                let mut call = self.agent.put(&url);
                if let Some(auth) = &auth {
                    call = call.header("authorization", auth);
                }
                call.send_empty()
            }
        };
        answered(answer.map_err(|e| Unreachable(e.to_string()))?)
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let blob = std::fs::read(file).map_err(|e| Unreachable(e.to_string()))?;
        let mut call = self
            .agent
            .put(&url)
            .header("content-type", "application/octet-stream");
        if let Some(token) = request.bearer {
            call = call.header("authorization", format!("Bearer {token}"));
        }
        answered(
            call.send(&blob[..])
                .map_err(|e| Unreachable(e.to_string()))?,
        )
    }

    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        let url = format!("{}{}", self.base, request.path);
        let mut call = self.agent.get(&url);
        if let Some(token) = request.bearer {
            call = call.header("authorization", format!("Bearer {token}"));
        }
        let mut answer = call.call().map_err(|e| Unreachable(e.to_string()))?;
        let status = answer.status().as_u16();
        if status != 200 {
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

/// The kennitala of test person `n` of this run, born on a day in 2099:
/// valid, so the fake Kenni takes it, and nobody's. Computed, because
/// tooling/pii-guard.mjs refuses a valid kennitala in any file.
fn kennitala(run: u64, n: u64) -> String {
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

struct Phone {
    account: String,
    _dir: TempDir,
    client: Client<Http>,
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl Phone {
    /// Signs a new device in as an app does, with the fake Kenni standing
    /// in for the browser, and opens its socket.
    fn new(kennitala: &str, invite: Option<&str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let transport = Http {
            agent: agent(),
            base: base(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        let url = client.begin_sign_in().unwrap();
        let answer = agent()
            .get(format!("{url}&login_hint={kennitala}"))
            .call()
            .expect("is wrangler dev running dev/worker.ts with its fake Kenni?");
        assert_eq!(answer.status(), 302);
        let callback = answer.headers()["location"].to_str().unwrap().to_owned();
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
        let (socket, _) = tungstenite::connect(request).unwrap();
        if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
        }
        Self {
            account: device.account,
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
    // People of their own, so a run never meets an earlier one's accounts.
    let run = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let operator = std::env::var("SPJALL_INVITE").expect("SPJALL_INVITE, an operator invite link");
    let operator = invite_token(&operator).expect("an invite link");

    // The operator's invite lets a in; a's second device needs none.
    let mut a1 = Phone::new(&kennitala(run, 0), Some(&operator));
    let mut a2 = Phone::new(&kennitala(run, 0), None);
    assert_eq!(a2.account, a1.account);
    assert_eq!(a1.client.me().unwrap().devices.len(), 2);

    // a's own link lets the others in.
    let link = a1.client.rotate_invite().unwrap();
    let invite = invite_token(&link).unwrap();
    assert!(a1.client.resolve_invite(&invite).unwrap().is_some());
    let mut b1 = Phone::new(&kennitala(run, 1), Some(&invite));
    let mut c1 = Phone::new(&kennitala(run, 2), Some(&invite));
    let mut d1 = Phone::new(&kennitala(run, 3), Some(&invite));
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
    let frame = a1.client.typing(&conversation, true).unwrap().unwrap();
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
    let membership: Vec<Event> = a1
        .sync()
        .into_iter()
        .filter(|e| matches!(e, Event::Membership { .. }))
        .collect();
    assert_eq!(membership, vec![added(&d), added(&c)]);
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

    // A device d signs in later joins from the latest GroupInfo by an
    // external commit, and the others see a new device of d (0021).
    let mut d2 = Phone::new(&kennitala(run, 3), None);
    assert_eq!(d2.account, d);
    a1.send(&conversation, "fyrir d2");
    a1.sync();
    d2.deliver_until(has(joined.clone()));
    let new_device_of_d = |events: &[Event]| {
        events.iter().any(|e| {
            matches!(e, Event::Devices { joined, .. }
                if joined.len() == 1 && joined[0].account == d)
        })
    };
    a1.deliver_until(new_device_of_d);
    c1.deliver_until(new_device_of_d);
    d2.send(&conversation, "frá d2");
    d2.sync();
    for phone in [&mut a1, &mut c1, &mut d1] {
        phone.deliver_until(|events| texts(events).contains(&"frá d2".to_owned()));
    }
    assert_eq!(d2.texts(&conversation), strings(&["frá d2"]));

    // a's link opens a 1:1 with a, and opening it again finds the same one
    // (0022). Its timeline, unread count and read marker go both ways.
    let one = c1.client.open_invite(&invite).unwrap();
    assert_ne!(one, conversation);
    c1.sync();
    a1.deliver_until(has(Event::Joined {
        conversation: one.clone(),
    }));
    assert_eq!(c1.client.open_invite(&invite).unwrap(), one);
    c1.send(&one, "bara við");
    c1.sync();
    a1.deliver_until(|events| texts(events).contains(&"bara við".to_owned()));
    let items = a1.client.timeline(&one, None, 10).unwrap();
    let last = items.last().unwrap();
    assert!(matches!(&last.content, Content::Text { text, .. } if text == "bara við"));
    assert_eq!(last.sender.account, c);
    let listed = a1.client.conversations().unwrap();
    assert_eq!((listed[0].id.as_str(), listed[0].unread), (one.as_str(), 1));
    assert_eq!(listed[0].members[0].account, c);

    let seq = last.seq.unwrap();
    a1.client.mark_read(&one, seq).unwrap();
    assert_eq!(a1.client.conversations().unwrap()[0].unread, 0);
    a1.sync();
    c1.deliver_until(|events| {
        events.iter().any(|e| {
            matches!(e, Event::Timeline { conversation, changed }
                if *conversation == one && changed.contains(&seq))
        })
    });
    let own = c1.client.timeline(&one, None, 10).unwrap();
    assert_eq!(own.last().unwrap().read_by, 1);
    assert!(
        c1.client
            .people()
            .unwrap()
            .iter()
            .any(|p| p.account == a1.account)
    );

    // A photo crosses sealed: R2 holds the blob, and a opens it (0023).
    let files = tempfile::tempdir().unwrap();
    let photo: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
    let path = files.path().join("mynd.png");
    std::fs::write(&path, &photo).unwrap();
    c1.client
        .send_media(&one, &path, "image/png", Some("sólarlag".into()))
        .unwrap();
    c1.sync();
    a1.deliver_until(|events| {
        events.iter().any(
            |e| matches!(e, Event::Message(m) if matches!(m.envelope.body, Body::Media { .. })),
        )
    });
    let item = a1.client.timeline(&one, None, 10).unwrap().pop().unwrap();
    assert!(matches!(&item.content, Content::Media { size, .. } if *size == photo.len() as u64));
    let opened = a1.client.media(&one, item.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(opened).unwrap(), photo);

    // a blocks c: the 1:1 ends, c cannot claim a's KeyPackages to start
    // another, and lifting the block lets it (0024).
    let outcome = a1.client.block(&c).unwrap();
    assert!(outcome.events.iter().any(|e| {
        matches!(e, Event::Membership { conversation, removed, .. }
            if *conversation == one && removed == std::slice::from_ref(&c))
    }));
    c1.deliver_until(has(Event::Removed {
        conversation: one.clone(),
    }));
    let blocked = a1.client.blocked().unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0].account, c);
    c1.client
        .create_conversation(std::slice::from_ref(&a1.account))
        .unwrap();
    assert!(matches!(
        c1.client.sync(),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    a1.client.unblock(&c).unwrap();
    assert!(a1.client.blocked().unwrap().is_empty());
    c1.sync();
    a1.deliver_until(|events| events.iter().any(|e| matches!(e, Event::Joined { .. })));
}
