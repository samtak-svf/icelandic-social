//! The transport in a dedicated Worker: one blocking, synchronous
//! `XMLHttpRequest` per call (decision 0081). The core's `Client` is
//! blocking, and a Worker may block; a window may not.
use std::io::Write;
use std::path::Path;

use js_sys::Uint8Array;
use spjall_client::BlobStore;
use spjall_client::api::{Request, Response, Transport, Unreachable};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use web_sys::{WorkerGlobalScope, XmlHttpRequest, XmlHttpRequestResponseType};

use crate::blobs::PoolBlobs;
use crate::request::{method_name, request_headers, upload_headers};

/// Reads upload bodies from, and writes download bodies to, the blob rows.
#[derive(Clone)]
pub struct XhrTransport {
    blobs: PoolBlobs,
}

/// What a failed call says. Fixed sentences: a URL or a body can hold a token.
fn unreachable(detail: &str) -> Unreachable {
    Unreachable(detail.to_owned())
}

enum Body<'a> {
    None,
    Text(&'a str),
    Bytes(Vec<u8>),
}

impl XhrTransport {
    pub fn new(blobs: PoolBlobs) -> Self {
        Self { blobs }
    }

    /// Where the page's own origin is: every path is relative to it.
    fn origin() -> Result<String, Unreachable> {
        js_sys::global()
            .dyn_into::<WorkerGlobalScope>()
            .map(|scope| scope.location().origin())
            .map_err(|_| unreachable("not in a worker"))
    }

    fn send(
        request: &Request,
        headers: Vec<(&'static str, String)>,
        body: Body,
        binary_answer: bool,
    ) -> Result<XmlHttpRequest, Unreachable> {
        let url = format!("{}{}", Self::origin()?, request.path);
        let xhr = XmlHttpRequest::new().map_err(|_| unreachable("no XMLHttpRequest"))?;
        xhr.open_with_async(method_name(request.method), &url, false)
            .map_err(|_| unreachable("bad request"))?;
        xhr.set_with_credentials(true);
        if binary_answer {
            xhr.set_response_type(XmlHttpRequestResponseType::Arraybuffer);
        }
        for (name, value) in headers {
            xhr.set_request_header(name, &value)
                .map_err(|_| unreachable("bad header"))?;
        }
        let sent: Result<(), JsValue> = match body {
            Body::None => xhr.send(),
            Body::Text(text) => xhr.send_with_opt_str(Some(text)),
            Body::Bytes(bytes) => xhr.send_with_opt_u8_array(Some(&bytes)),
        };
        sent.map_err(|_| unreachable("network error"))?;
        Ok(xhr)
    }

    fn status(xhr: &XmlHttpRequest) -> Result<u16, Unreachable> {
        match xhr.status() {
            Ok(0) | Err(_) => Err(unreachable("network error")),
            Ok(status) => Ok(status),
        }
    }
}

impl Transport for XhrTransport {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let body = request.body.as_deref().map_or(Body::None, Body::Text);
        let xhr = Self::send(&request, request_headers(&request), body, false)?;
        Ok(Response {
            status: Self::status(&xhr)?,
            body: xhr.response_text().ok().flatten().unwrap_or_default(),
        })
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        let bytes = self
            .blobs
            .read(file)
            .map_err(|_| unreachable("the file to upload is missing"))?;
        let xhr = Self::send(
            &request,
            upload_headers(&request),
            Body::Bytes(bytes),
            false,
        )?;
        Ok(Response {
            status: Self::status(&xhr)?,
            body: xhr.response_text().ok().flatten().unwrap_or_default(),
        })
    }

    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        let xhr = Self::send(&request, request_headers(&request), Body::None, true)?;
        let status = Self::status(&xhr)?;
        let answer = xhr.response().map_err(|_| unreachable("network error"))?;
        let bytes = Uint8Array::new(&answer).to_vec();
        if status == 200 || status == 206 {
            let mut out = self
                .blobs
                .create_write(to)
                .map_err(|_| unreachable("the file could not be written"))?;
            out.write_all(&bytes)
                .and_then(|()| out.finish())
                .map_err(|_| unreachable("the file could not be written"))?;
            return Ok(Response {
                status,
                body: String::new(),
            });
        }
        Ok(Response {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }
}
