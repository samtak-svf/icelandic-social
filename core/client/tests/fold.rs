//! The core folds a name as the server does (0036, 0038). The vectors in
//! `api/fold-vectors.json` are read by the backend's directory test too, so
//! the conversation search on a phone and the directory search on the server
//! cannot fold the same name two ways.

use std::path::PathBuf;

use serde::Deserialize;
use spjall_client::fold_name;

#[derive(Deserialize)]
struct Vectors {
    vectors: Vec<Vector>,
}

#[derive(Deserialize)]
struct Vector {
    input: String,
    folded: String,
}

#[test]
fn fold_name_matches_the_shared_vectors() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/fold-vectors.json");
    let file: Vectors = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert!(!file.vectors.is_empty());
    for vector in file.vectors {
        assert_eq!(fold_name(&vector.input), vector.folded, "{}", vector.input);
    }
}
