//! What the transport puts on the wire, as pure functions.
use spjall_client::api::{Method, Request};

pub fn method_name(_method: Method) -> &'static str {
    unimplemented!()
}

pub fn client_header(_request: &Request) -> String {
    unimplemented!()
}

pub fn range_header(_first: u64, _last: u64) -> String {
    unimplemented!()
}

/// Headers of a JSON `request`.
pub fn request_headers(_request: &Request) -> Vec<(&'static str, String)> {
    unimplemented!()
}

/// Headers of an `upload`: the same, with a binary body.
pub fn upload_headers(_request: &Request) -> Vec<(&'static str, String)> {
    unimplemented!()
}
