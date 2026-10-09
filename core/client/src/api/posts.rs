//! Fljótið and the walls (0034): public posts, replies and reactions,
//! fetched fresh each time and kept nowhere on the device. Not end-to-end
//! encrypted; the server applies blocks.

use serde::{Deserialize, Serialize};

use super::{Api, ApiError, Method, Transport};

/// The reactions a post can get, one per account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostReaction {
    Heart,
    ThumbsUp,
    Laugh,
    Wow,
    Sad,
}

/// Who wrote a post or a reply.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// How many of each reaction a post has.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReactionCounts {
    pub heart: u32,
    pub thumbs_up: u32,
    pub laugh: u32,
    pub wow: u32,
    pub sad: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub post_id: String,
    pub author: Author,
    pub body: String,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// The replies this account can see.
    pub reply_count: u32,
    pub reactions: ReactionCounts,
    pub my_reaction: Option<PostReaction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub reply_id: String,
    pub post_id: String,
    pub author: Author,
    pub body: String,
    /// Milliseconds since the epoch.
    pub created_at: u64,
}

/// Posts newest first, and the cursor of the next page, none on the last.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PostPage {
    pub posts: Vec<Post>,
    pub next: Option<String>,
}

/// Replies oldest first, and the cursor of the next page, none on the last.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReplyPage {
    pub replies: Vec<Reply>,
    pub next: Option<String>,
}

/// `?{name}={cursor}&limit={limit}`, the cursor percent-encoded although
/// the server makes it base64url.
fn page_query(name: &str, cursor: Option<&str>, limit: u32) -> String {
    let cursor = cursor
        .map(|c| format!("{name}={}&", crate::account::encode(c)))
        .unwrap_or_default();
    format!("?{cursor}limit={limit}")
}

impl<T: Transport + ?Sized> Api<'_, T> {
    /// `getFeed`: Fljótið, every account's posts.
    pub fn feed(&self, before: Option<&str>, limit: u32) -> Result<PostPage, ApiError> {
        let query = page_query("before", before, limit);
        self.call(Method::Get, format!("/v1/feed{query}"), None, "getFeed")
    }

    /// `getWall`: one account's posts.
    pub fn wall(
        &self,
        account: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<PostPage, ApiError> {
        let query = page_query("before", before, limit);
        self.call(
            Method::Get,
            format!("/v1/accounts/{account}/posts{query}"),
            None,
            "getWall",
        )
    }

    /// `getPost`.
    pub fn post(&self, post: &str) -> Result<Post, ApiError> {
        self.call(Method::Get, format!("/v1/posts/{post}"), None, "getPost")
    }

    /// `createPost`.
    pub fn create_post(&self, body: &str) -> Result<Post, ApiError> {
        let body = serde_json::json!({ "body": body });
        self.call(
            Method::Post,
            "/v1/posts".into(),
            Self::json(&body),
            "createPost",
        )
    }

    /// `deletePost`: only this account's own.
    pub fn delete_post(&self, post: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/posts/{post}"), None)
            .map(drop)
    }

    /// `reactToPost`: replaces this account's reaction, if it had one.
    pub fn react_to_post(&self, post: &str, reaction: PostReaction) -> Result<(), ApiError> {
        let body = serde_json::json!({ "reaction": reaction });
        self.send(
            Method::Put,
            format!("/v1/posts/{post}/reaction"),
            Self::json(&body),
        )
        .map(drop)
    }

    /// `unreactToPost`: no error when there was none.
    pub fn unreact_to_post(&self, post: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/posts/{post}/reaction"), None)
            .map(drop)
    }

    /// `listReplies`.
    pub fn replies(
        &self,
        post: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<ReplyPage, ApiError> {
        let query = page_query("after", after, limit);
        self.call(
            Method::Get,
            format!("/v1/posts/{post}/replies{query}"),
            None,
            "listReplies",
        )
    }

    /// `createReply`.
    pub fn create_reply(&self, post: &str, body: &str) -> Result<Reply, ApiError> {
        let body = serde_json::json!({ "body": body });
        self.call(
            Method::Post,
            format!("/v1/posts/{post}/replies"),
            Self::json(&body),
            "createReply",
        )
    }

    /// `deleteReply`: only this account's own.
    pub fn delete_reply(&self, reply: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/replies/{reply}"), None)
            .map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_query_encodes_its_cursor() {
        assert_eq!(page_query("before", None, 20), "?limit=20");
        assert_eq!(
            page_query("after", Some("MTIz.x_y-z"), 5),
            "?after=MTIz.x_y-z&limit=5"
        );
        assert_eq!(
            page_query("before", Some("a=b&c"), 1),
            "?before=a%3Db%26c&limit=1"
        );
    }

    #[test]
    fn a_reaction_is_named_as_the_contract_names_it() {
        assert_eq!(
            serde_json::to_string(&PostReaction::ThumbsUp).unwrap(),
            "\"thumbs_up\""
        );
        let counts: ReactionCounts =
            serde_json::from_str(r#"{"heart":1,"thumbs_up":2,"laugh":0,"wow":0,"sad":3}"#).unwrap();
        assert_eq!((counts.thumbs_up, counts.sad), (2, 3));
    }
}
