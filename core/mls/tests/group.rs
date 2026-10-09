//! Groups between devices that each keep their own store file (decision
//! 0018): account `a` with devices `d1` and `d2`, account `b` with `d3`.
//! Messages travel as the bytes the server would store.

use openmls::prelude::tls_codec::Serialize as _;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use spjall_mls::CIPHERSUITE;
use spjall_mls::group::*;
use spjall_mls::storage::Provider;
use spjall_store::{Store, rusqlite};

const KEY: [u8; 32] = [7; 32];

struct Dev {
    _dir: tempfile::TempDir,
    store: Store,
    public_key: Vec<u8>,
    device: Device,
}

impl Dev {
    fn new(account: &str, device: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), &KEY).unwrap();
        let public_key = store
            .write(|tx| Ok(generate_device_key(&Provider::new(tx)).unwrap()))
            .unwrap();
        Self {
            _dir: dir,
            store,
            public_key,
            device: Device::new(account, device).unwrap(),
        }
    }

    /// Runs `f` in one write transaction that commits.
    fn with<T>(&mut self, f: impl FnOnce(&Provider, &Identity) -> T) -> T {
        let (public_key, device) = (self.public_key.clone(), self.device.clone());
        self.store
            .write(|tx| {
                let provider = Provider::new(tx);
                let identity = Identity::load(&provider, &public_key, device).unwrap();
                Ok(f(&provider, &identity))
            })
            .unwrap()
    }

    /// Runs `f` in one write transaction that rolls back.
    fn rolled_back<T>(&mut self, f: impl FnOnce(&Provider, &Identity) -> T) -> T {
        let (public_key, device) = (self.public_key.clone(), self.device.clone());
        let mut out = None;
        let result = self.store.write(|tx| {
            let provider = Provider::new(tx);
            let identity = Identity::load(&provider, &public_key, device).unwrap();
            out = Some(f(&provider, &identity));
            Err::<(), _>(rusqlite::Error::InvalidQuery)
        });
        assert!(result.is_err());
        out.unwrap()
    }

    fn claimed(&mut self) -> Claimed {
        let device = self.device.clone();
        let key_package = self.with(|p, id| id.key_packages(p, 1).unwrap().remove(0));
        Claimed {
            device,
            key_package,
        }
    }

    fn group<T>(&mut self, id: &[u8], f: impl FnOnce(&mut Group, &Provider, &Identity) -> T) -> T {
        self.with(|p, identity| {
            let mut group = Group::load(p, id).unwrap();
            f(&mut group, p, identity)
        })
    }

    fn join(&mut self, welcome: &[u8]) -> Result<Vec<u8>, GroupError> {
        self.with(|p, _| Group::join(p, welcome).map(|g| g.id().to_vec()))
    }

    fn send(&mut self, id: &[u8], text: &[u8]) -> Vec<u8> {
        self.group(id, |g, p, identity| g.encrypt(p, identity, text).unwrap())
    }

    fn receive(&mut self, id: &[u8], bytes: &[u8]) -> Result<Received, GroupError> {
        self.group(id, |g, p, _| g.process(p, bytes))
    }

    fn text(&mut self, id: &[u8], bytes: &[u8]) -> (Device, Vec<u8>) {
        match self.receive(id, bytes).unwrap() {
            Received::Application { sender, plaintext } => (sender, plaintext),
            other => panic!("not an application message: {other:?}"),
        }
    }

    fn epoch(&mut self, id: &[u8]) -> u64 {
        self.group(id, |g, _, _| g.epoch())
    }
}

fn claim(roster: &[&str], welcome: &[&str]) -> Claim {
    let owned = |accounts: &[&str]| accounts.iter().map(|a| (*a).to_owned()).collect();
    Claim {
        roster: owned(roster),
        welcome: owned(welcome),
    }
}

/// `a/d1` creates a group and adds its own `d2` and account `b` in one
/// commit, as creating a conversation does (0018). Everyone has joined.
fn three() -> (Dev, Dev, Dev, Vec<u8>, Commit) {
    let mut d1 = Dev::new("a", "d1");
    let mut d2 = Dev::new("a", "d2");
    let mut d3 = Dev::new("b", "d3");
    let claimed = [d2.claimed(), d3.claimed()];
    let (id, commit) = d1.with(|p, identity| {
        let mut group = Group::create(p, identity).unwrap();
        let commit = group.add(p, identity, &claimed).unwrap();
        group.merge_pending_commit(p).unwrap();
        (group.id().to_vec(), commit)
    });
    let welcome = commit.welcome.clone().unwrap();
    assert_eq!(d2.join(&welcome).unwrap(), id);
    assert_eq!(d3.join(&welcome).unwrap(), id);
    (d1, d2, d3, id, commit)
}

#[test]
fn creating_with_own_devices_and_another_account_derives_the_roster() {
    let (mut d1, mut d2, mut d3, id, commit) = three();
    assert_eq!(id.len(), 32);
    assert_eq!(commit.added, ["b"]);
    assert!(commit.removed.is_empty());
    assert_eq!(commit.claim, claim(&["a", "b"], &["a", "b"]));
    assert_eq!(claim_of(&commit.message), Some(commit.claim.clone()));

    let hello = d1.send(&id, b"hello");
    assert_eq!(d2.text(&id, &hello), (d1.device.clone(), b"hello".to_vec()));
    assert_eq!(d3.text(&id, &hello), (d1.device.clone(), b"hello".to_vec()));
    let reply = d3.send(&id, b"reply");
    assert_eq!(d1.text(&id, &reply).0, Device::new("b", "d3").unwrap());
    assert_eq!(d2.text(&id, &reply).1, b"reply");

    let devices = d2.group(&id, |g, _, _| g.devices().unwrap());
    assert_eq!(devices.len(), 3);
}

/// A new account's devices are its membership, not new devices of 0006.
#[test]
fn a_new_account_s_devices_are_added_not_joined() {
    let (mut d1, mut d2, _d3, id, _) = three();
    let mut d5 = Dev::new("c", "d5");
    let claimed = [d5.claimed()];
    let add = d1.group(&id, |g, p, identity| {
        let commit = g.add(p, identity, &claimed).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    d5.join(add.welcome.as_ref().unwrap()).unwrap();
    match d2.receive(&id, &add.message).unwrap() {
        Received::Commit { added, joined, .. } => {
            assert_eq!(added, [d5.device.clone()]);
            assert!(joined.is_empty(), "{joined:?}");
        }
        other => panic!("not a commit: {other:?}"),
    }
}

#[test]
fn removing_an_account_removes_all_its_devices() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    // b gets a second device.
    let mut d4 = Dev::new("b", "d4");
    let claimed = [d4.claimed()];
    let add = d1.group(&id, |g, p, identity| {
        let commit = g.add(p, identity, &claimed).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert!(add.added.is_empty(), "b is already in the group");
    assert_eq!(add.claim, claim(&["a", "b"], &["b"]));
    d4.join(add.welcome.as_ref().unwrap()).unwrap();
    for dev in [&mut d2, &mut d3] {
        assert!(matches!(
            dev.receive(&id, &add.message).unwrap(),
            Received::Commit { ref added, ref joined, backed: true, .. }
                if added == &[Device::new("b", "d4").unwrap()] && joined == added
        ));
    }

    let remove = d2.group(&id, |g, p, identity| {
        let commit = g.remove(p, identity, &["b".to_owned()]).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert_eq!(remove.removed, ["b"]);
    assert!(remove.welcome.is_none());
    assert_eq!(remove.claim, claim(&["a"], &[]));

    let Received::Commit {
        by,
        removed,
        removed_self,
        claim: told,
        backed,
        ..
    } = d1.receive(&id, &remove.message).unwrap()
    else {
        panic!("not a commit");
    };
    assert_eq!(by, Device::new("a", "d2").unwrap());
    assert_eq!(removed.len(), 2);
    assert!(!removed_self);
    assert_eq!(told, Some(remove.claim));
    assert!(backed);
    for dev in [&mut d3, &mut d4] {
        assert!(matches!(
            dev.receive(&id, &remove.message).unwrap(),
            Received::Commit {
                removed_self: true,
                ..
            }
        ));
    }
    assert_eq!(d1.group(&id, |g, _, _| g.devices().unwrap().len()), 2);
}

#[test]
fn a_device_cannot_remove_its_own_account() {
    let (mut d1, _, _, id, _) = three();
    let refused = d1.group(&id, |g, p, identity| {
        g.remove(p, identity, &["a".to_owned()])
    });
    assert!(matches!(refused, Err(GroupError::OwnAccount)));
}

/// The server stores a message made just before a commit it orders after
/// (0017), so a member that has merged the commit must still read it.
#[test]
fn a_message_from_the_epoch_before_a_commit_still_reads() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    let late = d3.send(&id, b"late");
    let update = d1.group(&id, |g, p, identity| {
        let commit = g.remove(p, identity, &["b".to_owned()]).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    d2.receive(&id, &update.message).unwrap();
    assert_eq!(d2.epoch(&id), d1.epoch(&id));
    assert_eq!(d1.text(&id, &late).1, b"late");
    assert_eq!(d2.text(&id, &late).1, b"late");
}

/// Two members commit on one epoch; the server stores one (0015). The other
/// clears its pending commit, reads the winner, and commits again.
#[test]
fn a_commit_that_loses_its_epoch_is_cleared_and_made_again() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    let mut e1 = Dev::new("e", "d5");
    let mut e2 = Dev::new("e", "d6");
    let (c1, c2) = (e1.claimed(), e2.claimed());
    let wins = d1.group(&id, |g, p, identity| g.add(p, identity, &[c1]).unwrap());
    let loses = d2.group(&id, |g, p, identity| {
        let commit = g.add(p, identity, &[c2]).unwrap();
        assert!(g.has_pending_commit());
        commit
    });
    // An own commit in flight holds back everything else on this device.
    assert!(matches!(
        d2.group(&id, |g, p, identity| g.encrypt(p, identity, b"x")),
        Err(GroupError::CommitInFlight)
    ));

    d1.group(&id, |g, p, _| g.merge_pending_commit(p).unwrap());
    d2.group(&id, |g, p, _| g.clear_pending_commit(p).unwrap());
    assert!(matches!(
        d2.receive(&id, &wins.message).unwrap(),
        Received::Commit { .. }
    ));
    d3.receive(&id, &wins.message).unwrap();
    assert!(matches!(
        d3.receive(&id, &loses.message),
        Err(GroupError::Epoch { .. })
    ));

    let c2 = e2.claimed();
    let again = d2.group(&id, |g, p, identity| {
        let commit = g.add(p, identity, &[c2]).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    d1.receive(&id, &again.message).unwrap();
    d3.receive(&id, &again.message).unwrap();
    e2.join(again.welcome.as_ref().unwrap()).unwrap();
    let hello = e2.send(&id, b"in");
    assert_eq!(d1.text(&id, &hello).1, b"in");
}

#[test]
fn a_key_package_must_name_the_device_it_was_claimed_for() {
    let mut d1 = Dev::new("a", "d1");
    let mut d3 = Dev::new("b", "d3");
    let mut claimed = d3.claimed();
    claimed.device = Device::new("b", "d9").unwrap();
    let refused = d1.with(|p, identity| {
        let mut group = Group::create(p, identity).unwrap();
        group.add(p, identity, &[claimed])
    });
    assert!(matches!(refused, Err(GroupError::NotTheClaimedDevice)));
}

#[test]
fn a_device_already_in_the_group_is_not_added_twice() {
    let (mut d1, mut d2, _, id, _) = three();
    let claimed = [d2.claimed()];
    let refused = d1.group(&id, |g, p, identity| g.add(p, identity, &claimed));
    assert!(matches!(refused, Err(GroupError::AlreadyMember)));
}

/// The last-resort KeyPackage is never consumed on the server (0017), so its
/// private key must outlive the first Welcome that uses it.
#[test]
fn the_last_resort_key_package_joins_more_than_once() {
    let mut d1 = Dev::new("a", "d1");
    let mut d3 = Dev::new("b", "d3");
    let last_resort = d3.with(|p, identity| identity.last_resort(p).unwrap());
    for _ in 0..2 {
        let claimed = [Claimed {
            device: d3.device.clone(),
            key_package: last_resort.clone(),
        }];
        let commit = d1.with(|p, identity| {
            let mut group = Group::create(p, identity).unwrap();
            let commit = group.add(p, identity, &claimed).unwrap();
            group.merge_pending_commit(p).unwrap();
            commit
        });
        d3.join(commit.welcome.as_ref().unwrap()).unwrap();
    }
}

/// A Welcome into a group with a leaf that names no account is refused.
#[test]
fn a_welcome_with_a_foreign_credential_is_refused() {
    let mut d3 = Dev::new("b", "d3");
    let claimed = d3.claimed();
    let MlsMessageBodyIn::KeyPackage(package) =
        <MlsMessageIn as openmls::prelude::tls_codec::Deserialize>::tls_deserialize_exact(
            &claimed.key_package,
        )
        .unwrap()
        .extract()
    else {
        panic!("not a KeyPackage");
    };
    let provider = openmls_rust_crypto::OpenMlsRustCrypto::default();
    let package = package
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .unwrap();
    let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
    signer.store(provider.storage()).unwrap();
    let stranger = CredentialWithKey {
        credential: BasicCredential::new(b"stranger".to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    };
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .build();
    let mut group = MlsGroup::new(&provider, &signer, &config, stranger).unwrap();
    let (_, welcome, _) = group.add_members(&provider, &signer, &[package]).unwrap();
    let welcome = welcome.tls_serialize_detached().unwrap();
    assert!(matches!(d3.join(&welcome), Err(GroupError::Credential)));
}

#[test]
fn an_own_message_is_reported_as_own() {
    let (mut d1, _, _, id, _) = three();
    let hello = d1.send(&id, b"hello");
    assert!(matches!(d1.receive(&id, &hello).unwrap(), Received::Own));
}

/// Decrypting consumes the message key; a rolled-back transaction gives it
/// back, so the client can decrypt and store in one transaction (0016).
#[test]
fn a_rolled_back_read_can_be_repeated() {
    let (mut d1, mut d2, _, id, _) = three();
    let hello = d1.send(&id, b"hello");
    d2.rolled_back(|p, _| {
        let mut group = Group::load(p, &id).unwrap();
        group.process(p, &hello).unwrap();
    });
    assert_eq!(d2.text(&id, &hello).1, b"hello");
}

#[test]
fn typing_is_sealed_to_the_current_epoch() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    let sealed = d1.group(&id, |g, p, _| g.seal_typing(p, b"typing").unwrap());
    assert_eq!(
        d2.group(&id, |g, p, _| g.open_typing(p, &sealed)),
        Some(b"typing".to_vec())
    );
    let mut tampered = sealed.clone();
    *tampered.last_mut().unwrap() ^= 1;
    assert_eq!(d2.group(&id, |g, p, _| g.open_typing(p, &tampered)), None);

    // Typing does not touch the ratchet: the next message still reads.
    let hello = d1.send(&id, b"hello");
    assert_eq!(d3.text(&id, &hello).1, b"hello");

    let update = d1.group(&id, |g, p, identity| {
        let commit = g.remove(p, identity, &["b".to_owned()]).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    d2.receive(&id, &update.message).unwrap();
    assert_eq!(d2.group(&id, |g, p, _| g.open_typing(p, &sealed)), None);
}

/// A member can claim a roster its commit does not make (0020). The others
/// see the claim is not backed, and a commit that changes no one tells the
/// server the roster MLS holds.
#[test]
fn a_claim_the_commit_does_not_back_is_seen_and_corrected() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    let mut d5 = Dev::new("c", "d5");
    let claimed = [d5.claimed()];
    // a adds c, and tells the server that b is gone.
    forge::next_claim(&["a", "c"], &["c"]);
    let lie = d1.group(&id, |g, p, identity| {
        let commit = g.add(p, identity, &claimed).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert_eq!(claim_of(&lie.message), Some(claim(&["a", "c"], &["c"])));
    for dev in [&mut d2, &mut d3] {
        let Received::Commit {
            claim: told,
            backed,
            ..
        } = dev.receive(&id, &lie.message).unwrap()
        else {
            panic!("not a commit");
        };
        assert_eq!(told, Some(claim(&["a", "c"], &["c"])));
        assert!(!backed);
    }

    let fix = d2.group(&id, |g, p, identity| {
        let commit = g.correct(p, identity).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert_eq!(fix.claim, claim(&["a", "b", "c"], &[]));
    assert!(fix.welcome.is_none() && fix.added.is_empty() && fix.removed.is_empty());
    for dev in [&mut d1, &mut d3] {
        assert!(matches!(
            dev.receive(&id, &fix.message).unwrap(),
            Received::Commit { backed: true, .. }
        ));
    }
    assert_eq!(d3.epoch(&id), d2.epoch(&id));
}

#[test]
fn a_claim_is_only_the_json_a_commit_carries() {
    let told = claim(&["a", "b"], &["b"]);
    assert_eq!(Claim::decode(&told.encode()), Some(told));
    assert_eq!(
        Claim::decode(br#"{"roster":["b","a","a"],"welcome":[]}"#),
        Some(claim(&["a", "b"], &[]))
    );
    for bad in [
        &b""[..],
        b"{}",
        br#"{"roster":["a"]}"#,
        br#"{"roster":["a/b"],"welcome":[]}"#,
        br#"{"roster":[1],"welcome":[]}"#,
    ] {
        assert_eq!(Claim::decode(bad), None, "{}", String::from_utf8_lossy(bad));
    }
    // An application message carries none.
    let (mut d1, _, _, id, _) = three();
    assert_eq!(claim_of(&d1.send(&id, b"hello")), None);
}

/// The GroupInfo a commit carries, as the server stores it (0021).
fn group_info_epoch(bytes: &[u8]) -> u64 {
    use openmls::prelude::tls_codec::Deserialize as _;
    let MlsMessageBodyIn::GroupInfo(group_info) = MlsMessageIn::tls_deserialize_exact(bytes)
        .unwrap()
        .extract()
    else {
        panic!("not a GroupInfo");
    };
    group_info.epoch().as_u64()
}

#[test]
fn every_commit_carries_the_group_info_of_its_epoch() {
    let (mut d1, _d2, _d3, id, commit) = three();
    assert_eq!(group_info_epoch(&commit.group_info), 1);
    let correction = d1.group(&id, |g, p, identity| {
        let commit = g.correct(p, identity).unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert_eq!(group_info_epoch(&correction.group_info), 2);
}

/// `a/d4` comes after the group was made, so no Welcome names it: it joins
/// from the last commit's GroupInfo, and every member sees a new device of
/// an account already in the group.
#[test]
fn a_new_device_of_a_member_account_joins_by_external_commit() {
    let (mut d1, mut d2, mut d3, id, commit) = three();
    let mut d4 = Dev::new("a", "d4");
    let (joined_id, join) = d4.with(|p, identity| {
        let (group, commit) = Group::join_external(p, identity, &commit.group_info).unwrap();
        (group.id().to_vec(), commit)
    });
    assert_eq!(joined_id, id);
    assert!(join.welcome.is_none());
    assert_eq!(join.claim, claim(&["a", "b"], &[]));
    assert_eq!(claim_of(&join.message), Some(join.claim.clone()));
    assert_eq!(group_info_epoch(&join.group_info), 2);

    for member in [&mut d1, &mut d2, &mut d3] {
        match member.receive(&id, &join.message).unwrap() {
            Received::Commit {
                by,
                added,
                removed,
                joined,
                backed,
                ..
            } => {
                assert_eq!(by, d4.device);
                assert!(added.is_empty() && removed.is_empty());
                assert_eq!(joined, [d4.device.clone()]);
                assert!(backed);
            }
            other => panic!("not a commit: {other:?}"),
        }
    }
    let hello = d4.send(&id, b"ny");
    assert_eq!(d3.text(&id, &hello), (d4.device.clone(), b"ny".to_vec()));
    let back = d1.send(&id, b"velkomin");
    assert_eq!(
        d4.text(&id, &back),
        (d1.device.clone(), b"velkomin".to_vec())
    );
}

/// `b/d3` lost its group (its store fell behind the server). It joins
/// again with the same key, and its old leaf goes in the same commit: no
/// one sees it removed, and it reads what comes next.
#[test]
fn a_device_that_lost_its_group_rejoins_in_place_of_its_old_leaf() {
    let (mut d1, mut d2, mut d3, id, commit) = three();
    d3.with(|p, _| Group::load(p, &id).unwrap().delete(p).unwrap());
    let rejoin = d3.with(|p, identity| {
        Group::join_external(p, identity, &commit.group_info)
            .unwrap()
            .1
    });
    assert_eq!(d3.group(&id, |g, _, _| g.devices().unwrap().len()), 3);

    match d1.receive(&id, &rejoin.message).unwrap() {
        Received::Commit {
            removed,
            joined,
            backed,
            ..
        } => {
            assert!(removed.is_empty() && joined.is_empty());
            assert!(backed);
        }
        other => panic!("not a commit: {other:?}"),
    }
    d2.receive(&id, &rejoin.message).unwrap();
    let hello = d1.send(&id, b"aftur");
    assert_eq!(d3.text(&id, &hello), (d1.device.clone(), b"aftur".to_vec()));
}

#[test]
fn a_group_info_without_its_tree_or_from_a_message_is_refused() {
    let (mut d1, _d2, _d3, id, commit) = three();
    let mut d4 = Dev::new("a", "d4");
    let hello = d1.send(&id, b"hello");
    for bytes in [&hello, &commit.message] {
        assert!(matches!(
            d4.rolled_back(|p, identity| Group::join_external(p, identity, bytes).err()),
            Some(GroupError::Malformed(_))
        ));
    }
}

/// `a/d2` is revoked: its sibling `a/d1` removes the leaf, and `a` stays in
/// the claim because it keeps a leaf (0028).
#[test]
fn a_device_removes_a_sibling_device() {
    let (mut d1, mut d2, mut d3, id, _) = three();
    let remove = d1.group(&id, |g, p, identity| {
        let commit = g
            .remove_devices(p, identity, &[Device::new("a", "d2").unwrap()])
            .unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert!(remove.removed.is_empty(), "{:?}", remove.removed);
    assert_eq!(remove.claim, claim(&["a", "b"], &[]));

    let Received::Commit {
        removed,
        removed_self,
        backed,
        ..
    } = d3.receive(&id, &remove.message).unwrap()
    else {
        panic!("not a commit");
    };
    assert_eq!(removed, [Device::new("a", "d2").unwrap()]);
    assert!(!removed_self);
    assert!(backed);
    assert!(matches!(
        d2.receive(&id, &remove.message).unwrap(),
        Received::Commit {
            removed_self: true,
            ..
        }
    ));

    // What is sent after the removal is not for the removed leaf.
    let after = d1.send(&id, b"after");
    assert_eq!(d3.text(&id, &after).1, b"after");
    assert!(d2.receive(&id, &after).is_err());
}

#[test]
fn a_device_cannot_remove_its_own_leaf() {
    let (mut d1, _, _, id, _) = three();
    let refused = d1.group(&id, |g, p, identity| {
        g.remove_devices(p, identity, &[Device::new("a", "d1").unwrap()])
    });
    assert!(matches!(refused, Err(GroupError::OwnDevice)));
}

#[test]
fn removing_the_last_device_removes_the_account_from_the_claim() {
    let (mut d1, mut d2, _d3, id, _) = three();
    let remove = d1.group(&id, |g, p, identity| {
        let commit = g
            .remove_devices(p, identity, &[Device::new("b", "d3").unwrap()])
            .unwrap();
        g.merge_pending_commit(p).unwrap();
        commit
    });
    assert_eq!(remove.removed, ["b"]);
    assert_eq!(remove.claim, claim(&["a"], &[]));
    assert!(matches!(
        d2.receive(&id, &remove.message).unwrap(),
        Received::Commit { backed: true, .. }
    ));
}

/// A package past its `not_after` is refused as expired, not as malformed,
/// so the client can tell the server's stock is stale (0029).
#[test]
fn an_expired_key_package_is_refused_as_expired() {
    let provider = openmls_rust_crypto::OpenMlsRustCrypto::default();
    let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
    let credential = CredentialWithKey {
        credential: BasicCredential::new(b"b/d3".to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    };
    let bundle = KeyPackage::builder()
        .key_package_lifetime(Lifetime::init(1, 2))
        .build(CIPHERSUITE, &provider, &signer, credential)
        .unwrap();
    let message: MlsMessageOut = bundle.key_package().clone().into();
    let claimed = [Claimed {
        device: Device::new("b", "d3").unwrap(),
        key_package: message.tls_serialize_detached().unwrap(),
    }];
    let mut d1 = Dev::new("a", "d1");
    let refused = d1.with(|p, identity| {
        let mut group = Group::create(p, identity).unwrap();
        group.add(p, identity, &claimed)
    });
    assert!(matches!(refused, Err(GroupError::Expired)), "{refused:?}");
}

/// Every package this core makes runs the full lifetime from now.
#[test]
fn a_key_package_carries_the_lifetime_of_0029() {
    let mut d3 = Dev::new("b", "d3");
    let bytes = d3.with(|p, identity| identity.last_resort(p).unwrap());
    let MlsMessageBodyIn::KeyPackage(package) =
        <MlsMessageIn as openmls::prelude::tls_codec::Deserialize>::tls_deserialize_exact(&bytes)
            .unwrap()
            .extract()
    else {
        panic!("not a KeyPackage");
    };
    let provider = openmls_rust_crypto::OpenMlsRustCrypto::default();
    let package = package
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let not_after = package.life_time().not_after();
    assert!(
        not_after.abs_diff(now + KEY_PACKAGE_LIFETIME_SECS) < 60,
        "{not_after}"
    );
}
