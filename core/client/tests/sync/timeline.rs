use std::sync::Arc;

use crate::common::{conversation, items, shown, with_a_sibling};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{Content, Status};
use spjall_envelope::Body;

#[test]
fn the_timeline_shows_each_message_as_it_now_is() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    let first = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "fyrst".into(),
                forwarded: false,
            },
        )
        .unwrap();
    let second = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "annað".into(),
                forwarded: false,
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    for body in [
        Body::Reply {
            to: first.clone(),
            text: "svar".into(),
        },
        Body::Reaction {
            target: first.clone(),
            emoji: "👍".into(),
            remove: false,
        },
        // Only a sender edits or deletes its own.
        Body::Edit {
            target: first.clone(),
            text: "b breytti".into(),
        },
        Body::Delete {
            target: second.clone(),
        },
    ] {
        b1.client.send(&conversation, body).unwrap();
    }
    b1.sync();
    a1.deliver();
    for body in [
        Body::Edit {
            target: first.clone(),
            text: "fyrst, lagað".into(),
        },
        Body::Delete {
            target: second.clone(),
        },
        Body::Reaction {
            target: first.clone(),
            emoji: "👍".into(),
            remove: false,
        },
    ] {
        a1.client.send(&conversation, body).unwrap();
    }
    a1.sync();
    b1.deliver();

    // The commit that made the conversation is no card: it starts with the
    // people it was made for (#68).
    assert!(
        !items(&mut a1, &conversation)
            .iter()
            .any(|i| matches!(i.content, Content::Members { .. }))
    );
    for phone in [&mut a1, &mut b1] {
        let mut items = items(phone, &conversation);
        items.retain(|i| i.envelope_id.is_some());
        assert_eq!(
            shown(&items),
            vec![Some("fyrst, lagað".into()), None, Some("svar".into())]
        );
        assert!(items[0].edited);
        assert_eq!(items[1].content, Content::Deleted);
        let Content::Text {
            reply_to: Some(quote),
            ..
        } = &items[2].content
        else {
            panic!("{:?}", items[2]);
        };
        assert_eq!(quote.text.as_deref(), Some("fyrst, lagað"));
        assert_eq!(quote.sender.as_ref().unwrap().account, "a");
        let reactions = &items[0].reactions;
        assert_eq!(reactions.len(), 1);
        assert_eq!(reactions[0].emoji, "👍");
        assert_eq!(reactions[0].people.len(), 2);
        assert!(reactions[0].own);
        assert!(items.iter().all(|i| i.status == Status::Sent));
    }
}

/// Reacts as `phone` to the message `target`.
fn react(phone: &mut Phone, conversation: &str, target: &str, emoji: &str, remove: bool) {
    phone
        .client
        .send(
            conversation,
            Body::Reaction {
                target: target.into(),
                emoji: emoji.into(),
                remove,
            },
        )
        .unwrap();
}

/// What each reaction on the newest item reads as: emoji and who.
fn reactions_of(phone: &mut Phone, conversation: &str) -> Vec<(String, Vec<String>, bool)> {
    items(phone, conversation)
        .pop()
        .unwrap()
        .reactions
        .into_iter()
        .map(|r| {
            (
                r.emoji,
                r.people.into_iter().map(|p| p.account).collect(),
                r.own,
            )
        })
        .collect()
}

/// One message from `b`, delivered to `a1`, with its envelope id.
fn one_message() -> (Arc<Relay>, Phone, Phone, String, String) {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let chat = conversation(&mut a1, &mut b1);
    b1.send(&chat, "hæ");
    b1.sync();
    a1.deliver();
    let id = items(&mut a1, &chat).pop().unwrap().envelope_id.unwrap();
    (relay, a1, b1, chat, id)
}

#[test]
fn a_new_reaction_replaces_the_earlier_one_on_every_device() {
    let relay = Relay::new();
    let (mut a1, mut a2, mut b1, chat) = with_a_sibling(&relay);
    b1.send(&chat, "hæ");
    b1.sync();
    a1.deliver();
    a2.deliver();
    let id = items(&mut a1, &chat).pop().unwrap().envelope_id.unwrap();
    react(&mut a1, &chat, &id, "👍", false);
    a1.sync();
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    b1.deliver();
    a2.deliver();
    for phone in [&mut a1, &mut b1, &mut a2] {
        let own = phone.account == "a";
        assert_eq!(
            reactions_of(phone, &chat),
            vec![("❤️".to_string(), vec!["a".to_string()], own)]
        );
    }
}

#[test]
fn a_replacing_reaction_shows_at_once_before_any_sync() {
    let (_relay, mut a1, _b1, chat, id) = one_message();
    react(&mut a1, &chat, &id, "👍", false);
    react(&mut a1, &chat, &id, "❤️", false);
    assert_eq!(
        reactions_of(&mut a1, &chat),
        vec![("❤️".to_string(), vec!["a".to_string()], true)]
    );
    // Another person's reaction on the same message is left alone.
    a1.sync();
    assert_eq!(reactions_of(&mut a1, &chat).len(), 1);
}

#[test]
fn a_replacing_reaction_queues_the_old_one_taken_back_first() {
    let (relay, mut a1, _b1, chat, id) = one_message();
    let stored = relay.stored(&chat);
    // Nothing shown yet: the add goes alone.
    react(&mut a1, &chat, &id, "👍", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 1);
    // Shown from the fold: a take-back and the add.
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3);
    // Still queued, not folded: the queued add is replaced too.
    react(&mut a1, &chat, &id, "😂", false);
    react(&mut a1, &chat, &id, "🎉", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3 + 2 + 2);
    // The same emoji again adds only itself.
    react(&mut a1, &chat, &id, "🎉", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3 + 2 + 2 + 1);
}

#[test]
fn taking_back_the_current_reaction_leaves_none() {
    let (_relay, mut a1, mut b1, chat, id) = one_message();
    react(&mut a1, &chat, &id, "👍", false);
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    b1.deliver();
    react(&mut a1, &chat, &id, "❤️", true);
    assert!(reactions_of(&mut a1, &chat).is_empty());
    a1.sync();
    b1.deliver();
    assert!(reactions_of(&mut a1, &chat).is_empty());
    assert!(reactions_of(&mut b1, &chat).is_empty());
}
