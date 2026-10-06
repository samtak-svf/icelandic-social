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

/// An own commit, ready to seal into the outbox. `roster` and `welcome_to`
/// are what the server needs with it (0017).
#[derive(Debug)]
pub struct Commit {
    pub message: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
    /// The accounts this commit adds, which were not in the group.
    pub added: Vec<String>,
    /// The accounts this commit removes the last device of.
    pub removed: Vec<String>,
    /// The accounts whose devices this commit adds.
    pub welcome_to: Vec<String>,
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
        let (message, welcome, _) = self
            .0
            .add_members(provider, &identity.signer, &packages)
            .map_err(at("add"))?;
        let present = accounts(before);
        let welcome_to = accounts(claimed.iter().map(|c| c.device.clone()));
        Ok(Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: Some(welcome.tls_serialize_detached().map_err(at("welcome"))?),
            added: welcome_to
                .iter()
                .filter(|a| !present.contains(a))
                .cloned()
                .collect(),
            removed: Vec::new(),
            welcome_to,
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
        let (message, _, _) = self
            .0
            .remove_members(provider, &identity.signer, &leaves)
            .map_err(at("remove"))?;
        let mut removed = remove.to_vec();
        removed.sort();
        removed.dedup();
        Ok(Commit {
            message: message.tls_serialize_detached().map_err(at("commit"))?,
            welcome: None,
            added: Vec::new(),
            removed,
            welcome_to: Vec::new(),
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
        let sender = || Device::from_credential(&credential);
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => Ok(Received::Application {
                sender: sender()?,
                plaintext: application.into_bytes(),
            }),
            ProcessedMessageContent::StagedCommitMessage(staged) => {
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
                Ok(Received::Commit {
                    by: sender()?,
                    added,
                    removed,
                    removed_self,
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
