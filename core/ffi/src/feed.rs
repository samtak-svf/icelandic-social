//! Fljótið and the walls (0034) for the apps: public posts, fetched fresh
//! on each call. The authors are `Person`s, drawn as everywhere else.

use spjall_client::api;

use crate::CoreError;
use crate::client::{CoreClient, Person};

/// The reactions a post can get, one per account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PostReaction {
    Heart,
    ThumbsUp,
    Laugh,
    Wow,
    Sad,
}

impl From<PostReaction> for api::PostReaction {
    fn from(reaction: PostReaction) -> Self {
        match reaction {
            PostReaction::Heart => Self::Heart,
            PostReaction::ThumbsUp => Self::ThumbsUp,
            PostReaction::Laugh => Self::Laugh,
            PostReaction::Wow => Self::Wow,
            PostReaction::Sad => Self::Sad,
        }
    }
}

impl From<api::PostReaction> for PostReaction {
    fn from(reaction: api::PostReaction) -> Self {
        match reaction {
            api::PostReaction::Heart => Self::Heart,
            api::PostReaction::ThumbsUp => Self::ThumbsUp,
            api::PostReaction::Laugh => Self::Laugh,
            api::PostReaction::Wow => Self::Wow,
            api::PostReaction::Sad => Self::Sad,
        }
    }
}

/// How many of each reaction a post has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct ReactionCounts {
    pub heart: u32,
    pub thumbs_up: u32,
    pub laugh: u32,
    pub wow: u32,
    pub sad: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Post {
    pub post_id: String,
    pub author: Person,
    pub body: String,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// The replies this account can see.
    pub reply_count: u32,
    pub reactions: ReactionCounts,
    pub my_reaction: Option<PostReaction>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Reply {
    pub reply_id: String,
    pub post_id: String,
    pub author: Person,
    pub body: String,
    /// Milliseconds since the epoch.
    pub created_at: u64,
}

/// Posts newest first; `next` is the cursor of the next page, none on the
/// last.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PostPage {
    pub posts: Vec<Post>,
    pub next: Option<String>,
}

/// Replies oldest first; `next` as on a `PostPage`.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ReplyPage {
    pub replies: Vec<Reply>,
    pub next: Option<String>,
}

fn person(author: api::Author) -> Person {
    Person {
        account: author.account_id,
        name: author.name,
        verified: author.verified,
    }
}

impl From<api::Post> for Post {
    fn from(post: api::Post) -> Self {
        let counts = post.reactions;
        Self {
            post_id: post.post_id,
            author: person(post.author),
            body: post.body,
            created_at: post.created_at,
            reply_count: post.reply_count,
            reactions: ReactionCounts {
                heart: counts.heart,
                thumbs_up: counts.thumbs_up,
                laugh: counts.laugh,
                wow: counts.wow,
                sad: counts.sad,
            },
            my_reaction: post.my_reaction.map(Into::into),
        }
    }
}

impl From<api::Reply> for Reply {
    fn from(reply: api::Reply) -> Self {
        Self {
            reply_id: reply.reply_id,
            post_id: reply.post_id,
            author: person(reply.author),
            body: reply.body,
            created_at: reply.created_at,
        }
    }
}

impl From<api::PostPage> for PostPage {
    fn from(page: api::PostPage) -> Self {
        Self {
            posts: page.posts.into_iter().map(Into::into).collect(),
            next: page.next,
        }
    }
}

impl From<api::ReplyPage> for ReplyPage {
    fn from(page: api::ReplyPage) -> Self {
        Self {
            replies: page.replies.into_iter().map(Into::into).collect(),
            next: page.next,
        }
    }
}

#[uniffi::export]
impl CoreClient {
    /// A page of Fljótið, newest first; `before` is the `next` of the page
    /// before it, none for the newest. At most 50 a page.
    pub fn feed(&self, before: Option<String>, limit: u32) -> Result<PostPage, CoreError> {
        Ok(self.client()?.feed(before.as_deref(), limit)?.into())
    }

    /// A page of one account's wall, newest first; empty for an account
    /// this one blocked.
    pub fn wall(
        &self,
        account: String,
        before: Option<String>,
        limit: u32,
    ) -> Result<PostPage, CoreError> {
        Ok(self
            .client()?
            .wall(&account, before.as_deref(), limit)?
            .into())
    }

    /// One post; `Refused` with 404 when it is gone.
    pub fn post(&self, post_id: String) -> Result<Post, CoreError> {
        Ok(self.client()?.post(&post_id)?.into())
    }

    /// Posts to Fljótið and this account's wall. A blank text, or one over
    /// 2000 characters, is `Invalid`; too many in a minute is `Refused`
    /// with 429.
    pub fn create_post(&self, body: String) -> Result<Post, CoreError> {
        Ok(self.client()?.create_post(&body)?.into())
    }

    /// Deletes one of this account's posts, with its replies and reactions.
    pub fn delete_post(&self, post_id: String) -> Result<(), CoreError> {
        Ok(self.client()?.delete_post(&post_id)?)
    }

    /// Sets this account's one reaction to a post, or takes it back with
    /// none. `Refused` with 403 when the author blocked this account.
    pub fn react_to_post(
        &self,
        post_id: String,
        reaction: Option<PostReaction>,
    ) -> Result<(), CoreError> {
        Ok(self
            .client()?
            .react_to_post(&post_id, reaction.map(Into::into))?)
    }

    /// A page of a post's replies, oldest first; `after` is the `next` of
    /// the page before it.
    pub fn replies(
        &self,
        post_id: String,
        after: Option<String>,
        limit: u32,
    ) -> Result<ReplyPage, CoreError> {
        Ok(self
            .client()?
            .replies(&post_id, after.as_deref(), limit)?
            .into())
    }

    /// Replies to a post, under the rules of `create_post`.
    pub fn create_reply(&self, post_id: String, body: String) -> Result<Reply, CoreError> {
        Ok(self.client()?.create_reply(&post_id, &body)?.into())
    }

    /// Deletes one of this account's replies.
    pub fn delete_reply(&self, reply_id: String) -> Result<(), CoreError> {
        Ok(self.client()?.delete_reply(&reply_id)?)
    }
}
