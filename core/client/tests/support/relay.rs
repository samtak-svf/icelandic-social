//! An in-memory delivery service with the rules of 0015 and 0017, spoken
//! over the same HTTP requests the Worker answers: one seq per conversation,
//! a send answered again by its `clientMsgId`, one commit per epoch, the
//! roster commits move, the latest Welcome per account, KeyPackages consumed
//! once but the last resort kept. It can lose a request or its answer.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::rc::Rc;

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use openmls::prelude::tls_codec::Deserialize as _;
use openmls::prelude::{ContentType, MlsMessageIn};
use serde_json::{Value, json};
use spjall_client::api::{Method, Request, Response, Transport, Unreachable};

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
}

#[derive(Default)]
struct State {
    /// device → account
    devices: BTreeMap<String, String>,
    packages: BTreeMap<String, VecDeque<String>>,
    last_resort: BTreeMap<String, String>,
    conversations: BTreeMap<String, Conversation>,
    /// Frames waiting for each device's socket.
    frames: BTreeMap<String, Vec<String>>,
    /// Requests that will fail before reaching the server, per device.
    fail: BTreeMap<String, usize>,
    /// Requests whose answer will be lost after the server acted, per device.
    lose: BTreeMap<String, usize>,
    /// Every `sendMessage` body the server received, per device.
    sends: BTreeMap<String, Vec<Value>>,
    page: usize,
}

pub struct Relay(RefCell<State>);

pub struct Link {
    relay: Rc<Relay>,
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
    pub fn new() -> Rc<Self> {
        Rc::new(Self(RefCell::new(State {
            page: 3,
            ..State::default()
        })))
    }

    pub fn register(&self, account: &str, device: &str) {
        self.0
            .borrow_mut()
            .devices
            .insert(device.into(), account.into());
    }

    pub fn link(self: &Rc<Self>, account: &str, device: &str) -> Link {
        Link {
            relay: self.clone(),
            account: account.into(),
            device: device.into(),
        }
    }

    /// The next `n` requests from this device never reach the server.
    pub fn fail_next(&self, device: &str, n: usize) {
        self.0.borrow_mut().fail.insert(device.into(), n);
    }

    /// The server acts on the next `n` requests from this device, but their
    /// answers are lost.
    pub fn lose_next(&self, device: &str, n: usize) {
        self.0.borrow_mut().lose.insert(device.into(), n);
    }

    pub fn sends(&self, device: &str) -> Vec<Value> {
        self.0
            .borrow()
            .sends
            .get(device)
            .cloned()
            .unwrap_or_default()
    }

    pub fn stored(&self, conversation: &str) -> usize {
        self.0.borrow().conversations[conversation].messages.len()
    }

    /// Retention ran: every message up to `seq` is gone.
    pub fn expire(&self, conversation: &str, seq: u64) {
        let mut state = self.0.borrow_mut();
        let conversation = state.conversations.get_mut(conversation).unwrap();
        conversation.messages.retain(|m| m.seq > seq);
        conversation.expired_to = seq;
    }

    pub fn frames(&self, device: &str) -> Vec<String> {
        self.0
            .borrow_mut()
            .frames
            .remove(device)
            .unwrap_or_default()
    }

    /// A frame a device sent on its socket.
    pub fn socket(&self, account: &str, frame: &str) {
        let frame: Value = serde_json::from_str(frame).unwrap();
        if frame["type"] != "typing" {
            return;
        }
        let mut state = self.0.borrow_mut();
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

/// The group id, epoch and whether it is a commit, from the framing.
fn framing(bytes: &[u8]) -> Option<(Vec<u8>, u64, bool)> {
    let message = MlsMessageIn::tls_deserialize_exact(bytes)
        .ok()?
        .try_into_protocol_message()
        .ok()?;
    Some((
        message.group_id().as_slice().to_vec(),
        message.epoch().as_u64(),
        message.content_type() == ContentType::Commit,
    ))
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
        match (request.method, parts.as_slice()) {
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
                        expired_to: 0,
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
                if !conversation.roster.contains(account) {
                    return refuse(403, "not_a_member");
                }
                let after: u64 = query.strip_prefix("after=").unwrap().parse().unwrap();
                let rows: Vec<&Stored> = conversation
                    .messages
                    .iter()
                    .filter(|m| m.seq > after)
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
        let Some((group, epoch, commit)) = framing(&STANDARD.decode(ciphertext).unwrap()) else {
            return refuse(400, "invalid_request");
        };
        if URL_SAFE_NO_PAD.encode(group) != id {
            return refuse(400, "group_mismatch");
        }
        let roster = &body["roster"];
        let welcome = &body["welcome"];
        if !commit && (!roster.is_null() || !welcome.is_null()) {
            return refuse(400, "invalid_request");
        }
        let before = conversation.roster.clone();
        let mut after = before.clone();
        after.extend(strings(&roster["add"]));
        for gone in strings(&roster["remove"]) {
            after.remove(&gone);
        }
        if commit
            && conversation
                .last_epoch
                .is_some_and(|last| epoch != last + 1)
        {
            return refuse(409, "epoch_conflict");
        }
        let welcome_to = strings(&welcome["to"]);
        if welcome_to.iter().any(|a| !after.contains(a)) {
            return refuse(400, "welcome_not_a_member");
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
            conversation.roster = after.clone();
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
        let mut state = self.relay.0.borrow_mut();
        if let Some(n) = state.fail.get_mut(&self.device).filter(|n| **n > 0) {
            *n -= 1;
            return Err(Unreachable("the request was lost".into()));
        }
        let response = state.handle(&self.account, &self.device, request);
        if let Some(n) = state.lose.get_mut(&self.device).filter(|n| **n > 0) {
            *n -= 1;
            return Err(Unreachable("the answer was lost".into()));
        }
        Ok(response)
    }
}
