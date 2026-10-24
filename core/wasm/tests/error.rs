//! The codes a page can switch on.
use spjall_client::api::{ApiError, Unreachable};
use spjall_client::{ClientError, LinkError};
use spjall_wasm::error::Failure;

fn code(error: ClientError) -> &'static str {
    Failure::from(&error).code
}

#[test]
fn codes_are_stable_names() {
    assert_eq!(code(ClientError::NotRegistered), "not-registered");
    assert_eq!(
        code(ClientError::UnknownConversation),
        "unknown-conversation"
    );
    assert_eq!(
        code(ClientError::Link(LinkError::NotApproved)),
        "link-not-approved"
    );
    assert_eq!(code(ClientError::Link(LinkError::Gone)), "link-expired");
    assert_eq!(
        code(ClientError::Transport(ApiError::Unreachable(Unreachable(
            "offline".into()
        )))),
        "unreachable"
    );
}

#[test]
fn a_refusal_carries_the_servers_code_as_its_message() {
    let refused = ClientError::Transport(ApiError::Refused {
        status: 403,
        code: "forbidden".into(),
        request_id: None,
    });
    let failure = Failure::from(&refused);
    assert_eq!(
        (failure.code, failure.message.as_str()),
        ("refused", "forbidden")
    );
}

#[test]
fn a_store_failure_never_quotes_the_database() {
    let store = ClientError::Store(spjall_store::rusqlite::Error::InvalidQuery);
    let failure = Failure::from(&store);
    assert_eq!(failure.code, "store");
    assert_eq!(failure.message, "the store failed");
}
