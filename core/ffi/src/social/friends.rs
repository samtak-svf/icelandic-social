//! Friends, snoozes and suggestions (0114) as the apps see them.

use spjall_client::api;
pub use spjall_client::api::{
    Friend, FriendPage, FriendRequest, FriendRequests, FriendSort, FriendSuggestions, Relation,
    Snooze,
};

use super::{Author, CardCommunity};
use crate::CoreError;
use crate::client::CoreClient;
use crate::frames::Framing;

/// Where this account stands with another (0114); `Unknown` for a value a later
/// server adds.
#[uniffi::remote(Enum)]
pub enum Relation {
    Oneself,
    None,
    Sent,
    Incoming,
    Friends,
    Unknown,
}

/// The order of `friends`.
#[uniffi::remote(Enum)]
pub enum FriendSort {
    Newest,
    Name,
}

#[uniffi::remote(Record)]
pub struct Friend {
    pub person: Author,
    /// Unix milliseconds.
    pub since: u64,
}

#[uniffi::remote(Record)]
pub struct FriendPage {
    /// How many friends this account has, whatever `query` matched.
    pub count: u64,
    pub friends: Vec<Friend>,
}

#[uniffi::remote(Record)]
pub struct FriendRequest {
    pub person: Author,
    /// Unix milliseconds.
    pub sent_at: u64,
}

#[uniffi::remote(Record)]
pub struct FriendRequests {
    pub incoming: Vec<FriendRequest>,
    pub sent: Vec<FriendRequest>,
}

#[uniffi::remote(Record)]
pub struct Snooze {
    pub person: Author,
    /// Unix milliseconds.
    pub until: u64,
}

/// A page of the people suggested to this account, verified first, then by name.
#[uniffi::remote(Record)]
pub struct FriendSuggestions {
    pub people: Vec<Author>,
    /// The `after` of the next page, none on the last.
    pub next: Option<String>,
}

/// An account as this one sees it, with what is between them.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PersonProfile {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// The photo's version; none when it has none.
    pub photo: Option<String>,
    pub photo_frames: Option<Framing>,
    pub relation: Relation,
    /// Unix milliseconds; present while they are friends.
    pub friends_since: Option<u64>,
    pub friend_count: u64,
    pub mutual_count: u64,
    pub mutual_friends: Vec<Author>,
    pub shared_communities: Vec<CardCommunity>,
    /// Unix milliseconds: until when this account snoozed that one.
    pub snoozed_until: Option<u64>,
}

impl From<api::Person> for PersonProfile {
    fn from(person: api::Person) -> Self {
        let api::Person {
            account_id,
            name,
            verified,
            photo,
            photo_frames,
            relation,
            friends_since,
            friend_count,
            mutual_count,
            mutual_friends,
            shared_communities,
            snoozed_until,
        } = person;
        Self {
            account_id,
            name,
            verified,
            photo,
            photo_frames: photo_frames.map(Into::into),
            relation,
            friends_since,
            friend_count,
            mutual_count,
            mutual_friends,
            shared_communities,
            snoozed_until,
        }
    }
}

#[uniffi::export]
impl CoreClient {
    /// An account as this one sees it. `Refused` with 404 when there is none,
    /// or a block stands between them.
    pub fn person(&self, account_id: String) -> Result<PersonProfile, CoreError> {
        Ok(self.hosted.person(&account_id)?.into())
    }

    /// This account's friends, those whose name matches `query` when there is
    /// one, and how many it has.
    #[uniffi::method(default(query = None))]
    pub fn friends(
        &self,
        sort: FriendSort,
        query: Option<String>,
    ) -> Result<FriendPage, CoreError> {
        Ok(self.hosted.friends(query.as_deref(), sort)?)
    }

    /// The requests waiting for this account's answer, and those it sent.
    pub fn friend_requests(&self) -> Result<FriendRequests, CoreError> {
        Ok(self.hosted.friend_requests()?)
    }

    /// Asks an account to be friends: `Sent`, or `Friends` when it had already
    /// asked. `Refused` with 403 `suspended`, 409 `request_refused` or
    /// `friend_limit`, 429 `request_limit`.
    pub fn send_friend_request(&self, account_id: String) -> Result<Relation, CoreError> {
        Ok(self.hosted.send_friend_request(&account_id)?)
    }

    /// Takes back a request this account sent.
    pub fn cancel_friend_request(&self, account_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.cancel_friend_request(&account_id)?)
    }

    /// Says yes to a request. `Refused` with 409 `friend_limit`.
    pub fn accept_friend_request(&self, account_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.accept_friend_request(&account_id)?)
    }

    /// Says no to a request; the one who asked is not told (0114).
    pub fn decline_friend_request(&self, account_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.decline_friend_request(&account_id)?)
    }

    /// Stops being friends; the other account is not told (0114).
    pub fn end_friendship(&self, account_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.end_friendship(&account_id)?)
    }

    /// The accounts this one snoozed.
    pub fn snoozes(&self) -> Result<Vec<Snooze>, CoreError> {
        Ok(self.hosted.snoozes()?)
    }

    /// Takes an account's posts out of the home feed for 30 days (0114). Until
    /// when, in Unix milliseconds.
    pub fn snooze_person(&self, account_id: String) -> Result<u64, CoreError> {
        Ok(self.hosted.snooze_person(&account_id)?)
    }

    /// Ends a snooze.
    pub fn unsnooze_person(&self, account_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.unsnooze_person(&account_id)?)
    }

    /// A page of the people suggested to this account; `after` is the `next` of
    /// the page before. At most 50 a page. Empty for an account that is out of
    /// suggestions or suspended, and nothing says which community links two
    /// people (0114). Asking one of them is `send_friend_request`.
    #[uniffi::method(default(after = None, limit = 20))]
    pub fn friend_suggestions(
        &self,
        after: Option<String>,
        limit: u32,
    ) -> Result<FriendSuggestions, CoreError> {
        Ok(self.hosted.friend_suggestions(after.as_deref(), limit)?)
    }

    /// Whether this account takes part in suggestions; it does until it says
    /// otherwise.
    pub fn friend_suggestions_included(&self) -> Result<bool, CoreError> {
        Ok(self.hosted.friend_suggestions_included()?)
    }

    /// Takes this account into or out of suggestions, both ways: out, it is
    /// suggested to nobody and shown nobody (0114). A suspended account may
    /// still change it.
    pub fn set_friend_suggestions_included(&self, included: bool) -> Result<(), CoreError> {
        Ok(self.hosted.set_friend_suggestions_included(included)?)
    }
}
