//! The poll rule against the cases the server and the web run too.

#![allow(clippy::disallowed_methods)] // tests use files

use serde::Deserialize;
use spjall_client::social::poll_draft_valid;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    note: String,
    question: String,
    options: Vec<String>,
    valid: bool,
}

#[test]
fn poll_draft_valid_matches_the_shared_vectors() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/poll.vectors.json");
    let file: Vectors = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert!(!file.cases.is_empty());
    for case in file.cases {
        assert_eq!(
            poll_draft_valid(&case.question, &case.options),
            case.valid,
            "{}",
            case.note
        );
    }
}
