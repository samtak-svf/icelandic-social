//! One MLS device over the core's own crates, the same on both sides of the
//! spike: compiled to wasm32 it is the browser (`web`), compiled natively it
//! is the peer `bin/native.rs` drives. Messages travel as the bytes the
//! server would store, and every text is a `spjall_envelope` text message.

use std::path::Path;

use spjall_envelope::{Body, Envelope};
use spjall_mls::group::{Claimed, Device, Group, Identity, Received, generate_device_key};
use spjall_mls::storage::Provider;
use spjall_store::{Store, rusqlite};

pub mod relay;
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

/// The text the history export carries, for the browser to find.
pub const HISTORY_TEXT: &str = "Saga úr Rust";
/// The photo it carries.
pub const HISTORY_PHOTO: &[u8] = b"mynd sem fylgir sogunni";

fn client(
    relay: &std::sync::Arc<std::sync::Mutex<relay::MiniRelay>>,
    store: &str,
    account: &str,
    device: &str,
) -> Result<
    (
        spjall_client::Client<relay::WorkerTransport>,
        spjall_client::MemBlobs,
    ),
    Error,
> {
    let blobs = spjall_client::MemBlobs::new();
    let transport = relay::WorkerTransport {
        account: account.into(),
        device: device.into(),
        blobs: blobs.clone(),
        relay: std::sync::Arc::clone(relay),
    };
    let mut client = spjall_client::Client::open_with_blobs(
        Path::new(store),
        &KEY,
        transport,
        Box::new(blobs.clone()),
    )?;
    client.enrol_linked(account, device, &format!("tok_{device}"))?;
    Ok((client, blobs))
}

/// The phone's half of 0064: `a_alice` talks with `a_bob`, sends a text and
/// a photo, and seals that history to `recipient`. Returns the sealed bytes.
pub fn export_history(dir: &Path, recipient: &[u8]) -> Result<Vec<u8>, Error> {
    let relay = std::sync::Arc::default();
    let at = |name: &str| dir.join(name).to_string_lossy().into_owned();
    let (mut alice, blobs) = client(&relay, &at("alice"), "a_alice", "d_1")?;
    let (mut bob, _) = client(&relay, &at("bob"), "a_bob", "d_2")?;
    bob.stock_key_packages(2)?;
    let conversation = alice.create_conversation(&["a_bob".into()])?;
    alice.send(
        &conversation,
        Body::Text {
            text: HISTORY_TEXT.into(),
            forwarded: false,
        },
    )?;
    let photo = Path::new("upload/mynd.webp");
    blobs.put(photo, HISTORY_PHOTO.to_vec());
    alice.send_media(&conversation, photo, "image/webp", None, None)?;
    alice.sync()?;
    let out = Path::new("history");
    alice.export_history(None, recipient, out)?;
    Ok(blobs.get(out).ok_or("no history written")?)
}

/// The linked device's half: a new `a_alice` device with nothing on the
/// relay opens `sealed` and shows the conversation. Returns the texts and
/// whether the photo opened from the history alone.
pub fn import_history(
    dir: &Path,
    sealed: &[u8],
    private: &[u8],
) -> Result<(Vec<String>, bool), Error> {
    let relay = std::sync::Arc::default();
    let (mut client, blobs) = client(&relay, &dir.to_string_lossy(), "a_alice", "d_9")?;
    let from = Path::new("history");
    blobs.put(from, sealed.to_vec());
    let imported = client.import_history(from, private)?;
    if imported.conversations != 1 || imported.files != 1 {
        return Err(format!("imported {imported:?}").into());
    }
    let conversation = client.conversations()?.remove(0).id;
    let mut texts = Vec::new();
    let mut photo = false;
    for item in client.view()?.timeline(&conversation, None, 20)? {
        match item.content {
            spjall_client::Content::Text { text, .. } => texts.push(text),
            spjall_client::Content::Media { .. } => {
                let path = client.media(&conversation, item.seq.ok_or("no seq")?)?;
                photo = blobs.get(&path).as_deref() == Some(HISTORY_PHOTO);
            }
            _ => {}
        }
    }
    Ok((texts, photo))
}
