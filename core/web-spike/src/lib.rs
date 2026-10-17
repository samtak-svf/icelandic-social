//! One MLS device over the core's own crates, the same on both sides of the
//! spike: compiled to wasm32 it is the browser (`web`), compiled natively it
//! is the peer `bin/native.rs` drives. Messages travel as the bytes the
//! server would store, and every text is a `spjall_envelope` text message.

use std::path::Path;

use spjall_envelope::{Body, Envelope};
use spjall_mls::group::{Claimed, Device, Group, Identity, Received, generate_device_key};
use spjall_mls::storage::Provider;
use spjall_store::{Store, rusqlite};

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
mod web;

/// The spike's store key. The spike is about whether MLS runs, not about
/// keeping a key: docs/web-client-feasibility.md has the key question.
const KEY: [u8; 32] = [7; 32];

pub type Error = Box<dyn std::error::Error>;

pub struct Peer {
    store: Store,
    public_key: Vec<u8>,
    device: Device,
    group: Option<Vec<u8>>,
}

impl Peer {
    /// A new device with a new key in a new store under `dir`.
    pub fn create(dir: &Path, account: &str, device: &str) -> Result<Self, Error> {
        let mut store = Store::open(dir, &KEY)?;
        let public_key = store.try_write(|tx| {
            generate_device_key(&Provider::new(tx)).map_err(|e| Box::new(e) as Error)
        })?;
        Ok(Self {
            store,
            public_key,
            device: Device::new(account, device)?,
            group: None,
        })
    }

    /// A device `create` made earlier, from what `public_key` and `group` said.
    pub fn open(
        dir: &Path,
        account: &str,
        device: &str,
        public_key: Vec<u8>,
        group: Option<Vec<u8>>,
    ) -> Result<Self, Error> {
        Ok(Self {
            store: Store::open(dir, &KEY)?,
            public_key,
            device: Device::new(account, device)?,
            group,
        })
    }

    pub fn public_key(&self) -> &[u8] {
        &self.public_key
    }

    pub fn group(&self) -> Option<&[u8]> {
        self.group.as_deref()
    }

    /// Whether the store's file is encrypted: SQLCipher answers
    /// `cipher_version`, plain SQLite answers nothing and ignores `PRAGMA key`.
    pub fn store_is_encrypted(&mut self) -> Result<bool, Error> {
        Ok(self.store.write(|tx| {
            tx.query_row("PRAGMA cipher_version", [], |_| Ok(()))
                .map(|()| true)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(false),
                    e => Err(e),
                })
        })?)
    }

    fn with<T>(
        &mut self,
        f: impl FnOnce(&Provider, &Identity) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let (public_key, device) = (self.public_key.clone(), self.device.clone());
        self.store.try_write(|tx| {
            let provider = Provider::new(tx);
            let identity = Identity::load(&provider, &public_key, device)?;
            f(&provider, &identity)
        })
    }

    pub fn key_package(&mut self) -> Result<Vec<u8>, Error> {
        self.with(|p, id| Ok(id.key_packages(p, 1)?.remove(0)))
    }

    /// Creates a group and adds the device that published `key_package`;
    /// returns the Welcome for it.
    pub fn invite(
        &mut self,
        account: &str,
        device: &str,
        key_package: Vec<u8>,
    ) -> Result<Vec<u8>, Error> {
        let claimed = Claimed {
            device: Device::new(account, device)?,
            key_package,
        };
        let (group, welcome) = self.with(|p, id| {
            let mut group = Group::create(p, id)?;
            let commit = group.add(p, id, &[claimed])?;
            group.merge_pending_commit(p)?;
            Ok((group.id().to_vec(), commit.welcome.ok_or("no Welcome")?))
        })?;
        self.group = Some(group);
        Ok(welcome)
    }

    pub fn join(&mut self, welcome: &[u8]) -> Result<(), Error> {
        let group = self.with(|p, _| Ok(Group::join(p, welcome)?.id().to_vec()))?;
        self.group = Some(group);
        Ok(())
    }

    /// `text` as an envelope sealed for the group.
    pub fn send(&mut self, id: &str, ts: u64, text: &str) -> Result<Vec<u8>, Error> {
        let envelope = Envelope {
            id: id.to_owned(),
            ts,
            body: Body::Text {
                text: text.to_owned(),
                forwarded: false,
            },
        }
        .encode()?;
        let group = self.group.clone().ok_or("no group")?;
        self.with(|p, id| Ok(Group::load(p, &group)?.encrypt(p, id, &envelope)?))
    }

    /// The sender's identity and the text of an application message.
    pub fn receive(&mut self, message: &[u8]) -> Result<(String, String), Error> {
        let group = self.group.clone().ok_or("no group")?;
        let received = self.with(|p, _| Ok(Group::load(p, &group)?.process(p, message)?))?;
        let Received::Application { sender, plaintext } = received else {
            return Err("not an application message".into());
        };
        match Envelope::decode(&plaintext)?.body {
            Body::Text { text, .. } => Ok((sender.identity(), text)),
            _ => Err("not a text".into()),
        }
    }
}
