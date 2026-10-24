//! The wire format of the XHR transport, without a browser.
use spjall_client::api::{Method, Request};
use spjall_wasm::request::{
    client_header, method_name, range_header, request_headers, upload_headers,
};

fn request() -> Request {
    Request {
        method: Method::Get,
        path: "/v1/me".into(),
        body: None,
        bearer: None,
        client: None,
        range: None,
    }
}

fn header<'a>(headers: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.as_str())
}

#[test]
fn methods_are_the_http_verbs() {
    assert_eq!(method_name(Method::Get), "GET");
    assert_eq!(method_name(Method::Post), "POST");
    assert_eq!(method_name(Method::Put), "PUT");
    assert_eq!(method_name(Method::Patch), "PATCH");
    assert_eq!(method_name(Method::Delete), "DELETE");
}

#[test]
fn the_client_names_itself_as_the_web_build_unless_the_request_says_otherwise() {
    assert_eq!(
        client_header(&request()),
        format!("web/{}", env!("CARGO_PKG_VERSION"))
    );
    let named = Request {
        client: Some("web/9.9.9".into()),
        ..request()
    };
    assert_eq!(client_header(&named), "web/9.9.9");
}

#[test]
fn a_range_includes_both_ends() {
    assert_eq!(range_header(0, 99), "bytes=0-99");
    assert_eq!(range_header(100, 100), "bytes=100-100");
}

#[test]
fn a_plain_request_carries_only_the_client() {
    let headers = request_headers(&request());
    assert_eq!(header(&headers, "Spjall-Client").unwrap(), client_header(&request()));
    assert_eq!(header(&headers, "Authorization"), None);
    assert_eq!(header(&headers, "Content-Type"), None);
    assert_eq!(header(&headers, "Range"), None);
}

#[test]
fn a_json_body_and_a_token_are_sent_as_such() {
    let post = Request {
        method: Method::Post,
        body: Some("{}".into()),
        bearer: Some("tok".into()),
        ..request()
    };
    let headers = request_headers(&post);
    assert_eq!(header(&headers, "Content-Type"), Some("application/json"));
    assert_eq!(header(&headers, "Authorization"), Some("Bearer tok"));
}

#[test]
fn a_range_becomes_a_range_header() {
    let ranged = Request {
        range: Some((5, 9)),
        ..request()
    };
    assert_eq!(
        header(&request_headers(&ranged), "Range"),
        Some("bytes=5-9")
    );
}

#[test]
fn an_upload_is_binary_and_never_ranged() {
    let put = Request {
        method: Method::Put,
        bearer: Some("tok".into()),
        range: Some((0, 1)),
        ..request()
    };
    let headers = upload_headers(&put);
    assert_eq!(
        header(&headers, "Content-Type"),
        Some("application/octet-stream")
    );
    assert_eq!(header(&headers, "Authorization"), Some("Bearer tok"));
    assert_eq!(header(&headers, "Range"), None);
}
