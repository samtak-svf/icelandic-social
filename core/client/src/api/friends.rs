//! Friends and snoozes (0114) as the server answers them.

use serde::Deserialize;

use super::{Api, ApiError, Author, CardCommunity, Method, Transport, with_query};
use crate::frames::Framing;

/// Where the caller stands with an account (0114). A value a later server adds
/// reads as `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Relation {
    /// The caller itself.
    #[serde(rename = "self")]
    Oneself,
    None,
    /// The caller asked, and the answer waits.
    Sent,
    /// That account asked the caller.
    Incoming,
    Friends,
    #[serde(other)]
    Unknown,
}

/// `getPerson`: an account as the caller sees it, with what is between them.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// The photo's version; none when it has none.
    #[serde(default)]
    pub photo: Option<String>,
    #[serde(default)]
    pub photo_frames: Option<Framing>,
    pub relation: Relation,
    /// Unix milliseconds; present while they are friends.
    #[serde(default)]
    pub friends_since: Option<u64>,
    pub friend_count: u64,
    pub mutual_count: u64,
    pub mutual_friends: Vec<Author>,
    pub shared_communities: Vec<CardCommunity>,
    /// Unix milliseconds: until when the caller snoozed this account.
    #[serde(default)]
    pub snoozed_until: Option<u64>,
}

/// The order of `listFriends`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FriendSort {
    Newest,
    Name,
}

/// One friend, and since when in Unix milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Friend {
    pub person: Author,
    pub since: u64,
}

/// `listFriends`: the matching friends, and how many this account has.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FriendPage {
    pub count: u64,
    pub friends: Vec<Friend>,
}

/// A request waiting for an answer, and when it was sent in Unix milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequest {
    pub person: Author,
    pub sent_at: u64,
}

/// `listFriendRequests`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FriendRequests {
    pub incoming: Vec<FriendRequest>,
    pub sent: Vec<FriendRequest>,
}

/// An account the caller snoozed, until when in Unix milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Snooze {
    pub person: Author,
    pub until: u64,
}

#[derive(Deserialize)]
struct SnoozeList {
    snoozed: Vec<Snooze>,
}

#[derive(Deserialize)]
struct Sent {
    relation: Relation,
}

#[derive(Deserialize)]
struct Snoozed {
    until: u64,
}

impl<T: Transport> Api<'_, T> {
    /// `getPerson`.
    pub fn person(&self, account: &str) -> Result<Person, ApiError> {
        self.call(
            Method::Get,
            format!("/v1/people/{account}"),
            None,
            "getPerson",
        )
    }

    /// `listFriends`.
    pub fn friends(&self, query: Option<&str>, sort: FriendSort) -> Result<FriendPage, ApiError> {
        let sort = match sort {
            FriendSort::Newest => "newest",
            FriendSort::Name => "name",
        };
        let path = with_query("/v1/friends", &[("q", query), ("sort", Some(sort))]);
        self.call(Method::Get, path, None, "listFriends")
    }

    /// `endFriendship`: silent to the other account (0114).
    pub fn end_friendship(&self, account: &str) -> Result<(), ApiError> {
        self.done(Method::Delete, format!("/v1/friends/{account}"), None)
    }

    /// `listFriendRequests`.
    pub fn friend_requests(&self) -> Result<FriendRequests, ApiError> {
        let path = "/v1/friend-requests".to_owned();
        self.call(Method::Get, path, None, "listFriendRequests")
    }

    /// `sendFriendRequest`: `Friends` when that account had already asked.
    pub fn send_friend_request(&self, account: &str) -> Result<Relation, ApiError> {
        let path = format!("/v1/friend-requests/{account}");
        let sent: Sent = self.call(Method::Put, path, None, "sendFriendRequest")?;
        Ok(sent.relation)
    }

    /// `cancelFriendRequest`.
    pub fn cancel_friend_request(&self, account: &str) -> Result<(), ApiError> {
        let path = format!("/v1/friend-requests/{account}");
        self.done(Method::Delete, path, None)
    }

    /// `acceptFriendRequest`.
    pub fn accept_friend_request(&self, account: &str) -> Result<(), ApiError> {
        let path = format!("/v1/friend-requests/{account}/accept");
        self.done(Method::Post, path, None)
    }

    /// `declineFriendRequest`: silent to the one who asked (0114).
    pub fn decline_friend_request(&self, account: &str) -> Result<(), ApiError> {
        let path = format!("/v1/friend-requests/{account}/decline");
        self.done(Method::Post, path, None)
    }

    /// `listSnoozes`.
    pub fn snoozes(&self) -> Result<Vec<Snooze>, ApiError> {
        let path = "/v1/snoozes".to_owned();
        let list: SnoozeList = self.call(Method::Get, path, None, "listSnoozes")?;
        Ok(list.snoozed)
    }

    /// `snoozePerson`: 30 days (0114). Until when, in Unix milliseconds.
    pub fn snooze_person(&self, account: &str) -> Result<u64, ApiError> {
        let path = format!("/v1/snoozes/{account}");
        let snoozed: Snoozed = self.call(Method::Put, path, None, "snoozePerson")?;
        Ok(snoozed.until)
    }

    /// `unsnoozePerson`.
    pub fn unsnooze_person(&self, account: &str) -> Result<(), ApiError> {
        self.done(Method::Delete, format!("/v1/snoozes/{account}"), None)
    }
}
