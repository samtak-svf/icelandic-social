use std::sync::Arc;

use crate::relay::{Link, Relay};
use spjall_client::api::{Platform, Provider};
use spjall_client::{Client, Event};
use spjall_envelope::Body;
use tempfile::TempDir;

pub const KEY: [u8; 32] = [7; 32];

pub struct Phone {
    pub relay: Arc<Relay>,
    pub account: String,
    pub device: String,
    pub dir: TempDir,
    pub client: Client<Link>,
}

impl Phone {
    pub fn new(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        let mut phone = Self::unstocked(relay, account, device);
        assert_eq!(phone.client.stock_key_packages(3).unwrap(), 3);
        phone
    }

    /// Signed in, with no KeyPackages uploaded yet.
    pub fn unstocked(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut client = Client::open(dir.path(), &KEY, relay.link(account, device)).unwrap();
        let url = client.begin_sign_in(Provider::Kenni).unwrap();
        client
            .complete_sign_in(&crate::relay::kenni(&url), None, Platform::Android)
            .unwrap();
        Self {
            relay: relay.clone(),
            account: account.into(),
            device: device.into(),
            dir,
            client,
        }
    }

    /// The process died; the app starts again on the same store.
    pub fn reopen(&mut self) {
        let link = self.relay.link(&self.account, &self.device);
        self.client = Client::open(self.dir.path(), &KEY, link).unwrap();
    }

    /// The hourly device check falls due again (0028).
    pub fn an_hour_passes(&mut self) {
        let mut store = spjall_store::Store::open(self.dir.path(), &KEY).unwrap();
        store
            .write(|tx| {
                tx.execute(
                    "UPDATE conversations SET devices_checked_at = devices_checked_at - 3600000",
                    [],
                )
            })
            .unwrap();
    }

    pub fn forward(&self, frames: Vec<String>) {
        for frame in frames {
            self.relay.socket(&self.account, &frame);
        }
    }

    pub fn sync(&mut self) -> Vec<Event> {
        let outcome = self.client.sync().unwrap();
        self.forward(outcome.frames);
        outcome.events
    }

    /// Reads the socket until nothing is waiting on it.
    pub fn deliver(&mut self) -> Vec<Event> {
        let mut events = Vec::new();
        loop {
            let frames = self.relay.frames(&self.device);
            if frames.is_empty() {
                return events;
            }
            for frame in frames {
                let outcome = self.client.on_frame(&frame).unwrap();
                events.extend(outcome.events);
                self.forward(outcome.frames);
            }
        }
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

    /// `(sender account, text, own)` for the whole history.
    pub fn history(&mut self, conversation: &str) -> Vec<(String, String, bool)> {
        self.client
            .history(conversation, None, 100)
            .unwrap()
            .into_iter()
            .map(|m| {
                let Body::Text { text, .. } = m.envelope.body else {
                    panic!("not text");
                };
                (m.sender.account, text, m.own)
            })
            .collect()
    }
}
