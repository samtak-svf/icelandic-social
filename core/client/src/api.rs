//! The HTTP side of `api/openapi.json`, written once here (0018). The app's
//! `Transport` makes one blocking request with its base URL and device
//! token; the paths, bodies and error codes are this module's.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

/// A request to the API: `path` starts at `/v1/` and holds any query, and
/// `body` is JSON. The transport adds the base URL, `Authorization`, and
/// `content-type: application/json` when there is a body; the Worker answers
/// 415 without it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub body: Option<String>,
}

/// Any answer the server gave, whatever its status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

/// No answer came back. The request may or may not have reached the server,
/// which is why everything sent is safe to send again.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("no answer: {0}")]
pub struct Unreachable(pub String);

/// What the app provides: one blocking HTTP request. Called off the main
/// thread, and never inside a store transaction.
pub trait Transport {
    fn request(&self, request: Request) -> Result<Response, Unreachable>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ApiError {
    #[error(transparent)]
    Unreachable(#[from] Unreachable),
    /// The server answered with an `ApiError` code.
    #[error("{status} {code}")]
    Refused { status: u16, code: String },
    /// The server answered with something the contract does not allow.
    #[error("malformed answer to {0}")]
    Malformed(&'static str),
}

impl ApiError {
    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Refused { code, .. } => Some(code),
            _ => None,
        }
    }
}

/// A group id as the API names its conversation: unpadded base64url.
pub fn conversation_id(group_id: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(group_id)
}

pub fn group_id(conversation_id: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(conversation_id).ok()
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub(crate) fn from_base64(text: &str) -> Option<Vec<u8>> {
    STANDARD.decode(text).ok()
}

/// A sealed outbox row, as `sendMessage` takes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub client_msg_id: String,
    pub ciphertext: Vec<u8>,
    pub roster_add: Vec<String>,
    pub roster_remove: Vec<String>,
    pub welcome: Option<(Vec<String>, Vec<u8>)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendBody<'a> {
    client_msg_id: &'a str,
    ciphertext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    roster: Option<Roster<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    welcome: Option<WelcomeFor<'a>>,
}

#[derive(Serialize)]
struct Roster<'a> {
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    add: &'a [String],
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    remove: &'a [String],
}

#[derive(Serialize)]
struct WelcomeFor<'a> {
    to: &'a [String],
    message: String,
}

#[derive(Deserialize)]
struct Sent {
    seq: u64,
}

#[derive(Deserialize)]
struct Listed {
    messages: Vec<Stored>,
    more: bool,
}

/// One page of `listMessages`: `(seq, ciphertext)` oldest first, and
/// whether more follow.
pub struct Page {
    pub messages: Vec<(u64, Vec<u8>)>,
    pub more: bool,
}

#[derive(Deserialize)]
struct Stored {
    seq: u64,
    ciphertext: String,
}

#[derive(Deserialize)]
struct Welcome {
    seq: u64,
    welcome: String,
}

#[derive(Deserialize)]
struct Stock {
    available: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Claimed {
    key_packages: Vec<ClaimedPackage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedPackage {
    device_id: String,
    key_package: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
}

/// The operations the client uses, over the app's transport.
pub struct Api<'a, T: ?Sized>(pub &'a T);

impl<T: Transport + ?Sized> Api<'_, T> {
    fn call<R: DeserializeOwned>(
        &self,
        method: Method,
        path: String,
        body: Option<String>,
        what: &'static str,
    ) -> Result<R, ApiError> {
        let response = self.0.request(Request { method, path, body })?;
        if response.status == 200 {
            return serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed(what));
        }
        let code = serde_json::from_str::<ErrorBody>(&response.body)
            .map(|e| e.error)
            .unwrap_or_default();
        Err(ApiError::Refused {
            status: response.status,
            code,
        })
    }

    fn json(value: &impl Serialize) -> Option<String> {
        Some(serde_json::to_string(value).expect("request bodies serialize"))
    }

    /// `createConversation`: 200 also when this account already created it.
    pub fn create_conversation(&self, conversation: &str) -> Result<(), ApiError> {
        let body = serde_json::json!({ "conversationId": conversation });
        self.call::<serde_json::Value>(
            Method::Post,
            "/v1/conversations".into(),
            Self::json(&body),
            "createConversation",
        )
        .map(drop)
    }

    /// `sendMessage`: the seq the message was stored at, the same on a retry.
    pub fn send_message(&self, conversation: &str, out: &Outgoing) -> Result<u64, ApiError> {
        let body = SendBody {
            client_msg_id: &out.client_msg_id,
            ciphertext: base64(&out.ciphertext),
            roster: (!out.roster_add.is_empty() || !out.roster_remove.is_empty()).then_some(
                Roster {
                    add: &out.roster_add,
                    remove: &out.roster_remove,
                },
            ),
            welcome: out.welcome.as_ref().map(|(to, message)| WelcomeFor {
                to,
                message: base64(message),
            }),
        };
        let sent: Sent = self.call(
            Method::Post,
            format!("/v1/conversations/{conversation}/messages"),
            Self::json(&body),
            "sendMessage",
        )?;
        Ok(sent.seq)
    }

    /// `listMessages`: messages after `after`, oldest first, and whether more follow.
    pub fn list_messages(&self, conversation: &str, after: u64) -> Result<Page, ApiError> {
        let page: Listed = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/messages?after={after}"),
            None,
            "listMessages",
        )?;
        let messages = page
            .messages
            .into_iter()
            .map(|m| Ok((m.seq, from_base64(&m.ciphertext).ok_or(())?)))
            .collect::<Result<_, ()>>()
            .map_err(|_| ApiError::Malformed("listMessages"))?;
        Ok(Page {
            messages,
            more: page.more,
        })
    }

    /// `getWelcome`: the seq of the commit that added this account, and the Welcome.
    pub fn get_welcome(&self, conversation: &str) -> Result<(u64, Vec<u8>), ApiError> {
        let welcome: Welcome = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/welcome"),
            None,
            "getWelcome",
        )?;
        let bytes = from_base64(&welcome.welcome).ok_or(ApiError::Malformed("getWelcome"))?;
        Ok((welcome.seq, bytes))
    }

    /// `uploadKeyPackages`: how many unclaimed packages this device now holds.
    pub fn upload_key_packages(
        &self,
        packages: &[Vec<u8>],
        last_resort: Option<&[u8]>,
    ) -> Result<u32, ApiError> {
        let mut body = serde_json::json!({
            "keyPackages": packages.iter().map(|p| base64(p)).collect::<Vec<_>>(),
        });
        if let Some(last_resort) = last_resort {
            body["lastResort"] = base64(last_resort).into();
        }
        let stock: Stock = self.call(
            Method::Post,
            "/v1/key-packages".into(),
            Self::json(&body),
            "uploadKeyPackages",
        )?;
        Ok(stock.available)
    }

    /// `claimKeyPackages`: one per device of the account but this one.
    pub fn claim_key_packages(&self, account: &str) -> Result<Vec<(String, Vec<u8>)>, ApiError> {
        let claimed: Claimed = self.call(
            Method::Post,
            format!("/v1/accounts/{account}/key-packages"),
            Some("{}".into()),
            "claimKeyPackages",
        )?;
        claimed
            .key_packages
            .into_iter()
            .map(|p| Ok((p.device_id, from_base64(&p.key_package).ok_or(())?)))
            .collect::<Result<_, ()>>()
            .map_err(|_| ApiError::Malformed("claimKeyPackages"))
    }
}
