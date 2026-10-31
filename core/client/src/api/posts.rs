//! A post as the server answers it: in a community, or on a wall (0115), where
//! the same type carries who owns the wall and who may read it.

use serde::{Deserialize, Serialize};

use super::{
    Api, ApiError, Author, Comment, EmojiCount, Method, ModerationState, SocialMedia, Transport,
    with_query,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub post_id: String,
    pub community_id: String,
    /// None on an anonymous post to every reader but its author (0091).
    pub author: Option<Author>,
    /// The post is anonymous (0091).
    #[serde(default)]
    pub anonymous: bool,
    /// The caller wrote it (0091).
    #[serde(default)]
    pub mine: bool,
    pub body: String,
    pub media: Vec<SocialMedia>,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Each emoji the caller can see, most used first (0100). The server's
    /// older `reactions` and `myReaction` are not read: they go once the
    /// client floor passes 0.16.0.
    pub emojis: Vec<EmojiCount>,
    /// The caller's own emoji, if any (0100).
    pub my_emoji: Option<String>,
    pub comment_count: u64,
    /// The newest comment the caller may read, for a preview (0080).
    #[serde(default)]
    pub latest_comment: Option<Comment>,
    pub state: ModerationState,
    /// A moderator pinned it to the top of the community (0080); the first
    /// post of the community's first page.
    #[serde(default)]
    pub pinned: bool,
    /// Present when the post is a poll (0090).
    #[serde(default)]
    pub poll: Option<Poll>,
    /// Present on a wall post (0115): `community_id` is then the wall's id,
    /// and this names the account whose wall it is.
    #[serde(default)]
    pub wall: Option<WallOwner>,
    /// Who may read a wall post (0115); none on a community's post.
    #[serde(default)]
    pub audience: Option<WallAudience>,
}

/// The account whose wall a post stands on (0115).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallOwner {
    pub account_id: String,
}

/// Who may read a wall post (0115).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WallAudience {
    Friends,
    Everyone,
}

/// A poll's options and counts (0090). No field says who voted or how.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    pub options: Vec<PollOption>,
    /// How many votes the poll has, always shown.
    pub total: u64,
    /// The option the caller voted for.
    pub mine: Option<String>,
    /// It takes no more votes, and shows its results to every reader.
    pub closed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollOption {
    pub option_id: String,
    pub text: String,
    /// None while the caller has not voted, unless they see results at once
    /// (the author, the moderators, any reader of a closed poll).
    pub votes: Option<u64>,
}

/// A page of a community's posts, newest first, and the cursor of the next,
/// older page. A page may be short, or empty, with more after it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PostPage {
    pub posts: Vec<Post>,
    pub next: Option<String>,
}

/// A page of the home feed (0116). An empty page with a cursor is a normal
/// answer: the server filters a page after reading it, so more can follow one
/// that shows nothing. Only `End` says there is no more, and a match has to say
/// which of the two it is rather than read that off the posts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HomePage {
    /// `posts` may be empty; fetch again with `next`.
    More {
        posts: Vec<Post>,
        next: String,
    },
    End {
        posts: Vec<Post>,
    },
}

impl From<PostPage> for HomePage {
    fn from(PostPage { posts, next }: PostPage) -> Self {
        match next {
            Some(next) => Self::More { posts, next },
            None => Self::End { posts },
        }
    }
}

impl<T: Transport> Api<'_, T> {
    /// `getHome`: the caller's friends' wall posts and its communities' posts,
    /// newest first, older than `before`.
    pub fn home(&self, before: Option<&str>, limit: u32) -> Result<HomePage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(limit.as_str()))];
        let path = with_query("/v1/home", &params);
        let page: PostPage = self.call(Method::Get, path, None, "getHome")?;
        Ok(page.into())
    }
}
