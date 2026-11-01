//! The home feed and where its composer posts (0116): the own wall by default,
//! or a community picked from those that take this account's posts.

use std::path::Path;

use super::{id, search};
use crate::api::{Community, HomePage, Post, SocialMedia, Transport, WallAudience};
use crate::clock::now;
use crate::{Client, ClientError, Hosted};

/// The largest page of the home feed the server takes.
const MAX_HOME_PAGE: u32 = crate::text::limits::HOME_PAGE;

/// Where a post goes (0116). The audience belongs to the wall, the anonymous
/// choice to a community (0091): a wall has none (0115).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostTarget {
    Wall {
        audience: WallAudience,
    },
    Community {
        community_id: String,
        anonymous: bool,
    },
}

impl Default for PostTarget {
    /// The composer starts on the own wall, for friends (0115, 0116).
    fn default() -> Self {
        Self::Wall {
            audience: WallAudience::Friends,
        }
    }
}

/// Whether the composer offers `community` at `now`, as the community's own
/// page does: a member, not muted, and a community that takes new posts. The
/// server still decides.
fn takes_posts(community: &Community, now: u64) -> bool {
    community.role.is_some()
        && !community.read_only
        && community.deleted_at.is_none()
        && community.muted_until.is_none_or(|until| until <= now)
}

/// The home feed.
impl<T: Transport> Hosted<T> {
    /// A page of the home feed, newest first; `before` is the `next` of the
    /// page before. At most 30 a page.
    pub fn home(&self, before: Option<&str>, size: u32) -> Result<HomePage, ClientError> {
        let size = size.clamp(1, MAX_HOME_PAGE);
        Ok(self.api()?.home(search(before), size)?)
    }

    /// The communities a composer may offer beside the own wall.
    pub fn post_communities(&self) -> Result<Vec<Community>, ClientError> {
        let at = u64::try_from(now()).unwrap_or(0);
        let mut mine = self.my_communities()?;
        mine.retain(|community| takes_posts(community, at));
        Ok(mine)
    }

    /// Posts to `target`: what `create_wall_post` and `create_post_with` check,
    /// by where it goes.
    pub fn post_to(
        &self,
        target: &PostTarget,
        body: &str,
        media: &[String],
        poll: Option<&[String]>,
    ) -> Result<Post, ClientError> {
        match target {
            PostTarget::Wall { audience } => self.create_wall_post(body, media, poll, *audience),
            PostTarget::Community {
                community_id,
                anonymous,
            } => self.create_post_with(community_id, body, media, *anonymous, poll),
        }
    }
}

impl<T: Transport> Client<T> {
    /// Uploads the image at `path` for a post to `target`.
    pub fn upload_post_media(
        &self,
        target: &PostTarget,
        path: &Path,
    ) -> Result<SocialMedia, ClientError> {
        match target {
            PostTarget::Wall { .. } => self.upload_wall_media(path),
            PostTarget::Community { community_id, .. } => {
                id(community_id, "community id")?;
                self.upload_social_media(community_id, path)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn community(json: serde_json::Value) -> Community {
        let mut fields = serde_json::json!({
            "communityId": "cm_1", "name": "n", "description": "", "audience": "open",
            "role": "member", "memberCount": 1, "createdAt": 1, "joinRequested": false,
            "invited": false, "mutedUntil": null, "readOnly": false, "deletedAt": null,
        });
        for (key, value) in json.as_object().unwrap() {
            fields[key] = value.clone();
        }
        serde_json::from_value(fields).unwrap()
    }

    /// The picker offers what the community's own page lets this account post to.
    #[test]
    fn only_a_community_that_takes_posts_is_offered() {
        assert!(takes_posts(&community(serde_json::json!({})), 100));
        for refused in [
            serde_json::json!({ "role": null }),
            serde_json::json!({ "readOnly": true }),
            serde_json::json!({ "deletedAt": 5 }),
            serde_json::json!({ "mutedUntil": 101 }),
        ] {
            assert!(!takes_posts(&community(refused.clone()), 100), "{refused}");
        }
        let lapsed = community(serde_json::json!({ "mutedUntil": 100 }));
        assert!(takes_posts(&lapsed, 100));
    }
}
