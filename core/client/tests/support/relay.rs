//! An in-memory delivery service with the rules of 0015, 0017, 0020 and 0021,
//! spoken over the same HTTP requests the Worker answers: one seq per
//! conversation, a send answered again by its `clientMsgId`, one commit per
//! epoch from epoch 0, the roster each commit claims, history up to the
//! commit that left an account out, the latest Welcome per account, the
//! GroupInfo of the latest commit, an external commit that keeps the roster,
//! KeyPackages consumed once but the last resort kept. It can lose a request
//! or its answer.
//!
//! Sign-in (0019) is the Worker's half of it: a device registers with any
//! Kenni code as the account and device its `Link` names, gets a token, and
//! every other call but the two made before sign-in needs that token.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use openmls::prelude::tls_codec::Deserialize as _;
use openmls::prelude::{ContentType, MlsMessageBodyIn, MlsMessageIn, ProtocolMessage, Sender};
use serde_json::{Value, json};
use spjall_client::api::{Method, Request, Response, Transport, Unreachable};
use spjall_mls::group::claim_of;

struct Stored {
    seq: u64,
    sender: String,
    client_msg_id: String,
    ciphertext: String,
}

struct Conversation {
    creator: String,
    roster: BTreeSet<String>,
    messages: Vec<Stored>,
    last_epoch: Option<u64>,
    /// `(seq, Welcome, accounts it is for)`.
    welcomes: Vec<(u64, String, Vec<String>)>,
    /// Messages before this seq have expired.
    expired_to: u64,
    /// account → the seq of the commit whose claim left it out.
    removed: BTreeMap<String, u64>,
    /// The latest commit's seq and GroupInfo.
    group_info: Option<(u64, String)>,
}

#[derive(Default)]
struct State {
    /// device → account
    devices: BTreeMap<String, String>,
    /// device → its token
    tokens: BTreeMap<String, String>,
    /// invite token → the account that made it
    invites: BTreeMap<String, String>,
    minted: usize,
    /// Every request each device made, as the server got it.
    requests: BTreeMap<String, Vec<Request>>,
    packages: BTreeMap<String, VecDeque<String>>,
    last_resort: BTreeMap<String, String>,
    conversations: BTreeMap<String, Conversation>,
    /// Frames waiting for each device's socket.
    frames: BTreeMap<String, Vec<String>>,
    /// Requests that will fail before reaching the server, per device.
    fail: BTreeMap<String, usize>,
    /// Requests whose answer will be lost after the server acted, per device.
    lose: BTreeMap<String, usize>,
    /// The same, for `sendMessage` alone.
    fail_sends: BTreeMap<String, usize>,
    lose_sends: BTreeMap<String, usize>,
    /// Every `sendMessage` body the server received, per device.
    sends: BTreeMap<String, Vec<Value>>,
    page: usize,
}

pub struct Relay(Mutex<State>);

pub struct Link {
    relay: Arc<Relay>,
    account: String,
    device: String,
}

fn answer(status: u16, body: Value) -> Response {
    Response {
        status,
        body: body.to_string(),
    }
}

fn refuse(status: u16, code: &str) -> Response {
    answer(status, json!({ "error": code }))
}

impl Relay {
    fn state(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap()
    }

    pub fn new() -> Arc<Self> {
        Arc::new(Self(Mutex::new(State {
            page: 3,
            ..State::default()
        })))
    }

    pub fn requests(&self, device: &str) -> Vec<Request> {
        self.state()
            .requests
            .get(device)
            .cloned()
            .unwrap_or_default()
    }

    pub fn registered(&self, device: &str) -> bool {
        self.state().devices.contains_key(device)
    }

    pub fn link(self: &Arc<Self>, account: &str, device: &str) -> Link {
        Link {
            relay: self.clone(),
            account: account.into(),
            device: device.into(),
        }
    }

    /// The next `n` requests from this device never reach the server.
    pub fn fail_next(&self, device: &str, n: usize) {
        self.state().fail.insert(device.into(), n);
    }

    /// The server acts on the next `n` requests from this device, but their
    /// answers are lost.
    pub fn lose_next(&self, device: &str, n: usize) {
        self.state().lose.insert(device.into(), n);
    }

    /// The next `n` sends from this device never reach the server; its
    /// other requests do.
    pub fn fail_sends(&self, device: &str, n: usize) {
        self.state().fail_sends.insert(device.into(), n);
    }

    /// The server stores the next `n` sends from this device, but their
    /// answers are lost.
    pub fn lose_sends(&self, device: &str, n: usize) {
        self.state().lose_sends.insert(device.into(), n);
    }

    pub fn sends(&self, device: &str) -> Vec<Value> {
        self.state().sends.get(device).cloned().unwrap_or_default()
    }

    pub fn stored(&self, conversation: &str) -> usize {
        self.state().conversations[conversation].messages.len()
    }

    /// Retention ran: every message up to `seq` is gone.
    pub fn expire(&self, conversation: &str, seq: u64) {
        let mut state = self.state();
        let conversation = state.conversations.get_mut(conversation).unwrap();
        conversation.messages.retain(|m| m.seq > seq);
        conversation.expired_to = seq;
    }

    pub fn frames(&self, device: &str) -> Vec<String> {
        self.state().frames.remove(device).unwrap_or_default()
    }

    /// A frame a device sent on its socket.
    pub fn socket(&self, account: &str, frame: &str) {
        let frame: Value = serde_json::from_str(frame).unwrap();
        if frame["type"] != "typing" {
            return;
        }
        let mut state = self.state();
        let conversation = frame["conversationId"].as_str().unwrap();
        let members = state.conversations[conversation].roster.clone();
        let to: Vec<String> = state
            .devices
            .iter()
            .filter(|(_, a)| members.contains(*a) && *a != account)
            .map(|(d, _)| d.clone())
            .collect();
        for device in to {
            state
                .frames
                .entry(device)
                .or_default()
                .push(frame.to_string());
        }
    }
}

/// The redirect `getSignInConfig` names.
pub const REDIRECT: &str = "is.samtak.spjall:/kenni";

/// What the browser and Kenni do with an authorize URL: the person signs
/// in, and the app is handed the callback with a code and the same `state`.
pub fn kenni(authorize: &str) -> String {
    let state = authorize
        .split(['?', '&'])
        .find_map(|p| p.strip_prefix("state="))
        .unwrap();
    format!("{REDIRECT}?code=code-{state}&state={state}")
}

struct Framing {
    group: Vec<u8>,
    epoch: u64,
    commit: bool,
    /// An external commit (0021).
    external: bool,
}

fn framing(bytes: &[u8]) -> Option<Framing> {
    let message = MlsMessageIn::tls_deserialize_exact(bytes)
        .ok()?
        .try_into_protocol_message()
        .ok()?;
    let external = matches!(&message, ProtocolMessage::PublicMessage(public)
        if matches!(public.sender(), Sender::NewMemberCommit));
    Some(Framing {
        group: message.group_id().as_slice().to_vec(),
        epoch: message.epoch().as_u64(),
        commit: message.content_type() == ContentType::Commit,
        external,
    })
}

/// A GroupInfo's group id and epoch.
fn group_info_of(bytes: &[u8]) -> Option<(Vec<u8>, u64)> {
    match MlsMessageIn::tls_deserialize_exact(bytes).ok()?.extract() {
        MlsMessageBodyIn::GroupInfo(info) => {
            Some((info.group_id().as_slice().to_vec(), info.epoch().as_u64()))
        }
        _ => None,
    }
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().map(|v| v.as_str().unwrap().to_owned()).collect())
        .unwrap_or_default()
}

impl State {
    fn notify(&mut self, accounts: &BTreeSet<String>, conversation: &str, seq: u64) {
        let frame = json!({ "type": "notify", "conversationId": conversation, "seq": seq });
        let to: Vec<String> = self
            .devices
            .iter()
            .filter(|(_, a)| accounts.contains(*a))
            .map(|(d, _)| d.clone())
            .collect();
        for device in to {
            self.frames
                .entry(device)
                .or_default()
                .push(frame.to_string());
        }
    }

    fn handle(&mut self, account: &str, device: &str, request: Request) -> Response {
        let body: Value = request
            .body
            .as_deref()
            .map(|b| serde_json::from_str(b).unwrap())
            .unwrap_or(Value::Null);
        let (path, query) = request.path.split_once('?').unwrap_or((&request.path, ""));
        let parts: Vec<&str> = path.split('/').skip(2).collect();
        let before_sign_in = matches!(
            (request.method, parts.as_slice()),
            (Method::Get, ["sign-in"])
                | (Method::Post, ["devices"])
                | (Method::Get, ["invites", _])
        );
        if !before_sign_in
            && (request.bearer.is_none() || self.tokens.get(device) != request.bearer.as_ref())
        {
            return refuse(401, "unauthorized");
        }
        match (request.method, parts.as_slice()) {
            (Method::Get, ["sign-in"]) => answer(
                200,
                json!({
                    "authorizationEndpoint": "https://kenni.test/oidc/auth",
                    "clientId": "@innskraning.is/samtak-spjall",
                    "redirectUri": REDIRECT,
                    "scope": "openid national_id audkenni_name",
                }),
            ),
            (Method::Post, ["devices"]) => {
                if body["kenniCode"] == "refused" {
                    return refuse(403, "sign_in_failed");
                }
                if let Some(invite) = body["inviteToken"].as_str()
                    && !self.invites.contains_key(invite)
                {
                    return refuse(403, "invite_invalid");
                }
                let token = format!("token-{device}");
                self.devices.insert(device.into(), account.into());
                self.tokens.insert(device.into(), token.clone());
                answer(
                    200,
                    json!({ "accountId": account, "deviceId": device, "token": token }),
                )
            }
            (Method::Get, ["me"]) => {
                let devices: Vec<Value> = self
                    .devices
                    .iter()
                    .filter(|(_, a)| *a == account)
                    .map(|(d, _)| {
                        json!({ "deviceId": d, "platform": "android", "createdAt": 0, "current": d == device })
                    })
                    .collect();
                answer(
                    200,
                    json!({ "accountId": account, "name": null, "verified": true, "devices": devices }),
                )
            }
            (Method::Delete, ["me"]) => {
                let gone: Vec<String> = self
                    .devices
                    .iter()
                    .filter(|(_, a)| *a == account)
                    .map(|(d, _)| d.clone())
                    .collect();
                for d in gone {
                    self.devices.remove(&d);
                    self.tokens.remove(&d);
                }
                self.invites.retain(|_, a| a != account);
                answer(204, Value::Null)
            }
            (Method::Post, ["me", "invite"]) => {
                self.invites.retain(|_, a| a != account);
                self.minted += 1;
                let token = format!("invite-{device}-{:08}", self.minted);
                self.invites.insert(token.clone(), account.into());
                answer(
                    200,
                    json!({ "token": token, "link": format!("https://spjall.samtak.is/l/{token}") }),
                )
            }
            (Method::Delete, ["me", "invite"]) => {
                self.invites.retain(|_, a| a != account);
                answer(204, Value::Null)
            }
            (Method::Get, ["invites", token]) => match self.invites.get(*token) {
                Some(inviter) => answer(
                    200,
                    json!({ "inviter": { "accountId": inviter, "name": null, "verified": true } }),
                ),
                None => refuse(404, "not_found"),
            },
            // Named only to an account it shares a conversation with.
            (Method::Get, ["accounts", id]) => {
                let shared = self
                    .conversations
                    .values()
                    .any(|c| c.roster.contains(account) && c.roster.contains(*id));
                if shared {
                    answer(
                        200,
                        json!({ "accountId": id, "name": format!("Name of {id}"), "verified": true }),
                    )
                } else {
                    refuse(404, "not_found")
                }
            }
            (Method::Delete, ["devices", id]) => {
                if self.devices.get(*id).map(String::as_str) != Some(account) {
                    return refuse(404, "not_found");
                }
                self.devices.remove(*id);
                self.tokens.remove(*id);
                answer(204, Value::Null)
            }
            (Method::Post, ["conversations"]) => {
                let id = body["conversationId"].as_str().unwrap();
                if let Some(existing) = self.conversations.get(id) {
                    return if existing.creator == account {
                        answer(200, json!({ "conversationId": id }))
                    } else {
                        refuse(409, "conversation_exists")
                    };
                }
                self.conversations.insert(
                    id.into(),
                    Conversation {
                        creator: account.into(),
                        roster: BTreeSet::from([account.to_owned()]),
                        messages: Vec::new(),
                        last_epoch: None,
                        welcomes: Vec::new(),
                        removed: BTreeMap::new(),
                        expired_to: 0,
                        group_info: None,
                    },
                );
                answer(200, json!({ "conversationId": id }))
            }
            (Method::Post, ["conversations", id, "messages"]) => {
                self.sends
                    .entry(device.into())
                    .or_default()
                    .push(body.clone());
                self.send(account, id, &body)
            }
            (Method::Get, ["conversations", id, "messages"]) => {
                let Some(conversation) = self.conversations.get(*id) else {
                    return refuse(404, "not_found");
                };
                let after: u64 = query.strip_prefix("after=").unwrap().parse().unwrap();
                let last = if conversation.roster.contains(account) {
                    u64::MAX
                } else {
                    match conversation.removed.get(account) {
                        Some(&removed) if after < removed => removed,
                        _ => return refuse(403, "not_a_member"),
                    }
                };
                let rows: Vec<&Stored> = conversation
                    .messages
                    .iter()
                    .filter(|m| m.seq > after && m.seq <= last)
                    .collect();
                let messages: Vec<Value> = rows
                    .iter()
                    .take(self.page)
                    .map(|m| json!({ "seq": m.seq, "ciphertext": m.ciphertext }))
                    .collect();
                answer(
                    200,
                    json!({ "messages": messages, "more": rows.len() > self.page }),
                )
            }
            (Method::Get, ["conversations", id, "welcome"]) => {
                let Some(conversation) = self.conversations.get(*id) else {
                    return refuse(404, "not_found");
                };
                if !conversation.roster.contains(account) {
                    return refuse(403, "not_a_member");
                }
                match conversation
                    .welcomes
                    .iter()
                    .rev()
                    .find(|(_, _, to)| to.iter().any(|a| a == account))
                {
                    Some((seq, welcome, _)) => {
                        answer(200, json!({ "seq": seq, "welcome": welcome }))
                    }
                    None => refuse(404, "not_found"),
                }
            }
            (Method::Get, ["conversations", id, "group-info"]) => {
                let Some(conversation) = self.conversations.get(*id) else {
                    return refuse(404, "not_found");
                };
                if !conversation.roster.contains(account) {
                    return refuse(403, "not_a_member");
                }
                match &conversation.group_info {
                    Some((seq, group_info)) => {
                        answer(200, json!({ "seq": seq, "groupInfo": group_info }))
                    }
                    None => refuse(404, "not_found"),
                }
            }
            (Method::Post, ["key-packages"]) => {
                let queue = self.packages.entry(device.into()).or_default();
                queue.extend(strings(&body["keyPackages"]));
                let available = queue.len();
                if let Some(last) = body["lastResort"].as_str() {
                    self.last_resort.insert(device.into(), last.into());
                }
                answer(200, json!({ "available": available }))
            }
            (Method::Post, ["accounts", owner, "key-packages"]) => {
                let devices: Vec<String> = self
                    .devices
                    .iter()
                    .filter(|(_, a)| a == owner)
                    .map(|(d, _)| d.clone())
                    .collect();
                if devices.is_empty() {
                    return refuse(404, "not_found");
                }
                let mut claimed = Vec::new();
                for other in devices.into_iter().filter(|d| d != device) {
                    let package = self
                        .packages
                        .get_mut(&other)
                        .and_then(VecDeque::pop_front)
                        .or_else(|| self.last_resort.get(&other).cloned());
                    if let Some(package) = package {
                        claimed.push(json!({ "deviceId": other, "keyPackage": package }));
                    }
                }
                answer(200, json!({ "keyPackages": claimed }))
            }
            _ => refuse(404, "not_found"),
        }
    }

    fn send(&mut self, account: &str, id: &str, body: &Value) -> Response {
        let Some(conversation) = self.conversations.get_mut(id) else {
            return refuse(404, "not_found");
        };
        if !conversation.roster.contains(account) {
            return refuse(403, "not_a_member");
        }
        let client_msg_id = body["clientMsgId"].as_str().unwrap();
        if let Some(m) = conversation
            .messages
            .iter()
            .find(|m| m.sender == account && m.client_msg_id == client_msg_id)
        {
            return answer(200, json!({ "seq": m.seq }));
        }
        let ciphertext = body["ciphertext"].as_str().unwrap();
        let Some(Framing {
            group,
            epoch,
            commit,
            external,
        }) = framing(&STANDARD.decode(ciphertext).unwrap())
        else {
            return refuse(400, "invalid_request");
        };
        if URL_SAFE_NO_PAD.encode(&group) != id {
            return refuse(400, "group_mismatch");
        }
        let group_info = body["groupInfo"].as_str();
        if commit != group_info.is_some() {
            return refuse(400, "invalid_request");
        }
        if let Some(group_info) = group_info
            && group_info_of(&STANDARD.decode(group_info).unwrap()) != Some((group, epoch + 1))
        {
            return refuse(400, "invalid_request");
        }
        let welcome = &body["welcome"];
        let before = conversation.roster.clone();
        let mut after = before.clone();
        let mut welcome_to = Vec::new();
        if commit {
            let Some(claim) = claim_of(&STANDARD.decode(ciphertext).unwrap()) else {
                return refuse(400, "invalid_request");
            };
            if !claim.roster.iter().any(|a| a == account)
                || claim.welcome.is_empty() != welcome.is_null()
            {
                return refuse(400, "invalid_request");
            }
            after = claim.roster.into_iter().collect();
            if claim.welcome.iter().any(|a| !after.contains(a)) {
                return refuse(400, "welcome_not_a_member");
            }
            welcome_to = claim.welcome;
            if epoch != conversation.last_epoch.map_or(0, |last| last + 1) {
                return refuse(409, "epoch_conflict");
            }
            // Joining adds a device, never an account; checked against the
            // roster of the epoch it was made on.
            if external && after != before {
                return refuse(400, "invalid_request");
            }
        } else if !welcome.is_null() {
            return refuse(400, "invalid_request");
        }
        let seq = conversation
            .messages
            .last()
            .map_or(conversation.expired_to, |m| m.seq)
            + 1;
        conversation.messages.push(Stored {
            seq,
            sender: account.into(),
            client_msg_id: client_msg_id.into(),
            ciphertext: ciphertext.into(),
        });
        if commit {
            conversation.last_epoch = Some(epoch);
            for gone in before.difference(&after) {
                conversation.removed.insert(gone.clone(), seq);
            }
            for present in &after {
                conversation.removed.remove(present);
            }
            conversation.roster = after.clone();
            conversation.group_info = group_info.map(|g| (seq, g.into()));
            if let Some(message) = welcome["message"].as_str() {
                conversation
                    .welcomes
                    .push((seq, message.into(), welcome_to));
            }
        }
        let everyone = before.union(&after).cloned().collect();
        self.notify(&everyone, id, seq);
        answer(200, json!({ "seq": seq }))
    }
}

impl Transport for Link {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        let mut state = self.relay.state();
        let send = request.method == Method::Post && request.path.ends_with("/messages");
        if let Some(n) = state.fail.get_mut(&self.device).filter(|n| **n > 0) {
            *n -= 1;
            return Err(Unreachable("the request was lost".into()));
        }
        if let Some(n) = state
            .fail_sends
            .get_mut(&self.device)
            .filter(|n| send && **n > 0)
        {
            *n -= 1;
            return Err(Unreachable("the request was lost".into()));
        }
        state
            .requests
            .entry(self.device.clone())
            .or_default()
            .push(request.clone());
        let response = state.handle(&self.account, &self.device, request);
        if let Some(n) = state.lose.get_mut(&self.device).filter(|n| **n > 0) {
            *n -= 1;
            return Err(Unreachable("the answer was lost".into()));
        }
        if let Some(n) = state
            .lose_sends
            .get_mut(&self.device)
            .filter(|n| send && **n > 0)
        {
            *n -= 1;
            return Err(Unreachable("the answer was lost".into()));
        }
        Ok(response)
    }
}
