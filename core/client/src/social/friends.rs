//! Friends, snoozes and suggestions (0114) as the client offers them.

use super::{id, search};
use crate::api::{
    FriendPage, FriendRequests, FriendSort, FriendSuggestions, Person, Relation, Snooze, Transport,
};
use crate::{ClientError, Hosted};

/// The largest page of suggestions the server takes.
const MAX_SUGGESTION_PAGE: u32 = 50;

/// Friends.
impl<T: Transport> Hosted<T> {
    /// An account as this one sees it, with what is between them.
    pub fn person(&self, account: &str) -> Result<Person, ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.person(account)?)
    }

    /// This account's friends, those whose name matches `query` when there is
    /// one, and how many it has.
    pub fn friends(
        &self,
        query: Option<&str>,
        sort: FriendSort,
    ) -> Result<FriendPage, ClientError> {
        Ok(self.api()?.friends(search(query), sort)?)
    }

    /// The requests waiting for this account's answer, and those it sent.
    pub fn friend_requests(&self) -> Result<FriendRequests, ClientError> {
        Ok(self.api()?.friend_requests()?)
    }

    /// Asks `account` to be friends: `Sent`, or `Friends` when it had already
    /// asked this one.
    pub fn send_friend_request(&self, account: &str) -> Result<Relation, ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.send_friend_request(account)?)
    }

    /// Takes back a request this account sent.
    pub fn cancel_friend_request(&self, account: &str) -> Result<(), ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.cancel_friend_request(account)?)
    }

    /// Says yes to `account`'s request.
    pub fn accept_friend_request(&self, account: &str) -> Result<(), ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.accept_friend_request(account)?)
    }

    /// Says no to `account`'s request; it is not told (0114).
    pub fn decline_friend_request(&self, account: &str) -> Result<(), ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.decline_friend_request(account)?)
    }

    /// Stops being friends with `account`; it is not told (0114).
    pub fn end_friendship(&self, account: &str) -> Result<(), ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.end_friendship(account)?)
    }

    /// The accounts this one snoozed.
    pub fn snoozes(&self) -> Result<Vec<Snooze>, ClientError> {
        Ok(self.api()?.snoozes()?)
    }

    /// Takes `account`'s posts out of the home feed for 30 days (0114). Until
    /// when, in Unix milliseconds.
    pub fn snooze_person(&self, account: &str) -> Result<u64, ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.snooze_person(account)?)
    }

    /// Ends a snooze.
    pub fn unsnooze_person(&self, account: &str) -> Result<(), ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.unsnooze_person(account)?)
    }

    /// A page of the people suggested to this account; `after` is the `next`
    /// of the page before. At most 50 a page. Asking one of them is
    /// `send_friend_request`.
    pub fn friend_suggestions(
        &self,
        after: Option<&str>,
        size: u32,
    ) -> Result<FriendSuggestions, ClientError> {
        let size = size.clamp(1, MAX_SUGGESTION_PAGE);
        Ok(self.api()?.friend_suggestions(search(after), size)?)
    }

    /// Whether this account takes part in suggestions.
    pub fn friend_suggestions_included(&self) -> Result<bool, ClientError> {
        Ok(self.api()?.friend_suggestions_included()?)
    }

    /// Takes this account into or out of suggestions, both ways: out, it is
    /// suggested to nobody and shown nobody (0114).
    pub fn set_friend_suggestions_included(&self, included: bool) -> Result<(), ClientError> {
        Ok(self.api()?.set_friend_suggestions_included(included)?)
    }
}
