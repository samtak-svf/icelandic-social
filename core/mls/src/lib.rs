//! MLS for the core (0002). Phase 0 pins the ciphersuite and proves, on every
//! target the apps ship, that two members can form a group and read each
//! other's messages. `storage` keeps MLS state in the core's encrypted store;
//! the delivery-service rules are phase 1.

pub mod storage;

use openmls::prelude::tls_codec::Deserialize as _;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

/// The only ciphersuite this core creates or joins (0002).
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

#[derive(Debug, thiserror::Error)]
#[error("MLS self-test failed at {step}: {detail}")]
pub struct MlsError {
    step: &'static str,
    detail: String,
}

fn at<E: std::fmt::Debug>(step: &'static str) -> impl FnOnce(E) -> MlsError {
    move |error| MlsError {
        step,
        detail: format!("{error:?}"),
    }
}

struct Member {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
}

impl Member {
    fn new(identity: &str) -> Result<Self, MlsError> {
        let provider = OpenMlsRustCrypto::default();
        let signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(at("signer"))?;
        signer
            .store(provider.storage())
            .map_err(at("signer store"))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
        })
    }
}

fn wire(message: &MlsMessageOut, step: &'static str) -> Result<MlsMessageIn, MlsError> {
    let bytes = message.to_bytes().map_err(at(step))?;
    MlsMessageIn::tls_deserialize_exact(bytes).map_err(at(step))
}

fn read(
    group: &mut MlsGroup,
    member: &Member,
    message: &MlsMessageOut,
) -> Result<Vec<u8>, MlsError> {
    let protocol = wire(message, "message wire")?
        .try_into_protocol_message()
        .map_err(at("protocol message"))?;
    let processed = group
        .process_message(&member.provider, protocol)
        .map_err(at("process"))?;
    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(application) => Ok(application.into_bytes()),
        other => Err(at("process")(other)),
    }
}

/// Two in-memory members, A and B: A creates a group with the pinned suite and
/// adds B; B joins from the Welcome; each sends one message the other decrypts.
/// Every message goes through its wire encoding. Returns the epoch both reach.
pub fn self_test() -> Result<u64, MlsError> {
    let a = Member::new("a")?;
    let b = Member::new("b")?;

    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .build();
    let mut group_a = MlsGroup::new(&a.provider, &a.signer, &config, a.credential.clone())
        .map_err(at("create"))?;

    let package_b = KeyPackage::builder()
        .build(CIPHERSUITE, &b.provider, &b.signer, b.credential.clone())
        .map_err(at("key package"))?;
    let (_commit, welcome, _group_info) = group_a
        .add_members(
            &a.provider,
            &a.signer,
            std::slice::from_ref(package_b.key_package()),
        )
        .map_err(at("add"))?;
    group_a
        .merge_pending_commit(&a.provider)
        .map_err(at("merge"))?;

    let MlsMessageBodyIn::Welcome(welcome) = wire(&welcome, "welcome wire")?.extract() else {
        return Err(at("welcome")("not a Welcome"));
    };
    let mut group_b =
        StagedWelcome::new_from_welcome(&b.provider, config.join_config(), welcome, None)
            .map_err(at("stage welcome"))?
            .into_group(&b.provider)
            .map_err(at("join"))?;

    if group_b.ciphersuite() != CIPHERSUITE {
        return Err(at("ciphersuite")(group_b.ciphersuite()));
    }

    let hello = group_a
        .create_message(&a.provider, &a.signer, b"a->b")
        .map_err(at("encrypt a"))?;
    if read(&mut group_b, &b, &hello)? != b"a->b" {
        return Err(at("decrypt b")("plaintext differs"));
    }
    let reply = group_b
        .create_message(&b.provider, &b.signer, b"b->a")
        .map_err(at("encrypt b"))?;
    if read(&mut group_a, &a, &reply)? != b"b->a" {
        return Err(at("decrypt a")("plaintext differs"));
    }

    let epoch = group_a.epoch().as_u64();
    if group_b.epoch().as_u64() != epoch {
        return Err(at("epoch")((epoch, group_b.epoch().as_u64())));
    }
    Ok(epoch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_test_passes_at_epoch_one() {
        assert_eq!(self_test().unwrap(), 1);
    }

    #[test]
    fn pinned_suite_is_the_one_in_decision_0002() {
        assert_eq!(
            format!("{CIPHERSUITE:?}"),
            "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"
        );
    }
}
