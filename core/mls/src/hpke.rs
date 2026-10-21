//! The one use of HPKE outside MLS: the key a history transfer is sealed
//! with (0064, 0074). The new device makes a one-time X25519 key pair and
//! shows its public half in the link; the phone derives a 32-byte key and
//! an encapsulation from it, and only the new device's private half derives
//! the same key from that encapsulation. It runs on the provider MLS
//! already uses, so it adds no crypto crate and builds wherever MLS does.

use openmls_rust_crypto::RustCrypto;
use openmls_traits::crypto::OpenMlsCrypto;
use openmls_traits::random::OpenMlsRand;
use openmls_traits::types::{HpkeAeadType, HpkeConfig, HpkeKdfType, HpkeKemType};

/// The length of a public key, a private key and an encapsulation.
pub const KEY: usize = 32;

const CONFIG: HpkeConfig = HpkeConfig(
    HpkeKemType::DhKem25519,
    HpkeKdfType::HkdfSha256,
    HpkeAeadType::AesGcm256,
);

/// HPKE refused: a key or an encapsulation of the wrong shape, or a
/// failure of the crypto library.
#[derive(Debug, thiserror::Error)]
#[error("HPKE failed")]
pub struct HpkeError;

/// A one-time key pair, private half first.
pub fn key_pair() -> Result<([u8; KEY], [u8; KEY]), HpkeError> {
    let crypto = RustCrypto::default();
    let ikm: [u8; KEY] = crypto.random_array().map_err(|_| HpkeError)?;
    let pair = crypto
        .derive_hpke_keypair(CONFIG, &ikm)
        .map_err(|_| HpkeError)?;
    Ok((array(&pair.private)?, array(&pair.public)?))
}

/// A fresh 32-byte key for `recipient`'s public key, with the
/// encapsulation that carries it: `(encapsulation, key)`.
pub fn seal_key(recipient: &[u8], info: &[u8]) -> Result<([u8; KEY], [u8; KEY]), HpkeError> {
    if recipient.len() != KEY {
        return Err(HpkeError);
    }
    let (enc, secret) = RustCrypto::default()
        .hpke_setup_sender_and_export(CONFIG, recipient, info, b"key", KEY)
        .map_err(|_| HpkeError)?;
    Ok((array(&enc)?, array(&secret)?))
}

/// The key `seal_key` made, from its encapsulation and the private key.
pub fn open_key(enc: &[u8], private: &[u8], info: &[u8]) -> Result<[u8; KEY], HpkeError> {
    if enc.len() != KEY || private.len() != KEY {
        return Err(HpkeError);
    }
    let secret = RustCrypto::default()
        .hpke_setup_receiver_and_export(CONFIG, enc, private, info, b"key", KEY)
        .map_err(|_| HpkeError)?;
    array(&secret)
}

fn array(bytes: &[u8]) -> Result<[u8; KEY], HpkeError> {
    bytes.try_into().map_err(|_| HpkeError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_private_key_opens_what_was_sealed_to_its_public_key() {
        let (private, public) = key_pair().unwrap();
        let (enc, key) = seal_key(&public, b"info").unwrap();
        assert_eq!(open_key(&enc, &private, b"info").unwrap(), key);
    }

    #[test]
    fn another_key_or_info_derives_another_key() {
        let (private, public) = key_pair().unwrap();
        let (other, _) = key_pair().unwrap();
        let (enc, key) = seal_key(&public, b"info").unwrap();
        assert_ne!(open_key(&enc, &other, b"info").unwrap(), key);
        assert_ne!(open_key(&enc, &private, b"other").unwrap(), key);
    }

    #[test]
    fn keys_of_the_wrong_length_are_refused() {
        let (private, public) = key_pair().unwrap();
        assert!(seal_key(&public[..31], b"info").is_err());
        let (enc, _) = seal_key(&public, b"info").unwrap();
        assert!(open_key(&enc[..31], &private, b"info").is_err());
        assert!(open_key(&enc, &private[..31], b"info").is_err());
    }
}
