//! The exported client as an app drives it: a foreign `Transport` backed by
//! the in-memory relay the client's own tests use, and a signed-in phone.

use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::Duration;

use crate::relay::{self, Link, Relay};
use spjall_client::api::{self, Transport as _};
use spjall_core::client::{
    CoreClient, Event, HttpMethod, HttpRequest, HttpResponse, Platform, SignInProvider, SignedIn,
    Transport, TransportError,
};

/// What an app's transport is, here backed by the relay, recording every
/// request it was handed.
pub struct App {
    pub link: Link,
    pub seen: Mutex<Vec<HttpRequest>>,
    pub offline: Mutex<bool>,
    /// The next request panics, as a bug in the app's transport would.
    pub panics: Mutex<bool>,
    /// While set, a request waits, as one on a slow network does, and says
    /// so on the channel `hold` returned.
    pub held: Mutex<Option<mpsc::Sender<()>>>,
    pub released: Condvar,
    /// When set, `hold` stops only the requests whose path starts with it.
    pub only: Mutex<Option<&'static str>>,
    /// While not empty, a request is answered with the first of these, as
    /// the Worker answers the social calls the relay does not have.
    pub canned: Mutex<std::collections::VecDeque<HttpResponse>>,
}

impl App {
    pub fn new(link: Link) -> Arc<Self> {
        Arc::new(App {
            link,
            seen: Mutex::new(Vec::new()),
            offline: Mutex::new(false),
            panics: Mutex::new(false),
            held: Mutex::new(None),
            released: Condvar::new(),
            only: Mutex::new(None),
            canned: Mutex::default(),
        })
    }

    fn api(request: HttpRequest) -> api::Request {
        api::Request {
            method: match request.method {
                HttpMethod::Get => api::Method::Get,
                HttpMethod::Post => api::Method::Post,
                HttpMethod::Delete => api::Method::Delete,
                HttpMethod::Put => api::Method::Put,
                HttpMethod::Patch => api::Method::Patch,
            },
            path: request.path,
            body: request.body,
            bearer: request.bearer,
            client: request.client,
            range: None,
        }
    }

    /// Holds every request from now on until `release`; the channel hears
    /// each one that starts waiting.
    pub fn hold(&self) -> mpsc::Receiver<()> {
        let (waiting, heard) = mpsc::channel();
        *self.held.lock().unwrap() = Some(waiting);
        heard
    }

    /// Like `hold`, for the requests to one path only.
    pub fn hold_path(&self, path: &'static str) -> mpsc::Receiver<()> {
        *self.only.lock().unwrap() = Some(path);
        self.hold()
    }

    pub fn release(&self) {
        *self.held.lock().unwrap() = None;
        self.released.notify_all();
    }

    fn through(
        &self,
        request: HttpRequest,
        send: impl FnOnce(api::Request) -> Result<api::Response, api::Unreachable>,
    ) -> Result<HttpResponse, TransportError> {
        self.seen.lock().unwrap().push(request.clone());
        let only = *self.only.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        if only.is_none_or(|path| request.path.starts_with(path)) {
            if let Some(waiting) = held.as_ref() {
                let _ = waiting.send(());
            }
            while held.is_some() {
                held = self.released.wait(held).unwrap();
            }
        }
        drop(held);
        if let Some(answer) = self.canned.lock().unwrap().pop_front() {
            return Ok(answer);
        }
        if std::mem::take(&mut *self.panics.lock().unwrap()) {
            panic!("the transport panicked");
        }
        if *self.offline.lock().unwrap() {
            return Err(TransportError::Unreachable {
                detail: "offline".into(),
            });
        }
        let response =
            send(Self::api(request)).map_err(|e| TransportError::Unreachable { detail: e.0 })?;
        Ok(HttpResponse {
            status: response.status,
            body: response.body,
        })
    }
}

impl Transport for App {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| self.link.request(request))
    }

    fn upload(&self, request: HttpRequest, path: String) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| {
            self.link.upload(request, Path::new(&path))
        })
    }

    fn download(&self, request: HttpRequest, to: String) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| {
            self.link.download(request, Path::new(&to))
        })
    }
}

pub struct Phone {
    pub app: Arc<App>,
    pub client: Arc<CoreClient>,
    pub dir: tempfile::TempDir,
}

pub fn phone(relay: &Arc<Relay>, account: &str, device: &str) -> Phone {
    let dir = tempfile::tempdir().unwrap();
    let app = App::new(relay.link(account, device));
    let client = CoreClient::open(
        dir.path().to_string_lossy().into_owned(),
        vec![7; 32],
        app.clone(),
        Platform::Android,
        "0.2.0".into(),
    )
    .unwrap();
    assert_eq!(client.device_key().unwrap().len(), 32);
    let url = client.begin_sign_in(SignInProvider::Kenni).unwrap();
    let signed_in = client
        .complete_sign_in(relay::kenni(&url), None, Platform::Android)
        .unwrap();
    assert_eq!(
        signed_in,
        SignedIn {
            account_id: account.into(),
            device_id: device.into()
        }
    );
    assert_eq!(client.stock_key_packages(2).unwrap(), 2);
    Phone { app, client, dir }
}

/// Hands every frame waiting on the device's socket to its client.
pub fn deliver(relay: &Relay, phone: &Phone, account: &str, device: &str) -> Vec<Event> {
    let mut events = Vec::new();
    for frame in relay.frames(device) {
        let outcome = phone.client.on_frame(frame).unwrap();
        events.extend(outcome.events);
        for frame in outcome.frames {
            relay.socket(account, &frame);
        }
    }
    events
}

/// Runs `read` on a thread of its own and gives what it returned; panics
/// when it has not returned within two seconds.
pub fn promptly<T: Send + 'static>(read: impl FnOnce() -> T + Send + 'static) -> T {
    let (done, result) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(read());
    });
    result
        .recv_timeout(Duration::from_secs(2))
        .expect("the read waited")
}
