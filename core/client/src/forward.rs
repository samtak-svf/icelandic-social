//! Forwarding (0041): a message copied into another conversation as a new
//! message from this account, marked `forwarded`. The copy names no one
//! and nothing from where it came: not the author, not the conversation,
//! not the message a reply answered. A file is sealed again under a fresh
//! key and uploaded into the target, because an object and its key belong
//! to one conversation (0023).

use spjall_envelope::Body;

use crate::api::{Transport, group_id};
use crate::timeline::{Forwardable, forwardable};
use crate::{Client, ClientError, conversation_state, open_conversation};

impl<T: Transport> Client<T> {
    /// Copies the message at `seq` of `from` into `to` and queues it, as
    /// `send` does; a file is downloaded first if this device does not
    /// have it yet, and uploaded again. Returns the new envelope id.
    ///
    /// Refused with `CannotForward` for a message under a disappearing
    /// timer, a deleted one, or anything that is not a text or a file.
    pub fn forward(&mut self, from: &str, seq: u64, to: &str) -> Result<String, ClientError> {
        let source = group_id(from).ok_or(ClientError::UnknownConversation)?;
        let target = group_id(to).ok_or(ClientError::UnknownConversation)?;
        self.purge()?;
        let content = self.store.try_write(|tx| {
            conversation_state(tx, &source)?;
            // Before any download: a target this device cannot send to.
            open_conversation(tx, &target)?;
            forwardable(tx, &source, seq)
        })?;
        match content {
            Forwardable::Text(text) => self.send(
                to,
                Body::Text {
                    text,
                    forwarded: true,
                },
            ),
            Forwardable::Media {
                mime,
                caption,
                name,
            } => {
                let file = self.media(from, seq)?;
                self.upload_and_send(to, &file, &mime, caption, name, true)
            }
        }
    }
}
