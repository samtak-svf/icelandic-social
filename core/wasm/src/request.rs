//! What the transport puts on the wire, as pure functions, so that a header
//! is tested without a browser.
use spjall_client::api::{Method, Request};

pub fn method_name(method: Method) -> &'static str {
    match method {
        Method::Get => "GET",
        Method::Post => "POST",
        Method::Put => "PUT",
        Method::Patch => "PATCH",
        Method::Delete => "DELETE",
    }
}

/// `Spjall-Client` (0030): what the request names, else this web build.
pub fn client_header(request: &Request) -> String {
    request
        .client
        .clone()
        .unwrap_or_else(|| concat!("web/", env!("CARGO_PKG_VERSION")).to_owned())
}

/// `Range` for the first and last byte, both included.
pub fn range_header(first: u64, last: u64) -> String {
    format!("bytes={first}-{last}")
}

fn common(request: &Request) -> Vec<(&'static str, String)> {
    let mut headers = vec![("Spjall-Client", client_header(request))];
    if let Some(token) = &request.bearer {
        headers.push(("Authorization", format!("Bearer {token}")));
    }
    headers
}

/// Headers of a JSON `request` or a `download`.
pub fn request_headers(request: &Request) -> Vec<(&'static str, String)> {
    let mut headers = common(request);
    if request.body.is_some() {
        headers.push(("Content-Type", "application/json".to_owned()));
    }
    if let Some((first, last)) = request.range {
        headers.push(("Range", range_header(first, last)));
    }
    headers
}

/// Headers of an `upload`: a binary body, never a range.
pub fn upload_headers(request: &Request) -> Vec<(&'static str, String)> {
    let mut headers = common(request);
    headers.push(("Content-Type", "application/octet-stream".to_owned()));
    headers
}
