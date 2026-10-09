//! Fljótið and the walls (0034), as this device reads and writes them: each
//! call goes to the server and nothing is kept, since the posts are public
//! and a stale copy would show deleted ones.

use crate::api::{Post, PostPage, PostReaction, Reply, ReplyPage, Transport};
use crate::{Client, ClientError, authed, is_id};

/// The most characters a post or a reply holds, counted as the server
/// counts them: UTF-16 code units.
pub const MAX_POST: usize = 2000;

/// The most a page holds; the server refuses more.
const MAX_PAGE: u32 = 50;

/// A body the server takes: not blank, and at most `MAX_POST` long.
fn body(text: &str) -> Result<&str, ClientError> {
    if text.trim().is_empty() {
        return Err(ClientError::Invalid("a blank post"));
    }
    if text.encode_utf16().count() > MAX_POST {
        return Err(ClientError::Invalid("a post over 2000 characters"));
    }
    Ok(text)
}

fn id(text: &str, what: &'static str) -> Result<(), ClientError> {
    if is_id(text) {
        Ok(())
    } else {
        Err(ClientError::Invalid(what))
    }
}

fn limit(limit: u32) -> u32 {
    limit.clamp(1, MAX_PAGE)
}

impl<T: Transport> Client<T> {
    /// A page of Fljótið, newest first; `before` is the `next` of the page
    /// before it.
    pub fn feed(&mut self, before: Option<&str>, size: u32) -> Result<PostPage, ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.feed(before, limit(size))?)
    }

    /// A page of one account's wall, newest first.
    pub fn wall(
        &mut self,
        account: &str,
        before: Option<&str>,
        size: u32,
    ) -> Result<PostPage, ClientError> {
        id(account, "account id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.wall(
            account,
            before,
            limit(size),
        )?)
    }

    pub fn post(&mut self, post: &str) -> Result<Post, ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.post(post)?)
    }

    /// Posts to Fljótið and this account's wall.
    pub fn create_post(&mut self, text: &str) -> Result<Post, ClientError> {
        let text = body(text)?;
        Ok(authed(&self.transport, &self.token, &self.client)?.create_post(text)?)
    }

    /// Deletes one of this account's posts, with its replies and reactions.
    pub fn delete_post(&mut self, post: &str) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.delete_post(post)?)
    }

    /// Sets this account's one reaction to a post, or takes it back with
    /// none.
    pub fn react_to_post(
        &mut self,
        post: &str,
        reaction: Option<PostReaction>,
    ) -> Result<(), ClientError> {
        id(post, "post id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        match reaction {
            Some(reaction) => api.react_to_post(post, reaction)?,
            None => api.unreact_to_post(post)?,
        }
        Ok(())
    }

    /// A page of a post's replies, oldest first; `after` is the `next` of
    /// the page before it.
    pub fn replies(
        &mut self,
        post: &str,
        after: Option<&str>,
        size: u32,
    ) -> Result<ReplyPage, ClientError> {
        id(post, "post id")?;
        Ok(
            authed(&self.transport, &self.token, &self.client)?.replies(
                post,
                after,
                limit(size),
            )?,
        )
    }

    pub fn create_reply(&mut self, post: &str, text: &str) -> Result<Reply, ClientError> {
        id(post, "post id")?;
        let text = body(text)?;
        Ok(authed(&self.transport, &self.token, &self.client)?.create_reply(post, text)?)
    }

    /// Deletes one of this account's replies.
    pub fn delete_reply(&mut self, reply: &str) -> Result<(), ClientError> {
        id(reply, "reply id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.delete_reply(reply)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_body_is_counted_as_the_server_counts_it() {
        assert!(body(&"a".repeat(MAX_POST)).is_ok());
        assert!(body(&"a".repeat(MAX_POST + 1)).is_err());
        // One emoji is two UTF-16 units, as JavaScript's length counts it.
        assert!(body(&"😀".repeat(MAX_POST / 2)).is_ok());
        assert!(body(&format!("{}a", "😀".repeat(MAX_POST / 2))).is_err());
        // Icelandic letters are one unit each.
        assert!(body(&"þ".repeat(MAX_POST)).is_ok());
        assert!(body(" \n\t").is_err());
    }

    #[test]
    fn a_page_size_stays_within_the_contract() {
        assert_eq!((limit(0), limit(20), limit(500)), (1, 20, 50));
    }
}
