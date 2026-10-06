//! A device's identity and its groups (decision 0018). Every function takes a
//! `Provider` built inside `Store::write`, so what it changes commits or rolls
//! back with the rest of that transaction. Nothing here touches the network:
//! the bytes it returns are what the client seals into its outbox, and the
//! bytes it takes are what the server stored.

use crate::CIPHERSUITE;
use crate::storage::{Provider, StorageError};
use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_traits::types::AeadType;

/// How many epochs back a member can still read an application message. The
/// server stores one made just before a commit it orders after (0017).
pub const MAX_PAST_EPOCHS: usize = 5;

/// The length of a group id this core creates.
const GROUP_ID_LEN: usize = 32;

const TYPING_LABEL: &str = "spjall typing";
const TYPING_KEY_LEN: usize = 16;
const TYPING_NONCE_LEN: usize = 12;

#[derive(Debug, thiserror::Error)]
pub enum GroupError {
    #[error("the store failed: {0}")]
    Storage(#[from] StorageError),
    #[error("not in the store: {0}")]
    Missing(&'static str),
    #[error("malformed {0}")]
    Malformed(&'static str),
    /// A credential that does not name an account and a device (0018).
    #[error("a credential does not name an account and a device")]
    Credential,
    /// A claimed KeyPackage that does not name the device it was claimed for.
    #[error("a KeyPackage does not name the device it was claimed for")]
    NotTheClaimedDevice,
    #[error("a device is already in the group")]
    AlreadyMember,
    #[error("an own commit is in flight")]
    CommitInFlight,
    /// Leaving a group is not built yet (0018).
    #[error("a device cannot remove its own account")]
    OwnAccount,
    /// The message is on an epoch this device does not hold.
    #[error("the message is on epoch {message}, the group is on {group}")]
    Epoch { message: u64, group: u64 },
    #[error("OpenMLS refused at {step}: {detail}")]
    Mls { step: &'static str, detail: String },
}

fn at<E: std::fmt::Debug>(step: &'static str) -> impl FnOnce(E) -> GroupError {
    move |error| GroupError::Mls {
        step,
        detail: format!("{error:?}"),
    }
}

fn is_id(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// One leaf: a device of an account. Its credential's identity is
/// `{accountId}/{deviceId}` (0018).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Device {
    pub account: String,
    pub device: String,
}

impl Device {
    pub fn new(account: &str, device: &str) -> Result<Self, GroupError> {
        if !is_id(account) || !is_id(device) {
            return Err(GroupError::Credential);
        }
        Ok(Self {
            account: account.to_owned(),
            device: device.to_owned(),
        })
    }

    pub fn identity(&self) -> String {
        format!("{}/{}", self.account, self.device)
    }

    fn from_credential(credential: &Credential) -> Result<Self, GroupError> {
        let basic =
            BasicCredential::try_from(credential.clone()).map_err(|_| GroupError::Credential)?;
        let identity = std::str::from_utf8(basic.identity()).map_err(|_| GroupError::Credential)?;
        let (account, device) = identity.split_once('/').ok_or(GroupError::Credential)?;
        Self::new(account, device)
    }
}

/// Makes a new device key pair and keeps it in the store. Its public key is
/// what `POST /v1/devices` registers (0014).
pub fn generate_device_key(provider: &Provider) -> Result<Vec<u8>, GroupError> {
    let signer =
        SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(at("device key"))?;
    signer.store(provider.storage())?;
    Ok(signer.to_public_vec())
}

/// This device: its key pair and the credential the server registered.
pub struct Identity {
    signer: SignatureKeyPair,
    device: Device,
}

impl Identity {
    pub fn load(
        provider: &Provider,
        public_key: &[u8],
        device: Device,
    ) -> Result<Self, GroupError> {
        let signer = SignatureKeyPair::read(
            provider.storage(),
            public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .ok_or(GroupError::Missing("device key"))?;
        Ok(Self { signer, device })
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    fn credential(&self) -> CredentialWithKey {
        CredentialWithKey {
            credential: BasicCredential::new(self.device.identity().into_bytes()).into(),
            signature_key: self.signer.to_public_vec().into(),
        }
    }

    fn key_package(&self, provider: &Provider, last_resort: bool) -> Result<Vec<u8>, GroupError> {
        // An extension in a KeyPackage must be in its leaf's capabilities,
        // so every package advertises LastResort, whether marked or not.
        let mut builder = KeyPackage::builder().leaf_node_capabilities(
            Capabilities::builder()
                .extensions(vec![ExtensionType::LastResort])
                .build(),
        );
        if last_resort {
            builder = builder.mark_as_last_resort();
        }
        let bundle = builder
            .build(CIPHERSUITE, provider, &self.signer, self.credential())
            .map_err(at("key package"))?;
        let message: MlsMessageOut = bundle.key_package().clone().into();
        message.tls_serialize_detached().map_err(at("key package"))
    }

    /// `n` KeyPackages to upload, each an MLSMessage. Each is consumed by the
    /// first claim that gets it, and its private key by the Welcome that uses it.
    pub fn key_packages(&self, provider: &Provider, n: usize) -> Result<Vec<Vec<u8>>, GroupError> {
        (0..n).map(|_| self.key_package(provider, false)).collect()
    }

    /// The KeyPackage a claim returns when this device has no other; never
    /// consumed (0017), so its private key stays after a join.
    pub fn last_resort(&self, provider: &Provider) -> Result<Vec<u8>, GroupError> {
        self.key_package(provider, true)
    }
}

/// A KeyPackage claimed for one device of an account.
pub struct Claimed {
    pub device: Device,
    pub key_package: Vec<u8>,
}

/// What a commit tells the server, in its signed `authenticated_data`
/// (0020): every account in the group once it is merged, and the accounts
/// its Welcome is for. Both sorted, without repeats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    pub roster: Vec<String>,
    pub welcome: Vec<String>,
}

impl Claim {
    /// Sorted and without repeats, as every member writes and compares it.
    pub fn new(roster: Vec<String>, welcome: Vec<String>) -> Self {
        let tidy = |mut accounts: Vec<String>| {
            accounts.sort();
            accounts.dedup();
            accounts
        };
        Self {
            roster: tidy(roster),
            welcome: tidy(welcome),
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        serde_json::json!({ "roster": self.roster, "welcome": self.welcome })
            .to_string()
            .into_bytes()
    }

    /// `None` for anything but the JSON `encode` writes.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
        let accounts = |key: &str| -> Option<Vec<String>> {
            value
                .get(key)?
                .as_array()?
                .iter()
                .map(|a| a.as_str().filter(|a| is_id(a)).map(str::to_owned))
                .collect()
        };
        Some(Self::new(accounts("roster")?, accounts("welcome")?))
    }

    /// What this device makes the next commit claim instead; for tests of 0020.
    #[cfg(feature = "forge")]
    fn forged(self) -> Self {
        forge::NEXT
            .with(|next| next.borrow_mut().take())
            .unwrap_or(self)
    }

    #[cfg(not(feature = "forge"))]
    fn forged(self) -> Self {
        self
    }
}

/// A member that lies, for tests of 0020: the next commit made on this
/// thread claims the given roster, whatever it does.
#[cfg(feature = "forge")]
pub mod forge {
    use std::cell::RefCell;

    thread_local! {
        pub(super) static NEXT: RefCell<Option<super::Claim>> = const { RefCell::new(None) };
    }

    pub fn next_claim(roster: &[&str], welcome: &[&str]) {
        let owned = |accounts: &[&str]| accounts.iter().map(|a| (*a).to_owned()).collect();
        NEXT.with(|next| {
            *next.borrow_mut() = Some(super::Claim::new(owned(roster), owned(welcome)));
        });
    }
}

/// The claim a stored commit carries, read from its framing alone (RFC 9420
/// §6), as the server reads it; `None` for anything but a commit with one.
pub fn claim_of(bytes: &[u8]) -> Option<Claim> {
    struct Reader<'a>(&'a [u8]);
    impl<'a> Reader<'a> {
        fn take(&mut self, n: usize) -> Option<&'a [u8]> {
            let (head, rest) = self.0.split_at_checked(n)?;
            self.0 = rest;
            Some(head)
        }
        fn uint(&mut self, n: usize) -> Option<u64> {
            Some(
                self.take(n)?
                    .iter()
                    .fold(0, |v, b| (v << 8) | u64::from(*b)),
            )
        }
        fn vector(&mut self) -> Option<&'a [u8]> {
            let first = *self.0.first()?;
            let length = match first >> 6 {
                0 => self.uint(1)?,
                1 => self.uint(2)? & 0x3fff,
                2 => self.uint(4)? & 0x3fff_ffff,
                _ => return None,
            };
            self.take(usize::try_from(length).ok()?)
        }
    }
    const COMMIT: u64 = 3;
    let mut reader = Reader(bytes);
    if reader.uint(2)? != 1 {
        return None;
    }
    let wire = reader.uint(2)?;
    reader.vector()?; // group_id
    reader.uint(8)?; // epoch
    let aad = match wire {
        // PublicMessage: the sender, then authenticated_data, then the content type.
        1 => {
            match reader.uint(1)? {
                1 | 2 => drop(reader.uint(4)?),
                3 | 4 => {}
                _ => return None,
            }
            let aad = reader.vector()?;
            (reader.uint(1)? == COMMIT).then_some(aad)?
        }
        // PrivateMessage: the content type, then authenticated_data.
        2 => {
            (reader.uint(1)? == COMMIT).then_some(())?;
            reader.vector()?
        }
        _ => return None,
    };
    Claim::decode(aad)
}

/// An own commit, ready to seal into the outbox. Its claim is in its
/// `authenticated_data` (0020).
#[derive(Debug)]
pub struct Commit {
    pub message: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
    /// The accounts this commit adds, which were not in the group.
    pub added: Vec<String>,
    /// The accounts this commit removes the last device of.
    pub removed: Vec<String>,
    pub claim: Claim,
    /// The GroupInfo of the epoch this commit starts, with the ratchet tree
    /// and the external public key: what a device joins from (0021).
    pub group_info: Vec<u8>,
}

/// What a stored message turned out to be.
#[derive(Debug)]
pub enum Received {
    Application {
        sender: Device,
        plaintext: Vec<u8>,
    },
    Commit {
        by: Device,
        added: Vec<Device>,
        removed: Vec<Device>,
        /// This device was removed: the group is over for it.
        removed_self: bool,
        /// What the commit told the server, if it carried a claim.
        claim: Option<Claim>,
        /// The claim names the group as MLS now holds it, and the Welcome
        /// the accounts this commit added devices of (0020).
        backed: bool,
        /// The new devices of accounts already in the group, from a Welcome
        /// or the external commit one joined by: the "new device" of 0006
        /// (0021). A new account's devices are in `added` only.
        joined: Vec<Device>,
    },
    /// A standalone proposal. This core never sends one and commits none.
    Proposal,
    /// A message this device sent.
    Own,
}

fn create_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .max_past_epochs(MAX_PAST_EPOCHS)
        .build()
}

fn accounts(devices: impl IntoIterator<Item = Device>) -> Vec<String> {
    let mut accounts: Vec<String> = devices.into_iter().map(|d| d.account).collect();
    accounts.sort();
    accounts.dedup();
    accounts
}

fn mls_message(bytes: &[u8], what: &'static str) -> Result<MlsMessageIn, GroupError> {
    MlsMessageIn::tls_deserialize_exact(bytes).map_err(|_| GroupError::Malformed(what))
}

fn group_info_bytes(
    group_info: Option<openmls::messages::group_info::GroupInfo>,
) -> Result<Vec<u8>, GroupError> {
    let group_info = group_info.ok_or(GroupError::Missing("GroupInfo"))?;
    MlsMessageOut::from(group_info)
        .tls_serialize_detached()
        .map_err(at("GroupInfo"))
}

/// Whether stored bytes are a commit, read from their framing alone: what
/// the client needs to know of a message it could not process.
pub fn is_commit(bytes: &[u8]) -> bool {
    mls_message(bytes, "message")
        .ok()
        .and_then(|message| message.try_into_protocol_message().ok())
        .is_some_and(|message| message.content_type() == ContentType::Commit)
}

pub struct Group(MlsGroup);

impl Group {
    /// A new group with this device as its only member, under a random
    /// 32-byte id, which is also the conversation's id (0017).
    pub fn create(provider: &Provider, identity: &Identity) -> Result<Self, GroupError> {
        let id = provider
            .rand()
            .random_vec(GROUP_ID_LEN)
            .map_err(at("group id"))?;
        MlsGroup::builder()
            .with_group_id(GroupId::from_slice(&id))
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(MAX_PAST_EPOCHS)
            .build(provider, &identity.signer, identity.credential())
            .map(Self)
            .map_err(at("create"))
    }

    pub fn load(provider: &Provider, id: &[u8]) -> Result<Self, GroupError> {
        MlsGroup::load(provider.storage(), &GroupId::from_slice(id))?
            .map(Self)
            .ok_or(GroupError::Missing("group"))
    }

    /// Joins from a Welcome. Every leaf must name an account and a device,
    /// or the group is refused before anything is kept.
    pub fn join(provider: &Provider, welcome: &[u8]) -> Result<Self, GroupError> {
        let MlsMessageBodyIn::Welcome(welcome) = mls_message(welcome, "Welcome")?.extract() else {
            return Err(GroupError::Malformed("Welcome"));
        };
        let staged =
            StagedWelcome::new_from_welcome(provider, create_config().join_config(), welcome, None)
                .map_err(at("welcome"))?;
        if staged.group_context().ciphersuite() != CIPHERSUITE {
            return Err(GroupError::Malformed("ciphersuite"));
        }
        for member in staged.members() {
            Device::from_credential(&member.credential)?;
        }
        staged.into_group(provider).map(Self).map_err(at("join"))
    }

    /// Joins from a GroupInfo by an external commit (RFC 9420 §12.4.3.2,
    /// 0021). A leaf this device already holds, by its signature key, is
    /// removed in the same commit. The group is kept on the epoch the commit
    /// starts, before the server has it: if the server refuses the commit,
    /// the caller deletes it. The claim is every account in the tree, this
    /// one included, and no Welcome.
    pub fn join_external(
        provider: &Provider,
        identity: &Identity,
        group_info: &[u8],
    ) -> Result<(Self, Commit), GroupError> {
        let MlsMessageBodyIn::GroupInfo(group_info) =
            mls_message(group_info, "GroupInfo")?.extract()
        else {
            return Err(GroupError::Malformed("GroupInfo"));
        };
        if group_info.ciphersuite() != CIPHERSUITE {
            return Err(GroupError::Malformed("ciphersuite"));
        }
        let tree = group_info
            .extensions()
            .ratchet_tree()
            .ok_or(GroupError::Malformed("GroupInfo without a ratchet tree"))?;
        let mut roster = vec![identity.device.account.clone()];
        for leaf in tree.ratchet_tree().leaves() {
            roster.push(Device::from_credential(leaf.credential())?.account);
        }
        let claim = Claim::new(roster, Vec::new()).forged();
        let (group, bundle) = MlsGroup::external_commit_builder()
            .with_config(create_config().join_config().clone())
            .with_aad(claim.encode())
            .build_group(provider, group_info, identity.credential())
            .map_err(at("external join"))?
            .load_psks(provider.storage())
            .map_err(at("external join"))?
            .build(provider.rand(), provider.crypto(), &identity.signer, |_| {
                true
            })
            .map_err(at("external join"))?
            .finalize(provider)
            .map_err(at("external join"))?;
        let group = Self(group);
        let (message, _, group_info) = bundle.into_contents();
        let commit = Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: None,
            added: Vec::new(),
            removed: Vec::new(),
            claim,
            group_info: group_info_bytes(group_info)?,
        };
        Ok((group, commit))
    }

    /// Forgets this group: a stale device rejoins as a new leaf (0021).
    pub fn delete(mut self, provider: &Provider) -> Result<(), GroupError> {
        self.0.delete(provider.storage())?;
        Ok(())
    }

    pub fn id(&self) -> &[u8] {
        self.0.group_id().as_slice()
    }

    pub fn epoch(&self) -> u64 {
        self.0.epoch().as_u64()
    }

    /// Every leaf, in leaf order.
    pub fn devices(&self) -> Result<Vec<Device>, GroupError> {
        self.0
            .members()
            .map(|m| Device::from_credential(&m.credential))
            .collect()
    }

    pub fn has_pending_commit(&self) -> bool {
        self.0.pending_commit().is_some()
    }

    fn check_no_commit_in_flight(&self) -> Result<(), GroupError> {
        if self.has_pending_commit() {
            Err(GroupError::CommitInFlight)
        } else {
            Ok(())
        }
    }

    /// A commit adding every claimed device, with the Welcome for them. Each
    /// KeyPackage must be valid, on the pinned suite, and name the device it
    /// was claimed for (0018). The commit stays pending until merged.
    pub fn add(
        &mut self,
        provider: &Provider,
        identity: &Identity,
        claimed: &[Claimed],
    ) -> Result<Commit, GroupError> {
        self.check_no_commit_in_flight()?;
        let before = self.devices()?;
        let mut packages = Vec::with_capacity(claimed.len());
        for claim in claimed {
            let MlsMessageBodyIn::KeyPackage(package) =
                mls_message(&claim.key_package, "KeyPackage")?.extract()
            else {
                return Err(GroupError::Malformed("KeyPackage"));
            };
            let package = package
                .validate(provider.crypto(), ProtocolVersion::Mls10)
                .map_err(|_| GroupError::Malformed("KeyPackage"))?;
            if package.ciphersuite() != CIPHERSUITE {
                return Err(GroupError::Malformed("KeyPackage"));
            }
            if Device::from_credential(package.leaf_node().credential())? != claim.device {
                return Err(GroupError::NotTheClaimedDevice);
            }
            if before.contains(&claim.device) {
                return Err(GroupError::AlreadyMember);
            }
            packages.push(package);
        }
        let present = accounts(before);
        let welcome_to = accounts(claimed.iter().map(|c| c.device.clone()));
        let claim = Claim::new(
            present.iter().chain(&welcome_to).cloned().collect(),
            welcome_to.clone(),
        )
        .forged();
        self.0.set_aad(claim.encode());
        let (message, welcome, group_info) = self
            .0
            .add_members(provider, &identity.signer, &packages)
            .map_err(at("add"))?;
        Ok(Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: Some(welcome.tls_serialize_detached().map_err(at("welcome"))?),
            added: welcome_to
                .into_iter()
                .filter(|a| !present.contains(a))
                .collect(),
            removed: Vec::new(),
            claim,
            group_info: group_info_bytes(group_info)?,
        })
    }

    /// A commit removing every device of these accounts. Removing one's own
    /// account would be leaving, which is not built yet (0018).
    pub fn remove(
        &mut self,
        provider: &Provider,
        identity: &Identity,
        remove: &[String],
    ) -> Result<Commit, GroupError> {
        self.check_no_commit_in_flight()?;
        if remove.contains(&identity.device.account) {
            return Err(GroupError::OwnAccount);
        }
        let mut leaves = Vec::new();
        for member in self.0.members() {
            if remove.contains(&Device::from_credential(&member.credential)?.account) {
                leaves.push(member.index);
            }
        }
        if leaves.is_empty() {
            return Err(GroupError::Missing("account in the group"));
        }
        let mut removed = remove.to_vec();
        removed.sort();
        removed.dedup();
        let roster = accounts(self.devices()?)
            .into_iter()
            .filter(|a| !removed.contains(a))
            .collect();
        let claim = Claim::new(roster, Vec::new()).forged();
        self.0.set_aad(claim.encode());
        let (message, _, group_info) = self
            .0
            .remove_members(provider, &identity.signer, &leaves)
            .map_err(at("remove"))?;
        Ok(Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: None,
            added: Vec::new(),
            removed,
            claim,
            group_info: group_info_bytes(group_info)?,
        })
    }

    /// A commit that changes no one, to tell the server the roster MLS
    /// holds after another member's claim was not backed (0020).
    pub fn correct(
        &mut self,
        provider: &Provider,
        identity: &Identity,
    ) -> Result<Commit, GroupError> {
        self.check_no_commit_in_flight()?;
        let claim = Claim::new(accounts(self.devices()?), Vec::new()).forged();
        self.0.set_aad(claim.encode());
        let (message, _, group_info) = self
            .0
            .self_update(provider, &identity.signer, LeafNodeParameters::default())
            .map_err(at("correct"))?
            .into_contents();
        Ok(Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: None,
            added: Vec::new(),
            removed: Vec::new(),
            claim,
            group_info: group_info_bytes(group_info)?,
        })
    }

    /// The server stored our commit: it is this group's next epoch.
    pub fn merge_pending_commit(&mut self, provider: &Provider) -> Result<(), GroupError> {
        self.0
            .merge_pending_commit(provider)
            .map_err(at("merge pending"))
    }

    /// The server refused our commit for its epoch: forget it.
    pub fn clear_pending_commit(&mut self, provider: &Provider) -> Result<(), GroupError> {
        self.0
            .clear_pending_commit(provider.storage())
            .map_err(GroupError::Storage)
    }

    /// An application message on the current epoch.
    pub fn encrypt(
        &mut self,
        provider: &Provider,
        identity: &Identity,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, GroupError> {
        self.check_no_commit_in_flight()?;
        self.0
            .create_message(provider, &identity.signer, plaintext)
            .map_err(at("encrypt"))?
            .tls_serialize_detached()
            .map_err(at("encrypt"))
    }

    /// Reads one stored message from another device. A commit is merged
    /// here; the caller stores what the message said in the same transaction.
    pub fn process(&mut self, provider: &Provider, bytes: &[u8]) -> Result<Received, GroupError> {
        let message = mls_message(bytes, "message")?
            .try_into_protocol_message()
            .map_err(|_| GroupError::Malformed("message"))?;
        if message.group_id() != self.0.group_id() {
            return Err(GroupError::Malformed("group id"));
        }
        let (epoch, group) = (message.epoch().as_u64(), self.epoch());
        let held = epoch <= group && group - epoch <= MAX_PAST_EPOCHS as u64;
        let current = epoch == group;
        if !held || (message.content_type() != ContentType::Application && !current) {
            return Err(GroupError::Epoch {
                message: epoch,
                group,
            });
        }
        let processed = self
            .0
            .process_message(provider, message)
            .map_err(at("process"))?;
        let credential = processed.credential().clone();
        let claim = Claim::decode(processed.aad());
        let sender = || Device::from_credential(&credential);
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => Ok(Received::Application {
                sender: sender()?,
                plaintext: application.into_bytes(),
            }),
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                let before = self.devices()?;
                let added = staged
                    .add_proposals()
                    .map(|p| {
                        Device::from_credential(
                            p.add_proposal().key_package().leaf_node().credential(),
                        )
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let removed = staged
                    .remove_proposals()
                    .map(|p| {
                        self.0
                            .member(p.remove_proposal().removed())
                            .ok_or(GroupError::Missing("removed leaf"))
                            .and_then(Device::from_credential)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let removed_self = staged.self_removed();
                self.0
                    .merge_staged_commit(provider, *staged)
                    .map_err(at("merge"))?;
                let after = if removed_self {
                    Vec::new()
                } else {
                    self.devices()?
                };
                let joined = after
                    .iter()
                    .filter(|d| !before.contains(d))
                    .filter(|d| before.iter().any(|b| b.account == d.account))
                    .cloned()
                    .collect();
                // A device that rejoined lost its old leaf for a new one: it
                // was not removed.
                let removed: Vec<Device> =
                    removed.into_iter().filter(|d| !after.contains(d)).collect();
                let backed = claim.as_ref().is_some_and(|claim| {
                    // A removed device holds no group to compare with.
                    removed_self
                        || (claim.roster == accounts(after.iter().cloned())
                            && claim.welcome == accounts(added.iter().cloned()))
                });
                Ok(Received::Commit {
                    by: sender()?,
                    added,
                    removed,
                    removed_self,
                    claim,
                    backed,
                    joined,
                })
            }
            ProcessedMessageContent::ProposalMessage(_)
            | ProcessedMessageContent::ExternalJoinProposalMessage(_) => {
                // Never committed by this core; drop it so it cannot linger.
                self.0
                    .clear_pending_proposals(provider.storage())
                    .map_err(GroupError::Storage)?;
                Ok(Received::Proposal)
            }
            // The client knows its own messages by their seq and never
            // passes one here (0018); should one come, it is skipped.
            ProcessedMessageContent::OwnPendingCommit
            | ProcessedMessageContent::OwnPrivateMessage => Ok(Received::Own),
        }
    }

    fn typing_key(&self, provider: &Provider) -> Result<Vec<u8>, GroupError> {
        self.0
            .export_secret(provider.crypto(), TYPING_LABEL, &[], TYPING_KEY_LEN)
            .map_err(at("typing key"))
    }

    fn typing_aad(&self, epoch: u64) -> Vec<u8> {
        let mut aad = self.id().to_vec();
        aad.extend_from_slice(&epoch.to_be_bytes());
        aad
    }

    /// Seals a typing indicator under a key exported from this epoch, off the
    /// message ratchet (0018): the epoch, a random nonce, then the AEAD output.
    pub fn seal_typing(
        &self,
        provider: &Provider,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, GroupError> {
        let epoch = self.epoch();
        let nonce = provider
            .rand()
            .random_vec(TYPING_NONCE_LEN)
            .map_err(at("typing nonce"))?;
        let sealed = provider
            .crypto()
            .aead_encrypt(
                AeadType::Aes128Gcm,
                &self.typing_key(provider)?,
                plaintext,
                &nonce,
                &self.typing_aad(epoch),
            )
            .map_err(at("typing seal"))?;
        let mut out = epoch.to_be_bytes().to_vec();
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    /// Opens a typing indicator sealed on the current epoch; one from any
    /// other epoch, or tampered with, is `None`. It changes no state.
    pub fn open_typing(&self, provider: &Provider, sealed: &[u8]) -> Option<Vec<u8>> {
        let (epoch, rest) = sealed.split_first_chunk::<8>()?;
        let epoch = u64::from_be_bytes(*epoch);
        if epoch != self.epoch() || rest.len() < TYPING_NONCE_LEN {
            return None;
        }
        let (nonce, ciphertext) = rest.split_at(TYPING_NONCE_LEN);
        provider
            .crypto()
            .aead_decrypt(
                AeadType::Aes128Gcm,
                &self.typing_key(provider).ok()?,
                ciphertext,
                nonce,
                &self.typing_aad(epoch),
            )
            .ok()
    }
}
