//! The social calls' test harness: sign-in goes to the in-memory relay, and
//! every social request is answered with the canned JSON a test queued, as
//! the Worker would answer it. Included by the test crates that need it, each
//! with `mod relay` at its root.

#![allow(clippy::disallowed_methods, dead_code)] // tests use files

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::relay::{self, Link, Relay};
use serde_json::{Value, json};
use spjall_client::Client;
use spjall_client::api::{Method, Platform, Provider, Request, Response, Transport, Unreachable};
use tempfile::TempDir;

pub const KEY: [u8; 32] = [7; 32];

pub const SOCIAL: [&str; 9] = [
    "/v1/communities",
    "/v1/me/communities",
    "/v1/feed",
    "/v1/posts/",
    "/v1/comments/",
    "/v1/reports",
    "/v1/cards",
    "/v1/notifications",
    "/v1/notification-settings",
];

#[derive(Default)]
pub struct Canned {
    pub answers: VecDeque<Response>,
    pub seen: Vec<Request>,
    pub uploaded: Vec<Vec<u8>>,
}

/// The bytes a canned image download writes.
pub const IMAGE: &[u8] = b"RIFF\0\0\0\0WEBPVP8 ";

/// The relay for sign-in, and the canned answers for the social calls.
pub struct Hosted {
    pub link: Link,
    pub canned: Arc<Mutex<Canned>>,
}

impl Transport for Hosted {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.request(request);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.seen.push(request);
        Ok(canned.answers.pop_front().expect("an answer was queued"))
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.upload(request, file);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.uploaded.push(std::fs::read(file).unwrap());
        canned.seen.push(request);
        Ok(canned.answers.pop_front().expect("an answer was queued"))
    }

    /// A social download gets the queued answer, and on 200 the bytes
    /// `IMAGE` in the file.
    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.download(request, to);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.seen.push(request);
        let answer = canned.answers.pop_front().expect("an answer was queued");
        if answer.status == 200 {
            std::fs::write(to, IMAGE).unwrap();
        }
        Ok(answer)
    }
}

pub struct Phone {
    pub canned: Arc<Mutex<Canned>>,
    pub client: Client<Hosted>,
    pub _dir: TempDir,
}

impl Phone {
    pub fn signed_in() -> Self {
        let relay = Relay::new();
        let canned = Arc::new(Mutex::new(Canned::default()));
        let dir = tempfile::tempdir().unwrap();
        let transport = Hosted {
            link: relay.link("a", "a1"),
            canned: canned.clone(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        let url = client.begin_sign_in(Provider::Kenni).unwrap();
        client
            .complete_sign_in(&relay::kenni(&url), None, Platform::Android)
            .unwrap();
        Self {
            canned,
            client,
            _dir: dir,
        }
    }

    pub fn answer(&self, status: u16, body: Value) {
        let body = if body.is_null() {
            String::new()
        } else {
            body.to_string()
        };
        let mut canned = self.canned.lock().unwrap();
        canned.answers.push_back(Response { status, body });
    }

    pub fn ok(&self) {
        self.answer(204, Value::Null);
    }

    /// The social requests made since the last call, as method, path and
    /// the body parsed, each with the device's token.
    pub fn sent(&self) -> Vec<(Method, String, Value)> {
        let mut canned = self.canned.lock().unwrap();
        assert!(canned.answers.is_empty(), "every answer was asked for");
        canned
            .seen
            .drain(..)
            .map(|r| {
                assert_eq!(r.bearer.as_deref(), Some("token-a1"));
                let body = r
                    .body
                    .as_deref()
                    .map_or(Value::Null, |b| serde_json::from_str(b).unwrap());
                (r.method, r.path, body)
            })
            .collect()
    }
}

pub fn author(account: &str) -> Value {
    json!({ "accountId": account, "name": "Sigrún Jónsdóttir", "verified": true })
}
