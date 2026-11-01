//! A post as the apps see it: in a community, or on a wall (0115), one type.

use spjall_client::api;
pub use spjall_client::api::WallAudience;

use super::{Author, Comment, EmojiCount, ModerationState, PostImage};

/// Who may read a wall post (0115).
#[uniffi::remote(Enum)]
pub enum WallAudience {
    Friends,
    Everyone,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Post {
    pub post_id: String,
    pub community_id: String,
    /// None on an anonymous post to every reader but its author (0091).
    pub author: Option<Author>,
    /// Posted without the author's name (0091).
    #[uniffi(default = false)]
    pub anonymous: bool,
    /// This account wrote it (0091).
    #[uniffi(default = false)]
    pub mine: bool,
    pub body: String,
    pub images: Vec<PostImage>,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Each emoji this account can see, most used first (0100).
    pub emojis: Vec<EmojiCount>,
    /// This account's own emoji, if any.
    pub my_emoji: Option<String>,
    pub comment_count: u64,
    /// The newest comment this account may read, for a preview (0080).
    #[uniffi(default = None)]
    pub latest_comment: Option<Comment>,
    pub state: ModerationState,
    /// A moderator pinned it to the top of the community (0080).
    #[uniffi(default = false)]
    pub pinned: bool,
    /// Present when the post is a poll (0090).
    #[uniffi(default = None)]
    pub poll: Option<Poll>,
    /// On a wall post (0115), the account whose wall it is: `community_id` is
    /// then the wall's id, which is no community to open.
    #[uniffi(default = None)]
    pub wall_owner: Option<String>,
    /// Who may read a wall post (0115); none on a community's post.
    #[uniffi(default = None)]
    pub audience: Option<WallAudience>,
}

/// A poll's options and counts (0090). No field says who voted or how.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Poll {
    pub options: Vec<PollOption>,
    /// How many votes the poll has, always shown.
    pub total: u64,
    /// The option this account voted for.
    pub mine: Option<String>,
    /// It takes no more votes and shows its results to every reader.
    pub closed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PollOption {
    pub option_id: String,
    pub text: String,
    /// None until this account has voted, unless it sees results at once.
    pub votes: Option<u64>,
}

impl From<api::Poll> for Poll {
    fn from(poll: api::Poll) -> Self {
        let api::Poll {
            total,
            mine,
            closed,
            options,
        } = poll;

        Self {
            options: options
                .into_iter()
                .map(
                    |api::PollOption {
                         option_id,
                         text,
                         votes,
                     }| PollOption {
                        option_id,
                        text,
                        votes,
                    },
                )
                .collect(),
            total,
            mine,
            closed,
        }
    }
}

impl From<api::Post> for Post {
    fn from(post: api::Post) -> Self {
        let api::Post {
            post_id,
            community_id,
            author,
            anonymous,
            mine,
            body,
            media,
            created_at,
            my_emoji,
            comment_count,
            latest_comment,
            state,
            pinned,
            poll,
            wall,
            audience,
            emojis,
        } = post;

        Self {
            post_id,
            community_id,
            author,
            anonymous,
            mine,
            body,
            images: media.into_iter().map(Into::into).collect(),
            created_at,
            emojis: emojis
                .into_iter()
                .map(|api::EmojiCount { emoji, count }| EmojiCount { emoji, count })
                .collect(),
            my_emoji,
            comment_count,
            latest_comment: latest_comment.map(Into::into),
            state,
            pinned,
            poll: poll.map(Into::into),
            wall_owner: wall.map(|api::WallOwner { account_id }| account_id),
            audience,
        }
    }
}

/// A page of a community's posts, newest first. A page may be short, or
/// empty, with more after it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PostPage {
    pub posts: Vec<Post>,
    /// The `before` of the next, older page; none on the last.
    pub next: Option<String>,
}

/// Whether the server would take a poll with this question and these options,
/// so both apps ask rather than hold the rule (0090).
#[uniffi::export]
#[must_use]
pub fn poll_draft_valid(question: String, options: Vec<String>) -> bool {
    spjall_client::social::poll_draft_valid(&question, &options)
}
