//! The directory of people (0036): every other signed-in account, found by
//! name for a new conversation. Each page comes from the server, and the
//! names it gives are kept as profiles, so a conversation started from it
//! shows them at once. The conversation list is searched here too, by the
//! same fold and the same word-start rule as the server's (0038).

use crate::api::{Profile, Transport};
use crate::members::{Person, store_profile};
use crate::{Client, ClientError, Conversation, authed};

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

/// A name as a search compares it (0036): lower case, with the Icelandic
/// letters folded to the plain ones a keyboard without them types (ð d,
/// þ th, æ ae, ö o, accents dropped). The server folds a search and its
/// `name_key` column the same way; `api/fold-vectors.json` holds the three
/// together.
pub fn fold_name(text: &str) -> String {
    let mut key = String::with_capacity(text.len());
    for c in text.to_lowercase().chars() {
        match c {
            'á' => key.push('a'),
            'ð' => key.push('d'),
            'é' => key.push('e'),
            'í' => key.push('i'),
            'ó' | 'ö' => key.push('o'),
            'ú' => key.push('u'),
            'ý' => key.push('y'),
            'þ' => key.push_str("th"),
            'æ' => key.push_str("ae"),
            c => key.push(c),
        }
    }
    key
}

/// Whether a folded search starts the folded name or a word in it, a word
/// being what follows a space or a hyphen (0038).
fn starts_a_word(name: &str, search: &str) -> bool {
    name.starts_with(search)
        || name.contains(&format!(" {search}"))
        || name.contains(&format!("-{search}"))
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

impl<T: Transport> Client<T> {
    /// The conversations whose title, the names of the others in it, has a
    /// name matching `search` at the start of a word (0038), in the order
    /// of `conversations`. Read from this device alone, never the server; a
    /// blank search keeps every conversation.
    pub fn search_conversations(&mut self, search: &str) -> Result<Vec<Conversation>, ClientError> {
        let Some(search) = query(Some(search))?.map(fold_name) else {
            return self.conversations();
        };
        Ok(self
            .conversations()?
            .into_iter()
            .filter(|c| {
                c.members.iter().any(|p| {
                    p.name
                        .as_deref()
                        .is_some_and(|name| starts_a_word(&fold_name(name), &search))
                })
            })
            .collect())
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

    /// The rule of 0038, row by row: a hit in the middle of a word is the
    /// substring match it replaced.
    #[test]
    fn a_search_matches_the_start_of_a_word_only() {
        for (name, search, hit) in [
            ("Þórdís Ýr Ævarsdóttir", "thor", true),
            ("Þórdís Ýr Ævarsdóttir", "yr", true),
            ("Þórdís Ýr Ævarsdóttir", "aevars", true),
            ("Þórdís Ýr Ævarsdóttir", "ÆVARS", true),
            ("Þórdís Ýr Ævarsdóttir", "dis", false),
            ("Þórdís Ýr Ævarsdóttir", "dottir", false),
            ("Sóley Bergs-Guðnadóttir", "gudna", true),
            ("Sóley Bergs-Guðnadóttir", "guðna", true),
            ("Sóley Bergs-Guðnadóttir", "nadottir", false),
            ("Sóley Bergs-Guðnadóttir", "soley bergs", true),
        ] {
            assert_eq!(
                starts_a_word(&fold_name(name), &fold_name(search)),
                hit,
                "{search} in {name}"
            );
        }
    }
}
