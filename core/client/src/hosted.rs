//! The calls that only ask the server (0113): nothing of the store, the
//! blobs or the outcome, so nothing that has to wait for a `Client`.
//!
//! A [`Client`](crate::Client) is held by whoever calls it, and a sync holds
//! it through every request it makes. A `Hosted` is a copy of the transport
//! and a share of the device token, so a call on it never waits for that
//! hold: the profile and the notifications are fetched while a sync runs.

use std::sync::{Arc, RwLock};

use crate::api::{Api, Me, Transport};
use crate::{Client, ClientError};

/// The API as this device, which needs its token.
///
/// The token is cloned out of its lock, which is released before the request
/// goes out, so a request never holds it (0113).
pub(crate) fn authed<'a, T: Transport>(
    transport: &'a T,
    token: &SharedToken,
    client: &'a Option<String>,
) -> Result<Api<'a, T>, ClientError> {
    let token = read_token(token).ok_or(ClientError::NotRegistered)?;
    Ok(Api::new(transport, Some(&token)).client(client.as_deref()))
}

/// The device token, shared by a [`Client`] and every [`Hosted`] it hands out.
pub(crate) type SharedToken = Arc<RwLock<Option<String>>>;

pub(crate) fn read_token(token: &SharedToken) -> Option<String> {
    token.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// A handle for the server-only calls, from [`Client::hosted`](crate::Client::hosted).
/// It sees the token the client holds now, so a sign-in or a sign-out
/// reaches it at once.
#[derive(Clone)]
pub struct Hosted<T> {
    pub(crate) transport: T,
    token: SharedToken,
    client: Option<String>,
}

impl<T: Transport> Client<T> {
    /// Writes the device token every [`Hosted`] of this client reads.
    pub(crate) fn set_token(&self, token: Option<String>) {
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = token;
    }

    /// The server-only calls of this client, on a handle that shares nothing
    /// with the client's lock (0113).
    pub fn hosted(&self) -> Hosted<T>
    where
        T: Clone,
    {
        Hosted::new(
            self.transport.clone(),
            self.token.clone(),
            self.client.clone(),
        )
    }
}

impl<T> Hosted<T> {
    pub(crate) fn new(
        transport: T,
        token: Arc<RwLock<Option<String>>>,
        client: Option<String>,
    ) -> Self {
        Self {
            transport,
            token,
            client,
        }
    }
}

impl<T: Transport> Hosted<T> {
    /// The API as this device. The token is cloned out of its lock first, so
    /// no lock is held across a request.
    pub(crate) fn api(&self) -> Result<Api<'_, T>, ClientError> {
        authed(&self.transport, &self.token, &self.client)
    }

    /// This account's name, mark and devices.
    pub fn me(&self) -> Result<Me, ClientError> {
        Ok(self.api()?.me()?)
    }
}
