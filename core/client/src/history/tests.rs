use super::*;
use crate::blobs::MemBlobs;

const A: &str = "AAAAAAAAAAAAAAAAAAAAAA";
const B: &str = "BBBBBBBBBBBBBBBBBBBBBB";

fn media(object: &str) -> Record {
    Record::Item {
        group: "Zw".into(),
        seq: 1,
        kind: "media".into(),
        sender_account: "a".into(),
        sender_device: "a1".into(),
        envelope_id: Some(object.into()),
        ts: 1,
        stored_at: 1,
        text: None,
        reply_to: None,
        detail: Some(
            serde_json::json!({
                "kind": "media", "object": object, "mime": "image/png", "size": 3,
                "key": "", "sha256": "",
            })
            .to_string(),
        ),
        edited: false,
        deleted: false,
        expires_at: None,
        received_at: None,
    }
}

fn record(out: &mut Vec<u8>, record: &Record) {
    push(out, RECORD, &serde_json::to_vec(record).unwrap());
}

fn file(out: &mut Vec<u8>, object: &str, bytes: &[u8]) {
    push(out, OBJECT, object.as_bytes());
    push(out, FILE, bytes);
}

fn read(plain: &[u8]) -> Result<Stream, HistoryError> {
    read_stream(&MemBlobs::new(), &mut Cursor::new(plain), Path::new("s"))
}

#[test]
fn a_file_comes_in_only_when_a_row_names_it_once() {
    let mut plain = Vec::new();
    record(&mut plain, &media(A));
    file(&mut plain, A, b"abc");
    let mut whole = plain.clone();
    whole.extend_from_slice(&frame(END, 0));
    let stream = read(&whole).unwrap();
    assert_eq!(stream.records.len(), 1);
    assert_eq!(stream.files.keys().collect::<Vec<_>>(), [A]);

    // A file no row names, the same file twice, a row after a file.
    for extra in [
        {
            let mut p = plain.clone();
            file(&mut p, B, b"abc");
            p
        },
        {
            let mut p = plain.clone();
            file(&mut p, A, b"abc");
            p
        },
        {
            let mut p = plain.clone();
            record(&mut p, &media(B));
            p
        },
    ] {
        let mut extra = extra;
        extra.extend_from_slice(&frame(END, 0));
        assert!(matches!(read(&extra), Err(HistoryError::Tampered)));
    }
    // Cut before the end, or with something after it.
    assert!(matches!(read(&plain), Err(HistoryError::Tampered)));
    whole.push(0);
    assert!(matches!(read(&whole), Err(HistoryError::Tampered)));
}

#[test]
fn files_go_newest_first_while_they_fit_and_the_rows_must() {
    let blobs = MemBlobs::new();
    let dir = Path::new("media");
    blobs.put(dir.join(file_name(A, "image/png")), vec![1; 100]);
    blobs.put(dir.join(file_name(B, "image/png")), vec![2; 50]);
    let listed = || {
        vec![
            (A.to_owned(), "image/png".to_owned()),
            ("CCCCCCCCCCCCCCCCCCCCCC".to_owned(), "image/png".to_owned()),
            (B.to_owned(), "image/png".to_owned()),
        ]
    };
    let files = |parts: VecDeque<Part>| -> Vec<u64> {
        parts
            .into_iter()
            .filter_map(|p| match p {
                Part::File { len, .. } => Some(len),
                Part::Bytes(_) => None,
            })
            .collect()
    };
    let cost = |len: u64| 2 * FRAME + 22 + len;
    let rows = vec![0; 10];
    let base = 10 + FRAME;

    let all = parts(
        &blobs,
        dir,
        rows.clone(),
        listed(),
        base + cost(100) + cost(50),
    );
    assert_eq!(files(all.unwrap()), [100, 50]);
    // A gone file is skipped; a smaller one behind a large one still fits.
    let some = parts(&blobs, dir, rows.clone(), listed(), base + cost(50));
    assert_eq!(files(some.unwrap()), [50]);
    let none = parts(&blobs, dir, rows.clone(), listed(), base);
    assert_eq!(files(none.unwrap()), Vec::<u64>::new());
    assert!(matches!(
        parts(&blobs, dir, rows, listed(), base - 1),
        Err(HistoryError::TooLarge)
    ));
}
