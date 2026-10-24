//! The JSON the page reads: tags and names it can switch on.
use spjall_client::{Content, LinkState, Mute, State};
use spjall_wasm::dto;

#[test]
fn an_enum_is_a_kind_and_camel_case_fields() {
    let content = dto::Content::from(Content::Location {
        lat_e6: 1,
        lon_e6: 2,
        accuracy: None,
    });
    assert_eq!(
        serde_json::to_value(content).unwrap(),
        serde_json::json!({"kind": "location", "latE6": 1, "lonE6": 2, "accuracy": null})
    );
    assert_eq!(
        serde_json::to_value(dto::Mute::from(Mute::Until(7))).unwrap(),
        serde_json::json!({"kind": "until", "at": 7})
    );
}

#[test]
fn plain_states_are_camel_case_words() {
    assert_eq!(
        serde_json::to_value(dto::State::from(State::Stale)).unwrap(),
        "stale"
    );
    assert_eq!(
        serde_json::to_value(dto::LinkState::from(LinkState::Approved)).unwrap(),
        "approved"
    );
}
