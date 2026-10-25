//! The TypeScript declarations name exactly the keys the DTOs serialize, so
//! a field or a `kind` added to `dto` cannot reach the page untyped.
use std::collections::BTreeSet;

use spjall_wasm::dto;
use spjall_wasm::types::TYPES;

fn person() -> dto::Person {
    dto::Person {
        account: "a".into(),
        name: None,
        verified: false,
        photo: None,
    }
}

fn quote() -> dto::Quote {
    dto::Quote {
        envelope_id: "e".into(),
        sender: None,
        text: None,
        post_id: None,
        location: false,
    }
}

/// One of every variant. The match has no wildcard, so a new variant does
/// not compile until it is listed here.
fn every_content() -> Vec<dto::Content> {
    use dto::Content as C;
    let all = vec![
        C::Text {
            text: "t".into(),
            reply_to: None,
        },
        C::Media {
            mime: "image/jpeg".into(),
            size: 1,
            caption: None,
            name: None,
        },
        C::Deleted,
        C::Members {
            added: vec![],
            removed: vec![],
            devices: vec![],
        },
        C::Timer { seconds: None },
        C::Name { name: None },
        C::Photo { set: true },
        C::Post {
            post_id: "p".into(),
        },
        C::Location {
            lat_e6: 0,
            lon_e6: 0,
            accuracy: None,
        },
        C::Unreadable { code: "c".into() },
    ];
    for content in &all {
        match content {
            C::Text { .. }
            | C::Media { .. }
            | C::Deleted
            | C::Members { .. }
            | C::Timer { .. }
            | C::Name { .. }
            | C::Photo { .. }
            | C::Post { .. }
            | C::Location { .. }
            | C::Unreadable { .. } => {}
        }
    }
    all
}

fn item() -> dto::Item {
    dto::Item {
        seq: None,
        envelope_id: None,
        sender: person(),
        own: false,
        ts: 0,
        received_at: None,
        status: dto::Status::Sent,
        content: dto::Content::Deleted,
        edited: false,
        reactions: vec![],
        read_by: 0,
        expires_at: None,
        forwarded: false,
    }
}

fn conversation() -> dto::Conversation {
    dto::Conversation {
        id: "c".into(),
        state: dto::State::Active,
        name: None,
        photo: None,
        members: vec![],
        last: None,
        unread: 0,
        timer: None,
        mute: dto::Mute::Off,
    }
}

/// The keys of the JSON object `value` serializes to.
fn serialized<T: serde::Serialize>(value: &T) -> BTreeSet<String> {
    match serde_json::to_value(value).unwrap() {
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        other => panic!("not an object: {other}"),
    }
}

/// The top-level keys of a `{ a: …; b: … }` body.
fn keys(body: &str) -> BTreeSet<String> {
    let mut depth = 0;
    let mut field = String::new();
    let mut found = BTreeSet::new();
    for c in body.chars() {
        match c {
            '{' | '(' | '[' => depth += 1,
            '}' | ')' | ']' => depth -= 1,
            ';' if depth == 0 => field.clear(),
            ':' if depth == 0 && !field.starts_with('\0') && !field.trim().is_empty() => {
                found.insert(field.trim().trim_end_matches('?').to_owned());
                field.clear();
                // Skip the type up to the next `;`.
                field.push('\0');
            }
            _ if depth == 0 && !field.starts_with('\0') => field.push(c),
            _ => {}
        }
    }
    found
}

/// The body of `export interface <name> { … }`.
fn interface(name: &str) -> BTreeSet<String> {
    let head = format!("export interface {name} {{");
    let start = TYPES.find(&head).unwrap_or_else(|| panic!("no {head}")) + head.len();
    let mut depth = 1;
    let end = TYPES[start..]
        .char_indices()
        .find(|&(_, c)| {
            match c {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
            depth == 0
        })
        .map(|(at, _)| start + at)
        .unwrap();
    keys(&TYPES[start..end])
}

/// Each `| { kind: "…"; … }` line of `export type Content`, by kind.
fn content_union() -> Vec<(String, BTreeSet<String>)> {
    let start = TYPES.find("export type Content =").unwrap();
    let end = start + TYPES[start..].find(";\n").unwrap();
    TYPES[start..end]
        .lines()
        .filter_map(|line| line.trim().strip_prefix("| {"))
        .map(|line| {
            let body = line.trim_end_matches('}');
            let kind = body.split('"').nth(1).expect("a quoted kind").to_owned();
            (kind, keys(body))
        })
        .collect()
}

#[test]
fn every_content_kind_is_declared_with_its_fields() {
    let declared = content_union();
    let mut kinds = BTreeSet::new();
    for content in every_content() {
        let value = serde_json::to_value(&content).unwrap();
        let kind = value["kind"].as_str().unwrap().to_owned();
        let fields = declared
            .iter()
            .find(|(k, _)| *k == kind)
            .unwrap_or_else(|| panic!("Content kind \"{kind}\" is not declared"));
        assert_eq!(fields.1, serialized(&content), "Content kind \"{kind}\"");
        kinds.insert(kind);
    }
    let extra: Vec<_> = declared
        .iter()
        .filter(|(k, _)| !kinds.contains(k))
        .collect();
    assert!(extra.is_empty(), "declared but never serialized: {extra:?}");
}

#[test]
fn every_interface_names_the_serialized_fields() {
    assert_eq!(interface("Person"), serialized(&person()), "Person");
    assert_eq!(interface("Quote"), serialized(&quote()), "Quote");
    let reaction = dto::Reaction {
        emoji: "x".into(),
        own: false,
        people: vec![],
    };
    assert_eq!(interface("Reaction"), serialized(&reaction), "Reaction");
    assert_eq!(interface("Item"), serialized(&item()), "Item");
    assert_eq!(
        interface("Conversation"),
        serialized(&conversation()),
        "Conversation"
    );
}

#[test]
fn the_parser_reads_nested_types_as_one_field() {
    assert_eq!(
        keys(" a: { b: number; c: string }[]; d?: string | null "),
        BTreeSet::from(["a".to_owned(), "d".to_owned()])
    );
}
