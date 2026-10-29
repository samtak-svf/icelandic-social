//! The app's HTTP transport as the core's: the foreign trait object behind
//! [`Foreign`], which is `Clone` so a `Hosted` handle (0113) holds its own.

use std::path::Path;
use std::sync::Arc;

use spjall_client::api;

use crate::client::{HttpMethod, HttpRequest, HttpResponse, Transport, TransportError};

fn http_request(request: api::Request) -> HttpRequest {
    HttpRequest {
        method: match request.method {
            api::Method::Get => HttpMethod::Get,
            api::Method::Post => HttpMethod::Post,
            api::Method::Delete => HttpMethod::Delete,
            api::Method::Put => HttpMethod::Put,
            api::Method::Patch => HttpMethod::Patch,
        },
        path: request.path,
        body: request.body,
        bearer: request.bearer,
        client: request.client,
    }
}

fn api_response(
    response: Result<HttpResponse, TransportError>,
) -> Result<api::Response, api::Unreachable> {
    match response {
        Ok(response) => Ok(api::Response {
            status: response.status,
            body: response.body,
        }),
        Err(TransportError::Unreachable { detail }) => Err(api::Unreachable(detail)),
    }
}

pub(crate) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[derive(Clone)]
pub(crate) struct Foreign(pub(crate) Arc<dyn Transport>);

impl api::Transport for Foreign {
    fn request(&self, request: api::Request) -> Result<api::Response, api::Unreachable> {
        api_response(self.0.request(http_request(request)))
    }

    fn upload(
        &self,
        request: api::Request,
        file: &Path,
    ) -> Result<api::Response, api::Unreachable> {
        api_response(self.0.upload(http_request(request), path_string(file)))
    }

    fn download(
        &self,
        request: api::Request,
        to: &Path,
    ) -> Result<api::Response, api::Unreachable> {
        api_response(self.0.download(http_request(request), path_string(to)))
    }
}
