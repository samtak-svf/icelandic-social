//! The sync engine against the in-memory relay: devices with their own store
//! files, talking only through requests and socket frames. One module per
//! scenario family; `phone` is the simulated device, `common` the helpers
//! more than one family uses.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "../support/relay.rs"]
#[allow(dead_code)]
mod relay;

mod basics;
mod blocks;
mod common;
mod forward;
mod group_names;
mod group_photo;
mod history_sync;
mod joins;
mod link_approval;
mod location;
mod media;
mod mute;
mod people;
mod phone;
mod photos;
mod push;
mod revocation;
mod timeline;
mod times;
mod unread;
