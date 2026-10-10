//! The directory of people (0036): every other signed-in account, found by
//! name for a new conversation. Each page comes from the server, and the
//! names it gives are kept as profiles, so a conversation started from it
//! shows them at once.

use crate::api::{Profile, Transport};
use crate::members::{Person, store_profile};
use crate::{Client, ClientError, authed};

/// The most characters a search holds, counted as the server counts them:
/// UTF-16 code units.
pub const MAX_QUERY: usize = 100;

/// The most a page holds; the server refuses more.
const MAX_PAGE: u32 = 50;

/// A page of the directory, verified first, then by name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directory {
    pub people: Vec<Person>,
    /// The `after` of the next page, none on the last.
    pub next: Option<String>,
}

/// A search the server takes: trimmed, none when blank.
fn query(text: Option<&str>) -> Result<Option<&str>, ClientError> {
    let Some(text) = text.map(str::trim).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    if text.encode_utf16().count() > MAX_QUERY {
        return Err(ClientError::Invalid("a search over 100 characters"));
    }
    Ok(Some(text))
}

impl<T: Transport> Client<T> {
    /// A page of the directory; `after` is the `next` of the page before
    /// it, and `search` keeps the names that contain it.
    pub fn directory(
        &mut self,
        search: Option<&str>,
        after: Option<&str>,
        size: u32,
    ) -> Result<Directory, ClientError> {
        let search = query(search)?;
        let page = authed(&self.transport, &self.token, &self.client)?.people(
            search,
            after,
            size.clamp(1, MAX_PAGE),
        )?;
        let people: Vec<Person> = page
            .people
            .into_iter()
            .map(|p| Person {
                account: p.account_id,
                name: p.name,
                verified: p.verified,
            })
            .collect();
        self.store.try_write(|tx| {
            for person in &people {
                let profile = Profile {
                    name: person.name.clone(),
                    verified: person.verified,
                };
                store_profile(tx, &person.account, Some(&profile))?;
            }
            Ok::<_, ClientError>(())
        })?;
        Ok(Directory {
            people,
            next: page.next,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_search_is_trimmed_and_bounded() {
        assert_eq!(query(None).unwrap(), None);
        assert_eq!(query(Some("  ")).unwrap(), None);
        assert_eq!(query(Some(" Guðrún ")).unwrap(), Some("Guðrún"));
        assert!(query(Some(&"þ".repeat(MAX_QUERY))).is_ok());
        assert!(matches!(
            query(Some(&"þ".repeat(MAX_QUERY + 1))),
            Err(ClientError::Invalid(_))
        ));
    }
}
