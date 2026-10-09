//! The HTTP side of `api/openapi.json`, written once here (0018). The app's
//! `Transport` makes one blocking request with its base URL; the paths,
//! bodies, device token and error codes are this module's.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use std::path::Path;

use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
}

/// A request to the API: `path` starts at `/v1/` and holds any query, and
/// `body` is JSON. The transport adds the base URL, `Authorization: Bearer`
/// with `bearer` when there is one, `Spjall-Client` with `client` when there
/// is one (0030), and `content-type: application/json` when there is a body;
/// the Worker answers 415 without it.
///
/// The core hands the transport the device token on each request rather
/// than the transport asking for it, because the app's transport runs while
/// the client is busy with the call that made the request (0019).
#[derive(Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub body: Option<String>,
    pub bearer: Option<String>,
    pub client: Option<String>,
}

/// Never prints the token or the body, which can hold a PKCE verifier.
impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("method", &self.method)
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
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

    /// A `PUT` of the file at `file` as `application/octet-stream`, with
    /// its `Content-Length`, streamed from disk. `request.body` is none.
    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable>;

    /// A `GET` whose body, on 200, is streamed into a new file at `to` and
    /// left out of the response; any other answer's body is returned as
    /// text, as `request` returns it.
    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable>;
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
    /// This build is below the version floor; `min` is the lowest the
    /// server still serves on this platform (0030).
    #[error("this build is too old; the server needs {min}")]
    ClientTooOld { min: String },
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
    /// A commit's Welcome; who it is for is in the commit's claim (0020).
    pub welcome: Option<Vec<u8>>,
    /// A commit's GroupInfo for the epoch it starts (0021).
    pub group_info: Option<Vec<u8>>,
    /// The other members' devices are pushed for it (0025): text, replies
    /// and media are; receipts, reactions, edits, deletes and commits are not.
    pub urgent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendBody<'a> {
    client_msg_id: &'a str,
    ciphertext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    welcome: Option<WelcomeMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group_info: Option<String>,
    urgent: bool,
}

#[derive(Serialize)]
struct WelcomeMessage {
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
#[serde(rename_all = "camelCase")]
struct LatestGroupInfo {
    seq: u64,
    group_info: String,
}

/// `uploadKeyPackages`' answer (0029).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    /// Unclaimed packages valid for at least 14 more days.
    pub available: u32,
    /// When the last resort expires, in milliseconds; none if there is none.
    pub last_resort_not_after: Option<u64>,
}

#[derive(Deserialize)]
struct ConversationDevices {
    accounts: Vec<AccountDevices>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDevices {
    account_id: String,
    device_ids: Vec<String>,
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
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: String,
    min_version: Option<String>,
}

/// `getSignInConfig`: where the app sends the person to sign in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInConfig {
    pub authorization_endpoint: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scope: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Android,
    Ios,
}

/// `registerDevice`'s body. Its verifier goes to `/v1/devices` and nowhere
/// else.
pub struct Registration<'a> {
    pub code: &'a str,
    pub verifier: &'a str,
    pub redirect_uri: &'a str,
    pub nonce: &'a str,
    pub platform: Platform,
    pub device_key: &'a [u8],
    pub invite: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody<'a> {
    kenni_code: &'a str,
    code_verifier: &'a str,
    redirect_uri: &'a str,
    nonce: &'a str,
    platform: Platform,
    device_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    invite_token: Option<&'a str>,
}

/// `registerDevice`'s answer: the token is shown once.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registered {
    pub account_id: String,
    pub device_id: String,
    pub token: String,
}

/// `getMe`: this account and its devices.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub account_id: String,
    /// The registry name, if Kenni gave one.
    pub name: Option<String>,
    pub verified: bool,
    pub devices: Vec<AccountDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: Platform,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// The device that asked.
    pub current: bool,
}

#[derive(Deserialize)]
struct NewInvite {
    link: String,
}

/// Who made an invite, as `resolveInvite` shows it before sign-in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inviter {
    /// The account the invite opens a 1:1 with (0022).
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// Another account's name and mark, as `getAccount` shows it to an account
/// it shares a conversation with.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Profile {
    pub name: Option<String>,
    pub verified: bool,
}

/// An account this account blocked, as `listBlocks` shows it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// Milliseconds since the epoch.
    pub blocked_at: u64,
}

#[derive(Deserialize)]
struct Blocks {
    blocked: Vec<Blocked>,
}

#[derive(Deserialize)]
struct Resolved {
    inviter: Option<Inviter>,
}

/// The operations the client uses, over the app's transport, as the device
/// `bearer` names, or as no device for the calls made before sign-in.
pub struct Api<'a, T: ?Sized> {
    transport: &'a T,
    bearer: Option<&'a str>,
    client: Option<&'a str>,
}

impl<'a, T: Transport + ?Sized> Api<'a, T> {
    pub fn new(transport: &'a T, bearer: Option<&'a str>) -> Self {
        Self {
            transport,
            bearer,
            client: None,
        }
    }

    /// Names this build in `Spjall-Client` on every request (0030).
    pub fn client(mut self, client: Option<&'a str>) -> Self {
        self.client = client;
        self
    }

    /// The answer on 200 or 204, or the `ApiError` code it was refused with.
    fn send(
        &self,
        method: Method,
        path: String,
        body: Option<String>,
    ) -> Result<Response, ApiError> {
        let response = self.transport.request(self.request(method, path, body))?;
        Self::checked(response)
    }

    fn request(&self, method: Method, path: String, body: Option<String>) -> Request {
        Request {
            method,
            path,
            body,
            bearer: self.bearer.map(str::to_owned),
            client: self.client.map(str::to_owned),
        }
    }

    fn checked(response: Response) -> Result<Response, ApiError> {
        if response.status == 200 || response.status == 204 {
            return Ok(response);
        }
        let body = serde_json::from_str::<ErrorBody>(&response.body).ok();
        if response.status == 426 {
            let min = body.and_then(|b| b.min_version).unwrap_or_default();
            return Err(ApiError::ClientTooOld { min });
        }
        let code = body.map(|b| b.error).unwrap_or_default();
        Err(ApiError::Refused {
            status: response.status,
            code,
        })
    }

    fn call<R: DeserializeOwned>(
        &self,
        method: Method,
        path: String,
        body: Option<String>,
        what: &'static str,
    ) -> Result<R, ApiError> {
        let response = self.send(method, path, body)?;
        serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed(what))
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
            welcome: out.welcome.as_ref().map(|message| WelcomeMessage {
                message: base64(message),
            }),
            group_info: out.group_info.as_deref().map(base64),
            urgent: out.urgent,
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

    /// `getGroupInfo`: the GroupInfo of the latest commit, and its seq (0021).
    pub fn get_group_info(&self, conversation: &str) -> Result<(u64, Vec<u8>), ApiError> {
        let latest: LatestGroupInfo = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/group-info"),
            None,
            "getGroupInfo",
        )?;
        let bytes = from_base64(&latest.group_info).ok_or(ApiError::Malformed("getGroupInfo"))?;
        Ok((latest.seq, bytes))
    }

    /// `uploadKeyPackages`: what this device now holds on the server.
    pub fn upload_key_packages(
        &self,
        packages: &[Vec<u8>],
        last_resort: Option<&[u8]>,
    ) -> Result<Stock, ApiError> {
        let mut body = serde_json::json!({
            "keyPackages": packages.iter().map(|p| base64(p)).collect::<Vec<_>>(),
        });
        if let Some(last_resort) = last_resort {
            body["lastResort"] = base64(last_resort).into();
        }
        let stock = self.call::<Stock>(
            Method::Post,
            "/v1/key-packages".into(),
            Self::json(&body),
            "uploadKeyPackages",
        )?;
        Ok(stock)
    }

    /// `getConversationDevices`: each roster account and the devices the
    /// server still serves, none for a deleted account (0028).
    pub fn conversation_devices(
        &self,
        conversation: &str,
    ) -> Result<Vec<(String, Vec<String>)>, ApiError> {
        let listed: ConversationDevices = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/devices"),
            None,
            "getConversationDevices",
        )?;
        Ok(listed
            .accounts
            .into_iter()
            .map(|a| (a.account_id, a.device_ids))
            .collect())
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

/// The calls about the person and the device (0019).
impl<T: Transport + ?Sized> Api<'_, T> {
    /// `getSignInConfig`.
    pub fn sign_in_config(&self) -> Result<SignInConfig, ApiError> {
        self.call(Method::Get, "/v1/sign-in".into(), None, "getSignInConfig")
    }

    /// `registerDevice`: the server redeems the code with Kenni itself.
    pub fn register_device(&self, registration: &Registration) -> Result<Registered, ApiError> {
        let body = RegisterBody {
            kenni_code: registration.code,
            code_verifier: registration.verifier,
            redirect_uri: registration.redirect_uri,
            nonce: registration.nonce,
            platform: registration.platform,
            device_key: base64(registration.device_key),
            invite_token: registration.invite,
        };
        self.call(
            Method::Post,
            "/v1/devices".into(),
            Self::json(&body),
            "registerDevice",
        )
    }

    /// `getMe`.
    pub fn me(&self) -> Result<Me, ApiError> {
        self.call(Method::Get, "/v1/me".into(), None, "getMe")
    }

    /// `rotateInvite`: the new link; the old one stops working.
    pub fn rotate_invite(&self) -> Result<String, ApiError> {
        let invite: NewInvite = self.call(
            Method::Post,
            "/v1/me/invite".into(),
            Some("{}".into()),
            "rotateInvite",
        )?;
        Ok(invite.link)
    }

    /// `revokeInvite`: the account is left with no working link.
    pub fn revoke_invite(&self) -> Result<(), ApiError> {
        self.send(Method::Delete, "/v1/me/invite".into(), None)
            .map(drop)
    }

    /// `resolveInvite`: who made it, or `None` for the operator's.
    pub fn resolve_invite(&self, token: &str) -> Result<Option<Inviter>, ApiError> {
        let resolved: Resolved = self.call(
            Method::Get,
            format!("/v1/invites/{token}"),
            None,
            "resolveInvite",
        )?;
        Ok(resolved.inviter)
    }

    /// `getAccount`: refused with 404 unless the two accounts share a
    /// conversation.
    pub fn profile(&self, account: &str) -> Result<Profile, ApiError> {
        self.call(
            Method::Get,
            format!("/v1/accounts/{account}"),
            None,
            "getAccount",
        )
    }

    /// `setPushToken` (0025): only this device's own.
    pub fn set_push_token(&self, device: &str, token: &str, sandbox: bool) -> Result<(), ApiError> {
        let body = serde_json::json!({ "token": token, "sandbox": sandbox });
        self.send(
            Method::Put,
            format!("/v1/devices/{device}/push"),
            Self::json(&body),
        )
        .map(drop)
    }

    /// `revokeDevice`.
    pub fn revoke_device(&self, device: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/devices/{device}"), None)
            .map(drop)
    }

    /// `deleteAccount`.
    pub fn delete_account(&self) -> Result<(), ApiError> {
        self.send(Method::Delete, "/v1/me".into(), None).map(drop)
    }

    /// `putMedia`: the sealed file at `file`, under a new id.
    pub fn put_media(&self, conversation: &str, id: &str, file: &Path) -> Result<(), ApiError> {
        let request = self.request(
            Method::Put,
            format!("/v1/conversations/{conversation}/media/{id}"),
            None,
        );
        Self::checked(self.transport.upload(request, file)?).map(drop)
    }

    /// `getMedia`: the sealed file, written to `to`.
    pub fn get_media(&self, conversation: &str, id: &str, to: &Path) -> Result<(), ApiError> {
        let request = self.request(
            Method::Get,
            format!("/v1/conversations/{conversation}/media/{id}"),
            None,
        );
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `blockAccount`: 204 also when already blocked.
    pub fn block(&self, account: &str) -> Result<(), ApiError> {
        self.send(Method::Put, format!("/v1/blocks/{account}"), None)
            .map(drop)
    }

    /// `unblockAccount`: 204 also when not blocked.
    pub fn unblock(&self, account: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/blocks/{account}"), None)
            .map(drop)
    }

    /// `listBlocks`: newest first.
    pub fn blocks(&self) -> Result<Vec<Blocked>, ApiError> {
        let blocks: Blocks = self.call(Method::Get, "/v1/blocks".into(), None, "listBlocks")?;
        Ok(blocks.blocked)
    }
}
