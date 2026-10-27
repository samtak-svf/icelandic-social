//! Notifications as the client offers them (0063, 0104, 0106): the list, what
//! was seen and read, and the levels.

use crate::api::{
    NotificationKind, NotificationLevel, NotificationPage, NotificationSettings, Transport,
};
use crate::{Client, ClientError, authed, is_id};

/// A notification id the server takes in a path: any text of 1 to 200 bytes
/// (the client encodes it).
fn notification_ref(text: &str) -> Result<(), ClientError> {
    if (1..=200).contains(&text.len()) {
        Ok(())
    } else {
        Err(ClientError::Invalid("notification id"))
    }
}

/// Notifications.
impl<T: Transport> Client<T> {
    /// A page of this account's notifications, newest first; `before` is
    /// the `next` of the page before. At most 50 a page.
    pub fn notifications(
        &self,
        before: Option<&str>,
        size: u32,
    ) -> Result<NotificationPage, ClientError> {
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.notifications(before, size.clamp(1, 50))?)
    }

    /// Marks read every notification made at or before `up_to`, the
    /// `created_at` of the newest one shown.
    pub fn read_notifications(&self, up_to: u64) -> Result<(), ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.read_notifications(up_to)?)
    }

    /// Records that the list was looked at up to `up_to`, the `created_at`
    /// of the newest row shown (0104). It reads no row.
    pub fn seen_notifications(&self, up_to: u64) -> Result<(), ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.seen_notifications(up_to)?)
    }

    /// Marks one notification read, or unread again.
    pub fn read_notification(&self, notification_id: &str, read: bool) -> Result<(), ClientError> {
        notification_ref(notification_id)?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .read_notification(notification_id, read)?)
    }

    /// Removes one notification from the list.
    pub fn delete_notification(&self, notification_id: &str) -> Result<(), ClientError> {
        notification_ref(notification_id)?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .delete_notification(notification_id)?)
    }

    /// The level for each kind and each community that has one (0106).
    pub fn notification_settings(&self) -> Result<NotificationSettings, ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.notification_settings()?)
    }

    /// Sets the level of the given kinds and leaves the others. The server
    /// refuses `Off` for `Moderated`, which is never hidden from its subject.
    pub fn set_notification_settings(
        &self,
        kinds: &[(NotificationKind, NotificationLevel)],
    ) -> Result<(), ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.set_notification_settings(kinds)?)
    }

    /// Sets how loudly this account is told of one community.
    pub fn set_community_notification_level(
        &self,
        community_id: &str,
        level: NotificationLevel,
    ) -> Result<(), ClientError> {
        if !is_id(community_id) {
            return Err(ClientError::Invalid("community id"));
        }
        Ok(authed(&self.transport, &self.token, &self.client)?
            .set_community_notification_level(community_id, level)?)
    }
}
