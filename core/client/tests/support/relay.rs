//! An in-memory delivery service with the rules of 0015, 0017, 0020 and 0021,
//! spoken over the same HTTP requests the Worker answers: one seq per
//! conversation, a send answered again by its `clientMsgId`, one commit per
//! epoch from epoch 0, the roster each commit claims, history up to the
//! commit that left an account out, the latest Welcome per account, the
//! GroupInfo of the latest commit, an external commit that keeps the roster,
//! KeyPackages consumed once but the last resort kept. It can lose a request
//! or its answer.
//!
//! Sign-in (0019, 0033) is the Worker's half of it: a device registers with
//! any Kenni or Google code as the account and device its `Link` names, gets
//! a token, and every other call but the two made before sign-in needs that
//! token. A signed-in account links another provider's identity, unless the
//! code is `taken`.
//!
//! Fljótið (0034) is a list of posts newest first, paged by the last post's
//! id, with replies and one reaction per account, and blocks hidden.
//!
//! Media (0023) is kept per conversation for its roster, and blocks (0024)
//! refuse the blocked account the blocker's KeyPackages.
//!
//! It serves a conversation's devices and refuses a claim naming a deleted
//! account (0028), says when each last resort expires (0029), and refuses a
//! client below its floor (0030).

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
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
    /// Accounts deleted while in the roster: no claim names them again.
    departed: BTreeSet<String>,
}

#[derive(Default)]
struct State {
    /// device → account
    devices: BTreeMap<String, String>,
    /// device → its token
    tokens: BTreeMap<String, String>,
    /// device → the token it had when it was revoked
    revoked: BTreeMap<String, String>,
    /// device → its push token and whether it is a sandbox one (0025)
    push: BTreeMap<String, (String, bool)>,
    /// invite token → the account that made it
    invites: BTreeMap<String, String>,
    minted: usize,
    /// Every request each device made, as the server got it.
    requests: BTreeMap<String, Vec<Request>>,
    packages: BTreeMap<String, VecDeque<String>>,
    last_resort: BTreeMap<String, String>,
    /// device → when its last resort expires, in milliseconds (0029).
    last_resort_not_after: BTreeMap<String, u64>,
    /// The lowest version served (0030); a request without one is 0.1.0.
    floor: Option<(u32, u32, u32)>,
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
    /// (conversation, media id) → the blob.
    media: BTreeMap<(String, String), Vec<u8>>,
    /// (blocker, blocked) → when, in a counter for order.
    blocks: BTreeMap<(String, String), u64>,
    blocked_at: u64,
    /// account → the providers it holds an identity of (0033).
    identities: BTreeMap<String, BTreeSet<String>>,
    /// Fljótið, oldest first (0034).
    posts: Vec<Post>,
    /// Ids handed out to posts and replies.
    minted_posts: usize,
}

struct Post {
    id: String,
    author: String,
    body: String,
    /// account → its reaction.
    reactions: BTreeMap<String, String>,
    /// `(reply id, author, body)`, oldest first.
    replies: Vec<(String, String, String)>,
}

pub struct Relay(Mutex<State>);

pub struct Link {
    relay: Arc<Relay>,
    account: String,
    device: String,
}

/// 84 days, as the core builds every KeyPackage (0029).
const KEY_PACKAGE_LIFETIME_MS: u64 = 84 * 24 * 60 * 60 * 1000;

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// The version a `Spjall-Client` value names, 0.1.0 without one (0030).
fn version_of(client: Option<&str>) -> (u32, u32, u32) {
    let Some((_, version)) = client.and_then(|c| c.split_once('/')) else {
        return (0, 1, 0);
    };
    let parts: Vec<u32> = version.split('.').map(|p| p.parse().unwrap()).collect();
    (parts[0], parts[1], parts[2])
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

    /// The push token this device set, as the server holds it.
    pub fn push_token(&self, device: &str) -> Option<(String, bool)> {
        self.state().push.get(device).cloned()
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

    /// The blobs this conversation holds.
    pub fn media(&self, conversation: &str) -> Vec<Vec<u8>> {
        self.state()
            .media
            .iter()
            .filter(|((c, _), _)| c == conversation)
            .map(|(_, blob)| blob.clone())
            .collect()
    }

    /// Changes one byte of every blob the server holds.
    pub fn tamper_media(&self) {
        for blob in self.state().media.values_mut() {
            let middle = blob.len() / 2;
            blob[middle] ^= 1;
        }
    }

    /// The device's last resort now expires in `ms` (0029).
    pub fn age_last_resort(&self, device: &str, ms: u64) {
        self.state()
            .last_resort_not_after
            .insert(device.into(), now() + ms);
    }

    pub fn last_resort(&self, device: &str) -> Option<String> {
        self.state().last_resort.get(device).cloned()
    }

    pub fn packages(&self, device: &str) -> usize {
        self.state().packages.get(device).map_or(0, VecDeque::len)
    }

    /// Revoked from somewhere the test does not hold: the server stops
    /// serving the device.
    pub fn revoke(&self, device: &str) {
        let mut state = self.state();
        state.devices.remove(device);
        if let Some(token) = state.tokens.remove(device) {
            state.revoked.insert(device.into(), token);
        }
    }

    /// A server that kept answering a revoked device's old token, so its
    /// store can be shown what was sent after its removal.
    pub fn answer_revoked(&self, device: &str) {
        let mut state = self.state();
        let token = state.revoked[device].clone();
        state.tokens.insert(device.into(), token);
    }

    /// Below this version every request is refused (0030).
    pub fn set_floor(&self, floor: (u32, u32, u32)) {
        self.state().floor = Some(floor);
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

/// The redirect `getSignInConfig` names for Google: the link host's page.
pub const GOOGLE_REDIRECT: &str = "https://spjall.samtak.is/oauth/google";

/// Where that page sends the browser on to: the app.
pub const GOOGLE_CALLBACK: &str = "is.samtak.spjall:/google";

/// What the browser, Google and the link host's page do with an authorize
/// URL: the app is handed the callback with a code and the same `state`.
pub fn google(authorize: &str) -> String {
    google_with(authorize, "code")
}

/// The same, with a code the fake server reads: `refused` is refused, and a
/// link with `taken` finds the identity on another account.
pub fn google_with(authorize: &str, code: &str) -> String {
    let state = authorize
        .split(['?', '&'])
        .find_map(|p| p.strip_prefix("state="))
        .unwrap();
    format!("{GOOGLE_CALLBACK}?code={code}-{state}&state={state}")
}

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

/// Whether a sign-in's redirect is the one its provider's code is for.
fn redirect_fits(body: &Value) -> bool {
    let redirect = match body["provider"].as_str() {
        Some("google") => GOOGLE_REDIRECT,
        Some("kenni") => REDIRECT,
        _ => return false,
    };
    body["redirectUri"] == redirect
}

fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query
        .split('&')
        .find_map(|p| p.strip_prefix(name)?.strip_prefix('='))
}

impl State {
    fn hides(&self, reader: &str, author: &str) -> bool {
        self.blocks
            .contains_key(&(reader.to_owned(), author.to_owned()))
    }

    fn post_json(&self, reader: &str, post: &Post) -> Value {
        let mut reactions: BTreeMap<&str, u32> = ["heart", "thumbs_up", "laugh", "wow", "sad"]
            .map(|r| (r, 0))
            .into();
        for reaction in post.reactions.values() {
            *reactions.get_mut(reaction.as_str()).unwrap() += 1;
        }
        let replies = post
            .replies
            .iter()
            .filter(|(_, author, _)| !self.hides(reader, author))
            .count();
        json!({
            "postId": post.id,
            "author": { "accountId": post.author, "name": format!("Name of {}", post.author), "verified": false },
            "body": post.body,
            "createdAt": 0,
            "replyCount": replies,
            "reactions": reactions,
            "myReaction": post.reactions.get(reader),
        })
    }

    fn mint(&mut self, kind: &str) -> String {
        self.minted_posts += 1;
        format!("{kind}_{:04}", self.minted_posts)
    }

    /// Fljótið and the walls (0034).
    fn posts(
        &mut self,
        account: &str,
        method: Method,
        parts: &[&str],
        query: &str,
        body: &Value,
    ) -> Response {
        let limit: usize = query_param(query, "limit").map_or(20, |l| l.parse().unwrap());
        let visible = |state: &State, post: &Post| !state.hides(account, &post.author);
        let find = |state: &State, id: &str| {
            state
                .posts
                .iter()
                .position(|p| p.id == id && visible(state, p))
        };
        match (method, parts) {
            (Method::Get, ["feed"] | ["accounts", _, "posts"]) => {
                let author = parts.get(1).filter(|_| parts.len() == 3);
                let before = query_param(query, "before");
                let mut posts = self
                    .posts
                    .iter()
                    .rev()
                    .filter(|p| visible(self, p) && author.is_none_or(|a| p.author == *a))
                    .skip_while(|p| before.is_some_and(|b| p.id.as_str() >= b));
                let page: Vec<&Post> = posts.by_ref().take(limit).collect();
                let more = posts.next().is_some();
                let next = more.then(|| page.last().unwrap().id.clone());
                let page: Vec<Value> = page.iter().map(|p| self.post_json(account, p)).collect();
                answer(200, json!({ "posts": page, "next": next }))
            }
            (Method::Post, ["posts"]) => {
                let id = self.mint("post");
                self.posts.push(Post {
                    id,
                    author: account.into(),
                    body: body["body"].as_str().unwrap().into(),
                    reactions: BTreeMap::new(),
                    replies: Vec::new(),
                });
                answer(201, self.post_json(account, self.posts.last().unwrap()))
            }
            (Method::Get, ["posts", id]) => match find(self, id) {
                Some(i) => answer(200, self.post_json(account, &self.posts[i])),
                None => refuse(404, "not_found"),
            },
            (Method::Delete, ["posts", id]) => match self.posts.iter().position(|p| p.id == *id) {
                Some(i) if self.posts[i].author == account => {
                    self.posts.remove(i);
                    answer(204, Value::Null)
                }
                Some(_) => refuse(403, "not_author"),
                None => refuse(404, "not_found"),
            },
            (Method::Put, ["posts", id, "reaction"]) => match find(self, id) {
                Some(i) if self.hides(&self.posts[i].author, account) => refuse(403, "blocked"),
                Some(i) => {
                    let reaction = body["reaction"].as_str().unwrap().to_owned();
                    self.posts[i].reactions.insert(account.into(), reaction);
                    answer(204, Value::Null)
                }
                None => refuse(404, "not_found"),
            },
            (Method::Delete, ["posts", id, "reaction"]) => {
                if let Some(post) = self.posts.iter_mut().find(|p| p.id == *id) {
                    post.reactions.remove(account);
                }
                answer(204, Value::Null)
            }
            (Method::Get, ["posts", id, "replies"]) => match find(self, id) {
                Some(i) => {
                    let after = query_param(query, "after");
                    let mut replies = self.posts[i]
                        .replies
                        .iter()
                        .filter(|(_, author, _)| !self.hides(account, author))
                        .skip_while(|(r, _, _)| after.is_some_and(|a| r.as_str() <= a));
                    let page: Vec<_> = replies.by_ref().take(limit).collect();
                    let next = replies.next().map(|_| page.last().unwrap().0.clone());
                    let page: Vec<Value> = page
                        .into_iter()
                        .map(|(r, author, text)| {
                            json!({
                                "replyId": r, "postId": id, "body": text, "createdAt": 0,
                                "author": { "accountId": author, "name": null, "verified": false },
                            })
                        })
                        .collect();
                    answer(200, json!({ "replies": page, "next": next }))
                }
                None => refuse(404, "not_found"),
            },
            (Method::Post, ["posts", id, "replies"]) => match find(self, id) {
                Some(i) if self.hides(&self.posts[i].author, account) => refuse(403, "blocked"),
                Some(i) => {
                    let reply = self.mint("reply");
                    let text = body["body"].as_str().unwrap().to_owned();
                    self.posts[i]
                        .replies
                        .push((reply.clone(), account.into(), text.clone()));
                    answer(
                        201,
                        json!({
                            "replyId": reply, "postId": id, "body": text, "createdAt": 0,
                            "author": { "accountId": account, "name": null, "verified": false },
                        }),
                    )
                }
                None => refuse(404, "not_found"),
            },
            (Method::Delete, ["replies", id]) => {
                for post in &mut self.posts {
                    if let Some(i) = post.replies.iter().position(|(r, _, _)| r == id) {
                        if post.replies[i].1 != account {
                            return refuse(403, "not_author");
                        }
                        post.replies.remove(i);
                        return answer(204, Value::Null);
                    }
                }
                refuse(404, "not_found")
            }
            _ => refuse(404, "not_found"),
        }
    }

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
        if let Some(floor) = self.floor
            && version_of(request.client.as_deref()) < floor
        {
            let (x, y, z) = floor;
            return answer(
                426,
                json!({ "error": "client_too_old", "minVersion": format!("{x}.{y}.{z}") }),
            );
        }
        match (request.method, parts.as_slice()) {
            (Method::Get, ["sign-in"]) if query == "provider=google" => answer(
                200,
                json!({
                    "authorizationEndpoint": "https://accounts.test/o/oauth2/v2/auth",
                    "clientId": "google-client.test",
                    "redirectUri": GOOGLE_REDIRECT,
                    "scope": "openid email profile",
                }),
            ),
            (Method::Get, ["sign-in"]) => answer(
                200,
                json!({
                    "authorizationEndpoint": "https://kenni.test/oidc/auth",
                    "clientId": "@innskraning.is/spjall",
                    "redirectUri": REDIRECT,
                    "scope": "openid national_id audkenni_name",
                }),
            ),
            (Method::Post, ["devices"]) => {
                if body["code"] == "refused" || !redirect_fits(&body) {
                    return refuse(403, "sign_in_failed");
                }
                if let Some(invite) = body["inviteToken"].as_str()
                    && !self.invites.contains_key(invite)
                {
                    return refuse(403, "invite_invalid");
                }
                let token = format!("token-{device}");
                self.identities
                    .entry(account.into())
                    .or_default()
                    .insert(body["provider"].as_str().unwrap().into());
                self.devices.insert(device.into(), account.into());
                self.tokens.insert(device.into(), token.clone());
                answer(
                    200,
                    json!({ "accountId": account, "deviceId": device, "token": token }),
                )
            }
            (Method::Post, ["me", "identities"]) => {
                if !redirect_fits(&body) {
                    return refuse(403, "sign_in_failed");
                }
                let code = body["code"].as_str().unwrap();
                if code.starts_with("taken-") {
                    return refuse(409, "identity_taken");
                }
                // `held-<account>`: that account holds the kennitala and no
                // Google identity, so a client that follows a move is joined
                // into it (0035).
                if let Some(into) = code.strip_prefix("held-") {
                    if body["merge"] != true {
                        return refuse(409, "identity_taken");
                    }
                    let held = self.identities.remove(account).unwrap_or_default();
                    self.identities.entry(into.into()).or_default().extend(held);
                    let gone: Vec<String> = self
                        .devices
                        .iter()
                        .filter(|(d, a)| *a == account && *d != device)
                        .map(|(d, _)| d.clone())
                        .collect();
                    for d in gone {
                        self.devices.remove(&d);
                        self.tokens.remove(&d);
                    }
                    self.devices.insert(device.into(), into.into());
                    self.packages.remove(device);
                    self.last_resort.remove(device);
                    self.last_resort_not_after.remove(device);
                    for conversation in self.conversations.values_mut() {
                        if conversation.roster.remove(account) {
                            conversation.departed.insert(account.to_owned());
                        }
                    }
                    return answer(200, json!({ "accountId": into }));
                }
                self.identities
                    .entry(account.into())
                    .or_default()
                    .insert(body["provider"].as_str().unwrap().into());
                if body["merge"] == true {
                    answer(200, json!({ "accountId": account }))
                } else {
                    answer(204, Value::Null)
                }
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
                let verified = self
                    .identities
                    .get(account)
                    .is_some_and(|i| i.contains("kenni"));
                answer(
                    200,
                    json!({ "accountId": account, "name": format!("Name of {account}"), "verified": verified, "devices": devices }),
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
                for conversation in self.conversations.values_mut() {
                    if conversation.roster.remove(account) {
                        conversation.departed.insert(account.to_owned());
                    }
                }
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
            // Named to any account (0034).
            (Method::Get, ["accounts", id]) => {
                if self.devices.values().any(|a| a == id) {
                    answer(
                        200,
                        json!({ "accountId": id, "name": format!("Name of {id}"), "verified": true }),
                    )
                } else {
                    refuse(404, "not_found")
                }
            }
            // Every other account with a device, less blocks either way
            // (0036), by id; a page's cursor is its last account.
            (Method::Get, ["people"]) => {
                let limit: usize = query_param(query, "limit").map_or(30, |l| l.parse().unwrap());
                let search = query_param(query, "q").map(|q| q.to_lowercase());
                let after = query_param(query, "after");
                let accounts: BTreeSet<&String> = self.devices.values().collect();
                let mut listed = accounts
                    .into_iter()
                    .filter(|a| *a != account && !self.hides(account, a) && !self.hides(a, account))
                    .filter(|a| {
                        search
                            .as_ref()
                            .is_none_or(|q| format!("name of {a}").contains(q.as_str()))
                    })
                    .filter(|a| after.is_none_or(|after| a.as_str() > after));
                let page: Vec<&String> = listed.by_ref().take(limit).collect();
                let next = listed.next().map(|_| page.last().unwrap().to_string());
                let people: Vec<Value> = page
                    .iter()
                    .map(|a| json!({ "accountId": a, "name": format!("Name of {a}"), "verified": false }))
                    .collect();
                answer(200, json!({ "people": people, "next": next }))
            }
            (Method::Put, ["blocks", id]) => {
                if *id == account {
                    return refuse(400, "invalid_request");
                }
                if !self.devices.values().any(|a| a == id) {
                    return refuse(404, "not_found");
                }
                self.blocked_at += 1;
                let at = self.blocked_at;
                self.blocks
                    .entry((account.to_owned(), (*id).to_owned()))
                    .or_insert(at);
                answer(204, Value::Null)
            }
            (Method::Delete, ["blocks", id]) => {
                self.blocks.remove(&(account.to_owned(), (*id).to_owned()));
                answer(204, Value::Null)
            }
            (Method::Get, ["blocks"]) => {
                let mut blocked: Vec<(&u64, &String)> = self
                    .blocks
                    .iter()
                    .filter(|((by, _), _)| by == account)
                    .map(|((_, id), at)| (at, id))
                    .collect();
                blocked.sort();
                let blocked: Vec<Value> = blocked
                    .into_iter()
                    .rev()
                    .map(|(at, id)| {
                        json!({ "accountId": id, "name": format!("Name of {id}"), "verified": true, "blockedAt": at })
                    })
                    .collect();
                answer(200, json!({ "blocked": blocked }))
            }
            (Method::Delete, ["devices", id]) => {
                if self.devices.get(*id).map(String::as_str) != Some(account) {
                    return refuse(404, "not_found");
                }
                self.devices.remove(*id);
                if let Some(token) = self.tokens.remove(*id) {
                    self.revoked.insert((*id).to_owned(), token);
                }
                self.push.remove(*id);
                answer(204, Value::Null)
            }
            (Method::Put, ["devices", id, "push"]) => {
                if *id != device {
                    return refuse(403, "not_this_device");
                }
                let token = body["token"].as_str().unwrap().to_owned();
                let sandbox = body["sandbox"].as_bool().unwrap_or(false);
                self.push.retain(|_, (t, _)| *t != token);
                self.push.insert(device.to_owned(), (token, sandbox));
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
                        departed: BTreeSet::new(),
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
            (Method::Get, ["conversations", id, "devices"]) => {
                let Some(conversation) = self.conversations.get(*id) else {
                    return refuse(404, "not_found");
                };
                if !conversation.roster.contains(account) {
                    return refuse(403, "not_a_member");
                }
                let accounts: Vec<Value> = conversation
                    .roster
                    .iter()
                    .map(|a| {
                        let ids: Vec<&String> = self
                            .devices
                            .iter()
                            .filter(|(_, owner)| *owner == a)
                            .map(|(d, _)| d)
                            .collect();
                        json!({ "accountId": a, "deviceIds": ids })
                    })
                    .collect();
                answer(200, json!({ "accounts": accounts }))
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
                    self.last_resort_not_after
                        .insert(device.into(), now() + KEY_PACKAGE_LIFETIME_MS);
                }
                answer(
                    200,
                    json!({
                        "available": available,
                        "lastResortNotAfter": self.last_resort_not_after.get(device),
                    }),
                )
            }
            (Method::Post, ["accounts", owner, "key-packages"]) => {
                if self
                    .blocks
                    .contains_key(&((*owner).to_owned(), account.to_owned()))
                {
                    return refuse(403, "blocked");
                }
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
            (_, ["feed"] | ["posts", ..] | ["replies", _] | ["accounts", _, "posts"]) => {
                self.posts(account, request.method, &parts, query, &body)
            }
            _ => refuse(404, "not_found"),
        }
    }

    /// The conversation and media id a media request names, once its
    /// token and roster are checked.
    fn media_of(
        &self,
        account: &str,
        device: &str,
        request: &Request,
    ) -> Result<(String, String), Response> {
        if request.bearer.is_none() || self.tokens.get(device) != request.bearer.as_ref() {
            return Err(refuse(401, "unauthorized"));
        }
        let parts: Vec<&str> = request.path.split('/').skip(2).collect();
        let ["conversations", id, "media", object] = parts.as_slice() else {
            return Err(refuse(404, "not_found"));
        };
        let Some(conversation) = self.conversations.get(*id) else {
            return Err(refuse(404, "not_found"));
        };
        if !conversation.roster.contains(account) {
            return Err(refuse(403, "not_a_member"));
        }
        Ok(((*id).to_owned(), (*object).to_owned()))
    }

    fn put_media(
        &mut self,
        account: &str,
        device: &str,
        request: &Request,
        blob: Vec<u8>,
    ) -> Response {
        let key = match self.media_of(account, device, request) {
            Ok(key) => key,
            Err(refused) => return refused,
        };
        // 25 MiB, and a tag per 64 KiB segment.
        if blob.len() > 25 * 1024 * 1024 + 16 * 400 {
            return refuse(413, "too_large");
        }
        if self.media.contains_key(&key) {
            return refuse(409, "conflict");
        }
        self.media.insert(key, blob);
        answer(204, Value::Null)
    }

    fn get_media(
        &self,
        account: &str,
        device: &str,
        request: &Request,
    ) -> (Response, Option<Vec<u8>>) {
        let key = match self.media_of(account, device, request) {
            Ok(key) => key,
            Err(refused) => return (refused, None),
        };
        match self.media.get(&key) {
            Some(blob) => (answer(200, Value::Null), Some(blob.clone())),
            None => (refuse(404, "not_found"), None),
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
            if after.iter().any(|a| conversation.departed.contains(a)) {
                return refuse(409, "claim_names_departed");
            }
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

impl Link {
    /// Loses the request or its answer as the counters say, logs it, and
    /// lets the server `act` on it.
    fn through(
        &self,
        request: Request,
        act: impl FnOnce(&mut State, &str, &str, Request) -> Response,
    ) -> Result<Response, Unreachable> {
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
        // The account the server holds the device under, which a join
        // changes (0035).
        let account = state
            .devices
            .get(&self.device)
            .cloned()
            .unwrap_or_else(|| self.account.clone());
        let response = act(&mut state, &account, &self.device, request);
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

impl Transport for Link {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        self.through(request, |state, account, device, request| {
            state.handle(account, device, request)
        })
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        assert_eq!(request.method, Method::Put);
        let blob = std::fs::read(file).unwrap();
        self.through(request, |state, account, device, request| {
            state.put_media(account, device, &request, blob)
        })
    }

    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        assert_eq!(request.method, Method::Get);
        self.through(request, |state, account, device, request| {
            let (response, blob) = state.get_media(account, device, &request);
            if let Some(blob) = blob {
                std::fs::write(to, blob).unwrap();
                return Response {
                    status: 200,
                    body: String::new(),
                };
            }
            response
        })
    }
}
