//! The MLS messages the backend's framing reader is tested against
//! (`api/fixtures/mls-framing.json`, decision 0017). The server reads only
//! the unencrypted framing of RFC 9420 §6: wire format, group id, epoch and
//! content type. These are real OpenMLS messages, so the TypeScript reader
//! and OpenMLS are held to the same bytes.
//!
//! `cargo test -p spjall-mls --test framing_fixture -- --ignored` writes the
//! file from a new scripted conversation; the other test checks the committed
//! file against OpenMLS on every run.

use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde_json::{Value, json};
use spjall_mls::CIPHERSUITE;
use spjall_mls::group::{Device, Identity, generate_device_key};
use spjall_mls::storage::Provider;
use spjall_store::Store;
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/fixtures/mls-framing.json")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

struct Member {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
}

impl Member {
    fn new(identity: &str) -> Self {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
        signer.store(provider.storage()).unwrap();
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Self {
            provider,
            signer,
            credential,
        }
    }

    fn key_package(&self) -> KeyPackage {
        KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .unwrap()
            .key_package()
            .clone()
    }
}

/// A KeyPackage made the way a device makes one (0018), with the account,
/// device and device key the server must find in it. The key is public, but
/// a field named for a key reads as a secret to gitleaks, so it is
/// `devicePublic`: the `deviceKey` of `POST /v1/devices`.
fn device_key_package() -> Value {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path(), &[7; 32]).unwrap();
    let device = Device::new("a_1", "d_1").unwrap();
    let (key, package) = store
        .write(|tx| {
            let provider = Provider::new(tx);
            let key = generate_device_key(&provider).unwrap();
            let identity = Identity::load(&provider, &key, device.clone()).unwrap();
            Ok((key, identity.key_packages(&provider, 1).unwrap().remove(0)))
        })
        .unwrap();
    json!({
        "hex": hex(&package),
        "wireFormat": 5,
        "accountId": device.account,
        "deviceId": device.device,
        "devicePublic": hex(&key),
    })
}

fn bytes(message: &MlsMessageOut) -> Vec<u8> {
    message.tls_serialize_detached().unwrap()
}

fn join(member: &Member, welcome: &MlsMessageOut, config: &MlsGroupCreateConfig) -> MlsGroup {
    let MlsMessageBodyIn::Welcome(welcome) = MlsMessageIn::tls_deserialize_exact(bytes(welcome))
        .unwrap()
        .extract()
    else {
        panic!("not a Welcome");
    };
    StagedWelcome::new_from_welcome(&member.provider, config.join_config(), welcome, None)
        .unwrap()
        .into_group(&member.provider)
        .unwrap()
}

/// One entry: the bytes and what the framing says about them.
fn protocol(
    name: &str,
    message: &MlsMessageOut,
    group: &GroupId,
    epoch: u64,
    content: u8,
) -> Value {
    let wire = match MlsMessageIn::tls_deserialize_exact(bytes(message))
        .unwrap()
        .wire_format()
    {
        WireFormat::PublicMessage => 1,
        WireFormat::PrivateMessage => 2,
        other => panic!("{other:?} is not a protocol message"),
    };
    json!({
        "name": name,
        "hex": hex(&bytes(message)),
        "wireFormat": wire,
        "groupId": hex(group.as_slice()),
        "epoch": epoch,
        "contentType": content,
    })
}

const APPLICATION: u8 = 1;
const PROPOSAL: u8 = 2;
const COMMIT: u8 = 3;

/// A scripted conversation between devices of two accounts, "a" and "b", on
/// the default (ciphertext) wire format, plus one commit as a PublicMessage.
fn conversation() -> Value {
    let a = Member::new("a/d1");
    let b = Member::new("b/d2");
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .build();
    let mut group_a = MlsGroup::new(&a.provider, &a.signer, &config, a.credential.clone()).unwrap();
    let id = group_a.group_id().clone();

    let package_b: MlsMessageOut = b.key_package().into();
    let MlsMessageBodyIn::KeyPackage(package_in) =
        MlsMessageIn::tls_deserialize_exact(bytes(&package_b))
            .unwrap()
            .extract()
    else {
        panic!("not a KeyPackage");
    };
    let package = package_in
        .validate(a.provider.crypto(), ProtocolVersion::Mls10)
        .unwrap();
    let (add, welcome, _) = group_a
        .add_members(&a.provider, &a.signer, std::slice::from_ref(&package))
        .unwrap();
    group_a.merge_pending_commit(&a.provider).unwrap();
    let mut group_b = join(&b, &welcome, &config);

    let hello = group_a
        .create_message(&a.provider, &a.signer, b"a1")
        .unwrap();
    let reply = group_b
        .create_message(&b.provider, &b.signer, b"b1")
        .unwrap();
    let proposal = group_b
        .propose_self_update(&b.provider, &b.signer, LeafNodeParameters::default())
        .unwrap()
        .0;
    group_b
        .clear_pending_proposals(b.provider.storage())
        .unwrap();

    // Both members commit on epoch 1 before seeing the other's commit: the
    // server must store exactly one of them (decision 0015).
    let update_a = group_a
        .self_update(&a.provider, &a.signer, LeafNodeParameters::default())
        .unwrap()
        .into_commit();
    let update_b = group_b
        .self_update(&b.provider, &b.signer, LeafNodeParameters::default())
        .unwrap()
        .into_commit();

    // Another group whose handshake messages travel in the clear.
    let public = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .wire_format_policy(PURE_PLAINTEXT_WIRE_FORMAT_POLICY)
        .use_ratchet_tree_extension(true)
        .build();
    let c = Member::new("c/d3");
    let mut group_c = MlsGroup::new(&c.provider, &c.signer, &public, c.credential.clone()).unwrap();
    let (public_add, _, _) = group_c
        .add_members(&c.provider, &c.signer, &[Member::new("d/d4").key_package()])
        .unwrap();

    json!({
        "about": "Generated by core/mls/tests/framing_fixture.rs; do not edit.",
        "ciphersuite": u16::from(CIPHERSUITE),
        "keyPackage": device_key_package(),
        "welcome": { "hex": hex(&bytes(&welcome)), "wireFormat": 3 },
        "messages": [
            protocol("add b", &add, &id, 0, COMMIT),
            protocol("a to b", &hello, &id, 1, APPLICATION),
            protocol("b to a", &reply, &id, 1, APPLICATION),
            protocol("b proposes", &proposal, &id, 1, PROPOSAL),
            protocol("a updates", &update_a, &id, 1, COMMIT),
            protocol("b updates", &update_b, &id, 1, COMMIT),
            protocol("public add", &public_add, group_c.group_id(), 0, COMMIT),
        ],
    })
}

#[test]
#[ignore = "writes api/fixtures/mls-framing.json"]
fn write_the_fixture() {
    let text = serde_json::to_string_pretty(&conversation()).unwrap();
    std::fs::create_dir_all(fixture_path().parent().unwrap()).unwrap();
    std::fs::write(fixture_path(), text + "\n").unwrap();
}

#[test]
fn the_fixture_matches_openmls() {
    let text = std::fs::read_to_string(fixture_path()).unwrap();
    let fixture: Value = serde_json::from_str(&text).unwrap();
    let message = |entry: &Value| {
        MlsMessageIn::tls_deserialize_exact(unhex(entry["hex"].as_str().unwrap())).unwrap()
    };

    assert_eq!(fixture["ciphersuite"], u16::from(CIPHERSUITE));
    let MlsMessageBodyIn::KeyPackage(package) = message(&fixture["keyPackage"]).extract() else {
        panic!("not a KeyPackage");
    };
    let leaf = package.unverified_credential();
    let identity = format!(
        "{}/{}",
        fixture["keyPackage"]["accountId"].as_str().unwrap(),
        fixture["keyPackage"]["deviceId"].as_str().unwrap()
    );
    assert_eq!(leaf.credential.serialized_content(), identity.as_bytes());
    assert_eq!(
        hex(leaf.signature_key.as_slice()),
        fixture["keyPackage"]["devicePublic"]
    );
    // Read from the bytes, not validated: a KeyPackage's lifetime runs out
    // and this file is checked long after it was made. After the MLSMessage
    // header (version, wire format) come the KeyPackage's version and suite.
    let package = unhex(fixture["keyPackage"]["hex"].as_str().unwrap());
    assert_eq!(
        u16::from_be_bytes([package[6], package[7]]),
        u16::from(CIPHERSUITE)
    );
    assert!(matches!(
        message(&fixture["welcome"]).extract(),
        MlsMessageBodyIn::Welcome(_)
    ));

    let messages = fixture["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 7);
    for entry in messages {
        let protocol = message(entry).try_into_protocol_message().unwrap();
        let wire = match protocol.wire_format() {
            WireFormat::PublicMessage => 1,
            WireFormat::PrivateMessage => 2,
            other => panic!("{other:?}"),
        };
        let content = match protocol.content_type() {
            ContentType::Application => APPLICATION,
            ContentType::Proposal => PROPOSAL,
            ContentType::Commit => COMMIT,
        };
        let name = &entry["name"];
        assert_eq!(entry["wireFormat"], wire, "{name}");
        assert_eq!(
            entry["groupId"],
            hex(protocol.group_id().as_slice()),
            "{name}"
        );
        assert_eq!(entry["epoch"], protocol.epoch().as_u64(), "{name}");
        assert_eq!(entry["contentType"], content, "{name}");
    }
}
