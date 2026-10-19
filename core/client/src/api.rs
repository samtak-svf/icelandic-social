//! The HTTP side of `api/openapi.json`, written once here (0018). The app's
//! `Transport` makes one blocking request with its base URL; the paths,
//! bodies, device token and error codes are this module's.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use std::path::Path;

use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
}

/// A request to the API: `path` starts at `/v1/` and holds any query, and
/// `body` is JSON. The transport adds the base URL, `Authorization: Bearer`
/// with `bearer` when there is one, `Spjall-Client` with `client` when there
/// is one (0030), and `content-type: application/json` when there is a body;
/// the Worker answers 415 without it.
///
/// The core hands the transport the device token on each request rather
/// than the transport asking for it, because the app's transport runs while
/// the client is busy with the call that made the request (0019).
#[derive(Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub body: Option<String>,
    pub bearer: Option<String>,
    pub client: Option<String>,
}

/// Never prints the token or the body, which can hold a PKCE verifier.
impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("method", &self.method)
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

/// Any answer the server gave, whatever its status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

/// No answer came back. The request may or may not have reached the server,
/// which is why everything sent is safe to send again.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("no answer: {0}")]
pub struct Unreachable(pub String);

/// What the app provides: one blocking HTTP request. Called off the main
/// thread, and never inside a store transaction.
pub trait Transport {
    fn request(&self, request: Request) -> Result<Response, Unreachable>;

    /// A `PUT` of the file at `file` as `application/octet-stream`, with
    /// its `Content-Length`, streamed from disk. `request.body` is none.
    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable>;

    /// A `GET` whose body, on 200, is streamed into a new file at `to` and
    /// left out of the response; any other answer's body is returned as
    /// text, as `request` returns it.
    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ApiError {
    #[error(transparent)]
    Unreachable(#[from] Unreachable),
    /// The server answered with an `ApiError` code. `request_id` is the
    /// id the server gave the request (0037), for the person to quote to
    /// support; none from a server older than that, or a body that is not
    /// an `ApiError`.
    #[error("{status} {code}")]
    Refused {
        status: u16,
        code: String,
        request_id: Option<String>,
    },
    /// The server answered with something the contract does not allow.
    #[error("malformed answer to {0}")]
    Malformed(&'static str),
    /// This build is below the version floor; `min` is the lowest the
    /// server still serves on this platform (0030).
    #[error("this build is too old; the server needs {min}")]
    ClientTooOld { min: String },
}

impl ApiError {
    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Refused { code, .. } => Some(code),
            _ => None,
        }
    }

    /// The server's id for a refused request (0037), when it named one.
    pub fn request_id(&self) -> Option<&str> {
        match self {
            Self::Refused { request_id, .. } => request_id.as_deref(),
            _ => None,
        }
    }
}

/// A group id as the API names its conversation: unpadded base64url.
pub fn conversation_id(group_id: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(group_id)
}

pub fn group_id(conversation_id: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(conversation_id).ok()
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub(crate) fn from_base64(text: &str) -> Option<Vec<u8>> {
    STANDARD.decode(text).ok()
}

/// A sealed outbox row, as `sendMessage` takes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub client_msg_id: String,
    pub ciphertext: Vec<u8>,
    /// A commit's Welcome; who it is for is in the commit's claim (0020).
    pub welcome: Option<Vec<u8>>,
    /// A commit's GroupInfo for the epoch it starts (0021).
    pub group_info: Option<Vec<u8>>,
    /// The other members' devices are pushed for it (0025): text, replies
    /// and media are; receipts, reactions, edits, deletes and commits are not.
    pub urgent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendBody<'a> {
    client_msg_id: &'a str,
    ciphertext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    welcome: Option<WelcomeMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group_info: Option<String>,
    urgent: bool,
}

#[derive(Serialize)]
struct WelcomeMessage {
    message: String,
}

#[derive(Deserialize)]
struct Sent {
    seq: u64,
}

#[derive(Deserialize)]
struct Listed {
    messages: Vec<Stored>,
    more: bool,
}

/// One page of `listMessages`: messages oldest first, and whether more
/// follow.
pub struct Page {
    pub messages: Vec<Fetched>,
    pub more: bool,
}

/// A stored message as `listMessages` gives it.
pub struct Fetched {
    pub seq: u64,
    pub bytes: Vec<u8>,
    /// When the server stored it, in milliseconds by its clock (0048); None
    /// from a server older than that.
    pub stored_at: Option<u64>,
}

#[derive(Deserialize)]
struct Stored {
    seq: u64,
    ciphertext: String,
    #[serde(default, rename = "storedAt")]
    stored_at: Option<u64>,
}

#[derive(Deserialize)]
struct Welcome {
    seq: u64,
    welcome: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatestGroupInfo {
    seq: u64,
    group_info: String,
}

/// `uploadKeyPackages`' answer (0029).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    /// Unclaimed packages valid for at least 14 more days.
    pub available: u32,
    /// When the last resort expires, in milliseconds; none if there is none.
    pub last_resort_not_after: Option<u64>,
}

#[derive(Deserialize)]
struct ConversationDevices {
    accounts: Vec<AccountDevices>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDevices {
    account_id: String,
    device_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Claimed {
    key_packages: Vec<ClaimedPackage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedPackage {
    device_id: String,
    key_package: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: String,
    min_version: Option<String>,
    /// Every error body names its request since 0037.
    request_id: Option<String>,
}

/// `getSignInConfig`: where the app sends the person to sign in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInConfig {
    pub authorization_endpoint: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scope: String,
}

/// Who a person signs in with (0033): Google first, Kenni for the mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Google,
    Kenni,
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Kenni => "kenni",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Android,
    Ios,
}

/// What a browser sign-in hands back: the provider's code and the PKCE
/// verifier, redirect and nonce that bind it. The verifier goes to the
/// server in this one request and nowhere else.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization<'a> {
    pub provider: Provider,
    pub code: &'a str,
    #[serde(rename = "codeVerifier")]
    pub verifier: &'a str,
    pub redirect_uri: &'a str,
    pub nonce: &'a str,
}

/// `linkIdentity`'s body: the authorization, and that this client follows
/// a move (0035).
#[derive(Serialize)]
struct LinkIdentity<'a> {
    #[serde(flatten)]
    authorization: &'a Authorization<'a>,
    merge: bool,
}

/// `linkIdentity`'s answer to a client that follows a move.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Linked {
    account_id: String,
}

/// `registerDevice`'s body.
pub struct Registration<'a> {
    pub authorization: Authorization<'a>,
    pub platform: Platform,
    pub device_key: &'a [u8],
    pub invite: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody<'a> {
    #[serde(flatten)]
    authorization: &'a Authorization<'a>,
    platform: Platform,
    device_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    invite_token: Option<&'a str>,
}

/// `registerDevice`'s answer: the token is shown once.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registered {
    pub account_id: String,
    pub device_id: String,
    pub token: String,
}

/// `getMe`: this account and its devices.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub account_id: String,
    /// The registry name, if Kenni gave one.
    pub name: Option<String>,
    pub verified: bool,
    /// The version of this account's photo (0039), none when it has none.
    #[serde(default)]
    pub photo: Option<String>,
    pub devices: Vec<AccountDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: Platform,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// The device that asked.
    pub current: bool,
}

#[derive(Deserialize)]
struct NewInvite {
    link: String,
}

/// Who made an invite, as `resolveInvite` shows it before sign-in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inviter {
    /// The account the invite opens a 1:1 with (0022).
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// Another account's name, mark and photo version, as `getAccount` shows
/// them (0034, 0039).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Profile {
    pub name: Option<String>,
    pub verified: bool,
    /// The version of the account's photo (0039), none when it has none or
    /// a block stands between the two.
    #[serde(default)]
    pub photo: Option<String>,
}

/// An account this account blocked, as `listBlocks` shows it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// Milliseconds since the epoch.
    pub blocked_at: u64,
}

/// An account in the directory (0036), as `listPeople` shows it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// The version of the account's photo (0039), none when it has none or
    /// a block stands between the two.
    #[serde(default)]
    pub photo: Option<String>,
}

/// A page of the directory, verified first, then by name, and the cursor
/// of the next page, none on the last.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PeoplePage {
    pub people: Vec<DirectoryEntry>,
    pub next: Option<String>,
}

/// `setPhoto`'s answer: the new version (0039).
#[derive(Deserialize)]
struct PhotoSet {
    photo: String,
}

#[derive(Deserialize)]
struct Blocks {
    blocked: Vec<Blocked>,
}

/// A muted conversation, as `muteConversation` and `listMutes` show it (0042).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Muted {
    pub conversation_id: String,
    /// Unix milliseconds by the server's clock; none until turned back on.
    pub until: Option<u64>,
}

#[derive(Deserialize)]
struct Mutes {
    mutes: Vec<Muted>,
}

#[derive(Deserialize)]
struct Resolved {
    inviter: Option<Inviter>,
}

/// Who wrote a post or a comment, made a notification, or was reported
/// (0063), as the social calls name them.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// Who reads a community and how one joins it (0063).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Audience {
    /// Every signed-in account reads it and joins at once.
    Open,
    /// Only members read it; joining takes a moderator's approval or an
    /// invitation.
    Private,
}

/// An account's role in a community.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Moderator,
    Member,
}

/// A community as the caller sees it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Community {
    pub community_id: String,
    pub name: String,
    pub description: String,
    pub audience: Audience,
    /// Unix milliseconds.
    pub created_at: u64,
    /// None for a private community the caller is not a member of.
    pub member_count: Option<u64>,
    /// The caller's role; none when not a member.
    pub role: Option<Role>,
    /// The caller's join request waits.
    pub join_requested: bool,
    /// A moderator invited the caller.
    pub invited: bool,
    /// Until when, in Unix milliseconds, a moderator muted the caller here:
    /// it reads, but does not post, comment or react.
    pub muted_until: Option<u64>,
    /// Its owner's account was deleted and no moderator was left to take it
    /// over; it is deleted 90 days later.
    pub read_only: bool,
}

/// A page of `listCommunities`, and the cursor of the next, none on the last.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CommunityPage {
    pub communities: Vec<Community>,
    pub next: Option<String>,
}

#[derive(Deserialize)]
struct Communities {
    communities: Vec<Community>,
}

/// What `joinCommunity` did: an open community takes the account at once,
/// a private one keeps its request for a moderator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JoinState {
    Member,
    Requested,
}

#[derive(Deserialize)]
struct Joined {
    state: JoinState,
}

/// An image of a post, re-encoded by the server to WebP.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialMedia {
    pub media_id: String,
    pub width: u32,
    pub height: u32,
}

/// The reactions a post takes; an account has at most one on each post.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReactionKind {
    Like,
    Love,
    Laugh,
    Wow,
    Sad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct ReactionCount {
    pub kind: ReactionKind,
    pub count: u64,
}

/// Whether a moderator hid or removed a post or a comment; only a
/// moderator is shown one that is not visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModerationState {
    Visible,
    Hidden,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub post_id: String,
    pub community_id: String,
    pub author: Author,
    pub body: String,
    pub media: Vec<SocialMedia>,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Each reaction the caller can see, with its count.
    pub reactions: Vec<ReactionCount>,
    pub my_reaction: Option<ReactionKind>,
    pub comment_count: u64,
    pub state: ModerationState,
}

/// A page of a community's posts, newest first, and the cursor of the next,
/// older page. A page may be short, or empty, with more after it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PostPage {
    pub posts: Vec<Post>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// The post's id, a hyphen, and the comment's own part.
    pub comment_id: String,
    pub post_id: String,
    pub author: Author,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
    pub state: ModerationState,
}

/// A page of a post's comments, oldest first, and the cursor of the next.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CommentPage {
    pub comments: Vec<Comment>,
    pub next: Option<String>,
}

/// What a report or a moderator's action is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Post,
    Comment,
    Community,
    Account,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub kind: TargetKind,
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportReason {
    Unlawful,
    Harassment,
    Spam,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportState {
    Open,
    Closed,
}

impl ReportState {
    fn name(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
        }
    }
}

/// `report`'s body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReport {
    pub target: Target,
    pub reason: ReportReason,
    pub note: String,
    /// To the platform's moderators rather than the community's.
    pub to_platform: bool,
}

/// A report in a moderator's queue, without the account that made it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub report_id: String,
    /// None for a report about an account, made to the platform.
    pub community_id: Option<String>,
    pub target: Target,
    /// Whose content it is, or the account reported.
    pub target_account: Option<Author>,
    pub reason: ReportReason,
    pub note: String,
    pub state: ReportState,
    /// Unix milliseconds.
    pub created_at: u64,
    pub closed_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReportPage {
    pub reports: Vec<Report>,
    pub next: Option<String>,
}

/// What a moderator can do in a community (0063).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationAction {
    HidePost,
    RemovePost,
    RestorePost,
    HideComment,
    RemoveComment,
    RestoreComment,
    MuteMember,
    UnmuteMember,
    RemoveMember,
    BanMember,
    UnbanMember,
}

/// `moderate`'s body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moderation {
    pub action: ModerationAction,
    /// The post's, the comment's or the account's id.
    pub target_id: String,
    pub reason: String,
    /// The report the action answers, if one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_id: Option<String>,
    /// With `MuteMember` only: when the mute ends, in Unix milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<u64>,
}

/// What a card can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Post,
    Comment,
    Community,
}

/// A stable reference to a post, a comment or a community.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ref {
    pub kind: RefKind,
    pub id: String,
}

/// The community a card's post or comment is in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardCommunity {
    pub community_id: String,
    pub name: String,
}

/// What a reference shows, by its kind: `Unavailable` when the caller may
/// not see it. An excerpt is the text's first 280 characters, an ellipsis
/// ending one cut short.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum Card {
    Unavailable {
        #[serde(rename = "ref")]
        reference: Ref,
    },
    Post {
        #[serde(rename = "ref")]
        reference: Ref,
        community: CardCommunity,
        author: Author,
        excerpt: String,
        image: Option<SocialMedia>,
        created_at: u64,
    },
    Comment {
        #[serde(rename = "ref")]
        reference: Ref,
        community: CardCommunity,
        post_id: String,
        author: Author,
        excerpt: String,
        created_at: u64,
    },
    Community {
        #[serde(rename = "ref")]
        reference: Ref,
        community: CardCommunity,
        description: String,
        audience: Audience,
        member_count: Option<u64>,
    },
}

#[derive(Deserialize)]
struct Cards {
    cards: Vec<Card>,
}

/// What a notification is about (0063).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    /// A comment on the caller's post.
    Comment,
    /// A reaction on the caller's post.
    Reaction,
    /// A moderator approved the caller's join request.
    JoinApproved,
    /// A moderator acted on the caller's content; `action` says how.
    Moderated,
}

/// Something addressed to the caller. It carries ids, never the content:
/// the post or comment is read through the same checks as any other.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub notification_id: String,
    pub kind: NotificationKind,
    /// Who did it; none once that account is deleted.
    pub actor: Option<Author>,
    pub community_id: String,
    pub post_id: Option<String>,
    pub comment_id: Option<String>,
    /// For `Moderated`, the moderator's action.
    pub action: Option<ModerationAction>,
    /// Unix milliseconds.
    pub created_at: u64,
    pub read: bool,
}

/// A page of notifications, newest first; `unread` counts all of the
/// caller's, not only this page's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationPage {
    pub notifications: Vec<Notification>,
    pub unread: u64,
    pub next: Option<String>,
}

/// A notification as the server sends it: a kind or an action this build
/// does not know is left out rather than failing the page, since the server
/// adds kinds before the apps show them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentNotification {
    notification_id: String,
    kind: serde_json::Value,
    actor: Option<Author>,
    community_id: String,
    post_id: Option<String>,
    comment_id: Option<String>,
    action: Option<serde_json::Value>,
    created_at: u64,
    read: bool,
}

impl SentNotification {
    fn known(self) -> Option<Notification> {
        Some(Notification {
            notification_id: self.notification_id,
            kind: serde_json::from_value(self.kind).ok()?,
            actor: self.actor,
            community_id: self.community_id,
            post_id: self.post_id,
            comment_id: self.comment_id,
            action: self.action.and_then(|a| serde_json::from_value(a).ok()),
            created_at: self.created_at,
            read: self.read,
        })
    }
}

#[derive(Deserialize)]
struct SentNotifications {
    notifications: Vec<SentNotification>,
    unread: u64,
    next: Option<String>,
}

/// `path` with each present `(name, value)` as a query parameter, encoded.
fn with_query(path: &str, params: &[(&str, Option<&str>)]) -> String {
    let query: Vec<String> = params
        .iter()
        .filter_map(|(name, value)| Some(format!("{name}={}", crate::account::encode((*value)?))))
        .collect();
    if query.is_empty() {
        path.to_owned()
    } else {
        format!("{path}?{}", query.join("&"))
    }
}

/// The operations the client uses, over the app's transport, as the device
/// `bearer` names, or as no device for the calls made before sign-in.
pub struct Api<'a, T: ?Sized> {
    transport: &'a T,
    bearer: Option<&'a str>,
    client: Option<&'a str>,
}

impl<'a, T: Transport + ?Sized> Api<'a, T> {
    pub fn new(transport: &'a T, bearer: Option<&'a str>) -> Self {
        Self {
            transport,
            bearer,
            client: None,
        }
    }

    /// Names this build in `Spjall-Client` on every request (0030).
    pub fn client(mut self, client: Option<&'a str>) -> Self {
        self.client = client;
        self
    }

    /// The answer on 200, 201 or 204, or the `ApiError` code it was refused with.
    fn send(
        &self,
        method: Method,
        path: String,
        body: Option<String>,
    ) -> Result<Response, ApiError> {
        let response = self.transport.request(self.request(method, path, body))?;
        Self::checked(response)
    }

    fn request(&self, method: Method, path: String, body: Option<String>) -> Request {
        Request {
            method,
            path,
            body,
            bearer: self.bearer.map(str::to_owned),
            client: self.client.map(str::to_owned),
        }
    }

    fn checked(response: Response) -> Result<Response, ApiError> {
        if matches!(response.status, 200 | 201 | 204) {
            return Ok(response);
        }
        let body = serde_json::from_str::<ErrorBody>(&response.body).ok();
        if response.status == 426 {
            let min = body.and_then(|b| b.min_version).unwrap_or_default();
            return Err(ApiError::ClientTooOld { min });
        }
        let (code, request_id) = body.map(|b| (b.error, b.request_id)).unwrap_or_default();
        Err(ApiError::Refused {
            status: response.status,
            code,
            request_id,
        })
    }

    fn call<R: DeserializeOwned>(
        &self,
        method: Method,
        path: String,
        body: Option<String>,
        what: &'static str,
    ) -> Result<R, ApiError> {
        let response = self.send(method, path, body)?;
        serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed(what))
    }

    fn json(value: &impl Serialize) -> Option<String> {
        Some(serde_json::to_string(value).expect("request bodies serialize"))
    }

    /// `createConversation`: 200 also when this account already created it.
    pub fn create_conversation(&self, conversation: &str) -> Result<(), ApiError> {
        let body = serde_json::json!({ "conversationId": conversation });
        self.call::<serde_json::Value>(
            Method::Post,
            "/v1/conversations".into(),
            Self::json(&body),
            "createConversation",
        )
        .map(drop)
    }

    /// `sendMessage`: the seq the message was stored at, the same on a retry.
    pub fn send_message(&self, conversation: &str, out: &Outgoing) -> Result<u64, ApiError> {
        let body = SendBody {
            client_msg_id: &out.client_msg_id,
            ciphertext: base64(&out.ciphertext),
            welcome: out.welcome.as_ref().map(|message| WelcomeMessage {
                message: base64(message),
            }),
            group_info: out.group_info.as_deref().map(base64),
            urgent: out.urgent,
        };
        let sent: Sent = self.call(
            Method::Post,
            format!("/v1/conversations/{conversation}/messages"),
            Self::json(&body),
            "sendMessage",
        )?;
        Ok(sent.seq)
    }

    /// `listMessages`: messages after `after`, oldest first, and whether more follow.
    pub fn list_messages(&self, conversation: &str, after: u64) -> Result<Page, ApiError> {
        let page: Listed = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/messages?after={after}"),
            None,
            "listMessages",
        )?;
        let messages = page
            .messages
            .into_iter()
            .map(|m| {
                Ok(Fetched {
                    seq: m.seq,
                    bytes: from_base64(&m.ciphertext).ok_or(())?,
                    stored_at: m.stored_at,
                })
            })
            .collect::<Result<_, ()>>()
            .map_err(|_| ApiError::Malformed("listMessages"))?;
        Ok(Page {
            messages,
            more: page.more,
        })
    }

    /// `getWelcome`: the seq of the commit that added this account, and the Welcome.
    pub fn get_welcome(&self, conversation: &str) -> Result<(u64, Vec<u8>), ApiError> {
        let welcome: Welcome = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/welcome"),
            None,
            "getWelcome",
        )?;
        let bytes = from_base64(&welcome.welcome).ok_or(ApiError::Malformed("getWelcome"))?;
        Ok((welcome.seq, bytes))
    }

    /// `getGroupInfo`: the GroupInfo of the latest commit, and its seq (0021).
    pub fn get_group_info(&self, conversation: &str) -> Result<(u64, Vec<u8>), ApiError> {
        let latest: LatestGroupInfo = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/group-info"),
            None,
            "getGroupInfo",
        )?;
        let bytes = from_base64(&latest.group_info).ok_or(ApiError::Malformed("getGroupInfo"))?;
        Ok((latest.seq, bytes))
    }

    /// `uploadKeyPackages`: what this device now holds on the server.
    pub fn upload_key_packages(
        &self,
        packages: &[Vec<u8>],
        last_resort: Option<&[u8]>,
    ) -> Result<Stock, ApiError> {
        let mut body = serde_json::json!({
            "keyPackages": packages.iter().map(|p| base64(p)).collect::<Vec<_>>(),
        });
        if let Some(last_resort) = last_resort {
            body["lastResort"] = base64(last_resort).into();
        }
        let stock = self.call::<Stock>(
            Method::Post,
            "/v1/key-packages".into(),
            Self::json(&body),
            "uploadKeyPackages",
        )?;
        Ok(stock)
    }

    /// `getConversationDevices`: each roster account and the devices the
    /// server still serves, none for a deleted account (0028).
    pub fn conversation_devices(
        &self,
        conversation: &str,
    ) -> Result<Vec<(String, Vec<String>)>, ApiError> {
        let listed: ConversationDevices = self.call(
            Method::Get,
            format!("/v1/conversations/{conversation}/devices"),
            None,
            "getConversationDevices",
        )?;
        Ok(listed
            .accounts
            .into_iter()
            .map(|a| (a.account_id, a.device_ids))
            .collect())
    }

    /// `claimKeyPackages`: one per device of the account but this one.
    pub fn claim_key_packages(&self, account: &str) -> Result<Vec<(String, Vec<u8>)>, ApiError> {
        let claimed: Claimed = self.call(
            Method::Post,
            format!("/v1/accounts/{account}/key-packages"),
            Some("{}".into()),
            "claimKeyPackages",
        )?;
        claimed
            .key_packages
            .into_iter()
            .map(|p| Ok((p.device_id, from_base64(&p.key_package).ok_or(())?)))
            .collect::<Result<_, ()>>()
            .map_err(|_| ApiError::Malformed("claimKeyPackages"))
    }
}

/// The calls about the person and the device (0019).
impl<T: Transport + ?Sized> Api<'_, T> {
    /// `getSignInConfig` for one provider.
    pub fn sign_in_config(&self, provider: Provider) -> Result<SignInConfig, ApiError> {
        self.call(
            Method::Get,
            format!("/v1/sign-in?provider={}", provider.name()),
            None,
            "getSignInConfig",
        )
    }

    /// `registerDevice`: the server redeems the code with the provider itself.
    pub fn register_device(&self, registration: &Registration) -> Result<Registered, ApiError> {
        let body = RegisterBody {
            authorization: &registration.authorization,
            platform: registration.platform,
            device_key: base64(registration.device_key),
            invite_token: registration.invite,
        };
        self.call(
            Method::Post,
            "/v1/devices".into(),
            Self::json(&body),
            "registerDevice",
        )
    }

    /// `linkIdentity` (0033), as a client that follows a move (0035): the
    /// account this device belongs to afterwards, which differs from its own
    /// when Kenni joined it into the account holding the kennitala. `None`
    /// from a server before 0035, which answers 204 and never moves it.
    pub fn link_identity(&self, authorization: &Authorization) -> Result<Option<String>, ApiError> {
        let body = LinkIdentity {
            authorization,
            merge: true,
        };
        let response = self.send(Method::Post, "/v1/me/identities".into(), Self::json(&body))?;
        if response.status == 204 {
            return Ok(None);
        }
        let linked: Linked = serde_json::from_str(&response.body)
            .map_err(|_| ApiError::Malformed("linkIdentity"))?;
        Ok(Some(linked.account_id))
    }

    /// `getMe`.
    pub fn me(&self) -> Result<Me, ApiError> {
        self.call(Method::Get, "/v1/me".into(), None, "getMe")
    }

    /// `rotateInvite`: the new link; the old one stops working.
    pub fn rotate_invite(&self) -> Result<String, ApiError> {
        let invite: NewInvite = self.call(
            Method::Post,
            "/v1/me/invite".into(),
            Some("{}".into()),
            "rotateInvite",
        )?;
        Ok(invite.link)
    }

    /// `revokeInvite`: the account is left with no working link.
    pub fn revoke_invite(&self) -> Result<(), ApiError> {
        self.send(Method::Delete, "/v1/me/invite".into(), None)
            .map(drop)
    }

    /// `resolveInvite`: who made it, or `None` for the operator's.
    pub fn resolve_invite(&self, token: &str) -> Result<Option<Inviter>, ApiError> {
        let resolved: Resolved = self.call(
            Method::Get,
            format!("/v1/invites/{token}"),
            None,
            "resolveInvite",
        )?;
        Ok(resolved.inviter)
    }

    /// `getAccount`: any account's name and mark (0034); 404 for none.
    pub fn profile(&self, account: &str) -> Result<Profile, ApiError> {
        self.call(
            Method::Get,
            format!("/v1/accounts/{account}"),
            None,
            "getAccount",
        )
    }

    /// `setPushToken` (0025): only this device's own.
    pub fn set_push_token(&self, device: &str, token: &str, sandbox: bool) -> Result<(), ApiError> {
        let body = serde_json::json!({ "token": token, "sandbox": sandbox });
        self.send(
            Method::Put,
            format!("/v1/devices/{device}/push"),
            Self::json(&body),
        )
        .map(drop)
    }

    /// `revokeDevice`.
    pub fn revoke_device(&self, device: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/devices/{device}"), None)
            .map(drop)
    }

    /// `deleteAccount`.
    pub fn delete_account(&self) -> Result<(), ApiError> {
        self.send(Method::Delete, "/v1/me".into(), None).map(drop)
    }

    /// `putMedia`: the sealed file at `file`, under a new id.
    pub fn put_media(&self, conversation: &str, id: &str, file: &Path) -> Result<(), ApiError> {
        let request = self.request(
            Method::Put,
            format!("/v1/conversations/{conversation}/media/{id}"),
            None,
        );
        Self::checked(self.transport.upload(request, file)?).map(drop)
    }

    /// `getMedia`: the sealed file, written to `to`.
    pub fn get_media(&self, conversation: &str, id: &str, to: &Path) -> Result<(), ApiError> {
        let request = self.request(
            Method::Get,
            format!("/v1/conversations/{conversation}/media/{id}"),
            None,
        );
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `setPhoto` (0039): the image at `file`, which the server re-encodes
    /// and keeps in place of any earlier photo. The new version.
    pub fn set_photo(&self, file: &Path) -> Result<String, ApiError> {
        let request = self.request(Method::Put, "/v1/me/photo".into(), None);
        let response = Self::checked(self.transport.upload(request, file)?)?;
        let set: PhotoSet =
            serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed("setPhoto"))?;
        Ok(set.photo)
    }

    /// `removePhoto`: no error when there was none.
    pub fn remove_photo(&self) -> Result<(), ApiError> {
        self.send(Method::Delete, "/v1/me/photo".into(), None)
            .map(drop)
    }

    /// `getPhoto`: the account's photo, a WebP, written to `to`. 404 when it
    /// has none, or a block stands between the two.
    pub fn get_photo(&self, account: &str, to: &Path) -> Result<(), ApiError> {
        let request = self.request(Method::Get, format!("/v1/accounts/{account}/photo"), None);
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `blockAccount`: 204 also when already blocked.
    pub fn block(&self, account: &str) -> Result<(), ApiError> {
        self.send(Method::Put, format!("/v1/blocks/{account}"), None)
            .map(drop)
    }

    /// `unblockAccount`: 204 also when not blocked.
    pub fn unblock(&self, account: &str) -> Result<(), ApiError> {
        self.send(Method::Delete, format!("/v1/blocks/{account}"), None)
            .map(drop)
    }

    /// `listPeople` (0036): every other signed-in account, those whose name
    /// contains `query` when there is one.
    pub fn people(
        &self,
        query: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<PeoplePage, ApiError> {
        let mut path = String::from("/v1/people?");
        if let Some(query) = query {
            path.push_str(&format!("q={}&", crate::account::encode(query)));
        }
        if let Some(after) = after {
            path.push_str(&format!("after={}&", crate::account::encode(after)));
        }
        path.push_str(&format!("limit={limit}"));
        self.call(Method::Get, path, None, "listPeople")
    }

    /// `listBlocks`: newest first.
    pub fn blocks(&self) -> Result<Vec<Blocked>, ApiError> {
        let blocks: Blocks = self.call(Method::Get, "/v1/blocks".into(), None, "listBlocks")?;
        Ok(blocks.blocked)
    }

    /// `muteConversation` (0042): `duration` is `1h`, `8h` or `always`, and
    /// the server sets the end by its own clock.
    pub fn mute(&self, conversation: &str, duration: &str) -> Result<Muted, ApiError> {
        let body = serde_json::json!({ "for": duration });
        self.call(
            Method::Put,
            format!("/v1/conversations/{conversation}/mute"),
            Self::json(&body),
            "muteConversation",
        )
    }

    /// `unmuteConversation`: 204 also when not muted.
    pub fn unmute(&self, conversation: &str) -> Result<(), ApiError> {
        self.send(
            Method::Delete,
            format!("/v1/conversations/{conversation}/mute"),
            None,
        )
        .map(drop)
    }

    /// `listMutes`: the mutes in force, by conversation.
    pub fn mutes(&self) -> Result<Vec<Muted>, ApiError> {
        let mutes: Mutes = self.call(Method::Get, "/v1/mutes".into(), None, "listMutes")?;
        Ok(mutes.mutes)
    }
}

/// The social calls (0063): communities, posts, comments, reactions,
/// reports, moderation and notifications. Ids go into the path as given,
/// so the caller checks them; cursors and searches are encoded here.
impl<T: Transport + ?Sized> Api<'_, T> {
    fn done(&self, method: Method, path: String, body: Option<String>) -> Result<(), ApiError> {
        self.send(method, path, body).map(drop)
    }

    /// `listCommunities`: those whose name matches `query`, when there is one.
    pub fn communities(
        &self,
        query: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<CommunityPage, ApiError> {
        let limit = limit.to_string();
        let params = [("q", query), ("after", after), ("limit", Some(&limit))];
        let path = with_query("/v1/communities", &params);
        self.call(Method::Get, path, None, "listCommunities")
    }

    /// `myCommunities`: every community this account is a member of.
    pub fn my_communities(&self) -> Result<Vec<Community>, ApiError> {
        let listed: Communities = self.call(
            Method::Get,
            "/v1/me/communities".into(),
            None,
            "myCommunities",
        )?;
        Ok(listed.communities)
    }

    /// `createCommunity`: this account becomes its owner.
    pub fn create_community(
        &self,
        name: &str,
        description: &str,
        audience: Audience,
    ) -> Result<Community, ApiError> {
        let body = serde_json::json!({
            "name": name, "description": description, "audience": audience,
        });
        self.call(
            Method::Post,
            "/v1/communities".into(),
            Self::json(&body),
            "createCommunity",
        )
    }

    /// `getCommunity`.
    pub fn community(&self, community: &str) -> Result<Community, ApiError> {
        self.call(
            Method::Get,
            format!("/v1/communities/{community}"),
            None,
            "getCommunity",
        )
    }

    /// `joinCommunity`.
    pub fn join_community(&self, community: &str) -> Result<JoinState, ApiError> {
        let joined: Joined = self.call(
            Method::Post,
            format!("/v1/communities/{community}/join"),
            Some("{}".into()),
            "joinCommunity",
        )?;
        Ok(joined.state)
    }

    /// `withdrawJoinRequest`: 204 also when none waits.
    pub fn withdraw_join_request(&self, community: &str) -> Result<(), ApiError> {
        let path = format!("/v1/communities/{community}/join");
        self.done(Method::Delete, path, None)
    }

    /// `leaveCommunity`: 409 for its owner.
    pub fn leave_community(&self, community: &str) -> Result<(), ApiError> {
        let path = format!("/v1/communities/{community}/leave");
        self.done(Method::Post, path, Some("{}".into()))
    }

    /// `listCommunityPosts`: newest first, older than `before`.
    pub fn community_posts(
        &self,
        community: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<PostPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(limit.as_str()))];
        let path = with_query(&format!("/v1/communities/{community}/posts"), &params);
        self.call(Method::Get, path, None, "listCommunityPosts")
    }

    /// `uploadSocialMedia` (0065): the image at `file`, which the server
    /// re-encodes to WebP and keeps for a day unless a post takes it.
    pub fn upload_social_media(
        &self,
        community: &str,
        file: &Path,
    ) -> Result<SocialMedia, ApiError> {
        let path = format!("/v1/communities/{community}/media");
        let request = self.request(Method::Post, path, None);
        let response = Self::checked(self.transport.upload(request, file)?)?;
        serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed("uploadSocialMedia"))
    }

    /// `getPostMedia`: the image, a WebP, written to `to`.
    pub fn get_post_media(&self, post: &str, media: &str, to: &Path) -> Result<(), ApiError> {
        let request = self.request(Method::Get, format!("/v1/posts/{post}/media/{media}"), None);
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `createPost`: a text, images uploaded to the community, or both.
    pub fn create_post(
        &self,
        community: &str,
        body: &str,
        media: &[String],
    ) -> Result<Post, ApiError> {
        let body = serde_json::json!({ "body": body, "media": media });
        self.call(
            Method::Post,
            format!("/v1/communities/{community}/posts"),
            Self::json(&body),
            "createPost",
        )
    }

    /// `getPost`.
    pub fn post(&self, post: &str) -> Result<Post, ApiError> {
        self.call(Method::Get, format!("/v1/posts/{post}"), None, "getPost")
    }

    /// `deletePost`: its author's.
    pub fn delete_post(&self, post: &str) -> Result<(), ApiError> {
        self.done(Method::Delete, format!("/v1/posts/{post}"), None)
    }

    /// `react`: in place of any reaction this account had on the post.
    pub fn react(&self, post: &str, kind: ReactionKind) -> Result<(), ApiError> {
        let body = serde_json::json!({ "kind": kind });
        let path = format!("/v1/posts/{post}/reaction");
        self.done(Method::Put, path, Self::json(&body))
    }

    /// `unreact`: 204 also when there was none.
    pub fn unreact(&self, post: &str) -> Result<(), ApiError> {
        self.done(Method::Delete, format!("/v1/posts/{post}/reaction"), None)
    }

    /// `listComments`: oldest first, after `after`.
    pub fn comments(
        &self,
        post: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<CommentPage, ApiError> {
        let limit = limit.to_string();
        let params = [("after", after), ("limit", Some(limit.as_str()))];
        let path = with_query(&format!("/v1/posts/{post}/comments"), &params);
        self.call(Method::Get, path, None, "listComments")
    }

    /// `createComment`.
    pub fn create_comment(&self, post: &str, body: &str) -> Result<Comment, ApiError> {
        let body = serde_json::json!({ "body": body });
        self.call(
            Method::Post,
            format!("/v1/posts/{post}/comments"),
            Self::json(&body),
            "createComment",
        )
    }

    /// `deleteComment`: its author's.
    pub fn delete_comment(&self, comment: &str) -> Result<(), ApiError> {
        self.done(Method::Delete, format!("/v1/comments/{comment}"), None)
    }

    /// `report`: the account that made it is never shown to moderators.
    pub fn report(&self, report: &NewReport) -> Result<(), ApiError> {
        self.done(Method::Post, "/v1/reports".into(), Self::json(report))
    }

    /// `communityReports`: a moderator's queue.
    pub fn community_reports(
        &self,
        community: &str,
        state: ReportState,
        after: Option<&str>,
        limit: u32,
    ) -> Result<ReportPage, ApiError> {
        let limit = limit.to_string();
        let params = [
            ("state", Some(state.name())),
            ("after", after),
            ("limit", Some(limit.as_str())),
        ];
        let path = with_query(&format!("/v1/communities/{community}/reports"), &params);
        self.call(Method::Get, path, None, "communityReports")
    }

    /// `moderate`: one action, kept in the community's log.
    pub fn moderate(&self, community: &str, moderation: &Moderation) -> Result<(), ApiError> {
        let path = format!("/v1/communities/{community}/actions");
        self.done(Method::Post, path, Self::json(moderation))
    }

    /// `closeReport`.
    pub fn close_report(&self, report: &str, resolution: &str) -> Result<(), ApiError> {
        let body = serde_json::json!({ "resolution": resolution });
        let path = format!("/v1/reports/{report}/close");
        self.done(Method::Post, path, Self::json(&body))
    }

    /// `resolveCards`: one card per reference, in its order.
    pub fn resolve_cards(&self, refs: &[Ref]) -> Result<Vec<Card>, ApiError> {
        let body = serde_json::json!({ "refs": refs });
        let cards: Cards = self.call(
            Method::Post,
            "/v1/cards".into(),
            Self::json(&body),
            "resolveCards",
        )?;
        Ok(cards.cards)
    }

    /// `notifications`: newest first, older than `before`.
    pub fn notifications(
        &self,
        before: Option<&str>,
        limit: u32,
    ) -> Result<NotificationPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(limit.as_str()))];
        let path = with_query("/v1/notifications", &params);
        let page: SentNotifications = self.call(Method::Get, path, None, "notifications")?;
        Ok(NotificationPage {
            notifications: page
                .notifications
                .into_iter()
                .filter_map(SentNotification::known)
                .collect(),
            unread: page.unread,
            next: page.next,
        })
    }

    /// `readNotifications`: every one made at or before `up_to`, in Unix
    /// milliseconds.
    pub fn read_notifications(&self, up_to: u64) -> Result<(), ApiError> {
        let body = serde_json::json!({ "upTo": up_to });
        self.done(
            Method::Post,
            "/v1/notifications/read".into(),
            Self::json(&body),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refusal(status: u16, body: &str) -> ApiError {
        Api::<dyn Transport>::checked(Response {
            status,
            body: body.into(),
        })
        .unwrap_err()
    }

    #[test]
    fn a_refusal_keeps_the_request_id_the_server_named() {
        let error = refusal(
            401,
            r#"{"error":"unauthorized","requestId":"8c1f2e3d4a5b6c7d-KEF"}"#,
        );
        assert_eq!(
            error,
            ApiError::Refused {
                status: 401,
                code: "unauthorized".into(),
                request_id: Some("8c1f2e3d4a5b6c7d-KEF".into()),
            }
        );
        assert_eq!(error.code(), Some("unauthorized"));
        assert_eq!(error.request_id(), Some("8c1f2e3d4a5b6c7d-KEF"));
    }

    #[test]
    fn a_refusal_from_an_older_server_or_outside_the_contract_has_none() {
        let older = refusal(404, r#"{"error":"not_found"}"#);
        assert_eq!(older.code(), Some("not_found"));
        assert_eq!(older.request_id(), None);
        let text = refusal(502, "Bad Gateway");
        assert_eq!(
            text,
            ApiError::Refused {
                status: 502,
                code: String::new(),
                request_id: None,
            }
        );
    }

    #[test]
    fn too_old_still_names_the_floor() {
        let error = refusal(
            426,
            r#"{"error":"client_too_old","minVersion":"0.3.0","requestId":"r"}"#,
        );
        assert_eq!(
            error,
            ApiError::ClientTooOld {
                min: "0.3.0".into()
            }
        );
        assert_eq!(error.request_id(), None);
    }

    /// Each social enum holds exactly the values the contract names, so a
    /// value the server adds stops this test rather than a page.
    #[test]
    fn the_social_enums_are_the_contracts() {
        fn names<T: Serialize>(values: &[T]) -> Vec<serde_json::Value> {
            values
                .iter()
                .map(|v| serde_json::to_value(v).unwrap())
                .collect()
        }
        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../../api/openapi.json")).unwrap();
        let schemas = &contract["components"]["schemas"];
        let listed = |pointer: &str| -> Vec<serde_json::Value> {
            let values = schemas
                .pointer(pointer)
                .unwrap_or_else(|| panic!("{pointer}"));
            values
                .as_array()
                .unwrap()
                .iter()
                .filter(|v| !v.is_null())
                .cloned()
                .collect()
        };
        use ModerationAction as M;
        let actions = [
            M::HidePost,
            M::RemovePost,
            M::RestorePost,
            M::HideComment,
            M::RemoveComment,
            M::RestoreComment,
            M::MuteMember,
            M::UnmuteMember,
            M::RemoveMember,
            M::BanMember,
            M::UnbanMember,
        ];
        let reactions = [
            ReactionKind::Like,
            ReactionKind::Love,
            ReactionKind::Laugh,
            ReactionKind::Wow,
            ReactionKind::Sad,
        ];
        let notifications: Vec<_> = listed("/Notification/properties/kind/enum");
        let notification = |text: &serde_json::Value| {
            serde_json::from_value::<NotificationKind>(text.clone()).is_ok()
        };
        assert_eq!(notifications.len(), 4);
        assert!(notifications.iter().all(notification));
        assert_eq!(
            listed("/Community/properties/audience/enum"),
            names(&[Audience::Open, Audience::Private])
        );
        assert_eq!(
            listed("/Post/properties/myReaction/enum"),
            names(&reactions)
        );
        assert_eq!(
            listed("/ReportTarget/properties/kind/enum"),
            names(&[
                TargetKind::Post,
                TargetKind::Comment,
                TargetKind::Community,
                TargetKind::Account
            ])
        );
        assert_eq!(
            listed("/Ref/properties/kind/enum"),
            names(&[RefKind::Post, RefKind::Comment, RefKind::Community])
        );
        assert_eq!(
            listed("/Report/properties/reason/enum"),
            names(&[
                ReportReason::Unlawful,
                ReportReason::Harassment,
                ReportReason::Spam,
                ReportReason::Other
            ])
        );
        let moderate = &contract["paths"]["/v1/communities/{communityId}/actions"]["post"];
        let body = &moderate["requestBody"]["content"]["application/json"]["schema"];
        assert_eq!(
            body["properties"]["action"]["enum"],
            serde_json::json!(names(&actions))
        );
    }

    /// Every platform the contract names, `api/openapi.json` being generated
    /// from the backend's one list (backend/src/platforms.ts). The core keeps
    /// its own enum because the apps pass it over the FFI.
    #[test]
    fn the_platforms_are_the_contracts() {
        fn enums(value: &serde_json::Value, found: &mut Vec<Vec<String>>) {
            match value {
                serde_json::Value::Object(map) => {
                    if let Some(names) = map.get("platform").and_then(|p| p.get("enum")) {
                        found.push(serde_json::from_value(names.clone()).unwrap());
                    }
                    map.values().for_each(|v| enums(v, found));
                }
                serde_json::Value::Array(items) => items.iter().for_each(|v| enums(v, found)),
                _ => {}
            }
        }
        let contract = include_str!("../../../api/openapi.json");
        let mut found = Vec::new();
        enums(&serde_json::from_str(contract).unwrap(), &mut found);
        assert!(!found.is_empty(), "the contract names no platform");

        // A new variant stops this match compiling, the reminder to list it here.
        let name = |platform: Platform| match platform {
            Platform::Android | Platform::Ios => serde_json::to_value(platform).unwrap(),
        };
        let core: Vec<_> = [Platform::Android, Platform::Ios].map(name).to_vec();
        for names in found {
            assert_eq!(
                serde_json::to_value(&names).unwrap(),
                serde_json::Value::from(core.clone())
            );
        }
    }
}
