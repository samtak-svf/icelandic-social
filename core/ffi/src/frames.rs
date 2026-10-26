//! Per-screen image framing (decision 0086) as the apps see it: the frame
//! types, the placing rule the editor previews with, and the choice of a
//! cover's frame by window width. The server cuts the frames; these only
//! show the person the crop it will make, by the rule both run the shared
//! vectors against.

use spjall_client::frames as core;
pub use spjall_client::frames::Frame;
pub use spjall_client::frames::PixelRect;

/// What an image is framed as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FrameKind {
    /// A community's cover: three frames, one for each window size class.
    Cover,
    /// An account's photo or a community's picture: one square.
    Photo,
}

/// One frame of an image.
#[uniffi::remote(Enum)]
pub enum Frame {
    /// A cover on a window below 600 dp, 3:1 (1200 by 400).
    Compact,
    /// A cover on a window from 600 dp to below 840 dp, 4:1 (1600 by 400).
    Medium,
    /// A cover on a window from 840 dp, 8:3 (1600 by 600): the shape an app
    /// from before 0086 shows.
    Expanded,
    /// A photo or a picture, 1:1 (512 by 512).
    Square,
}

/// The point of the image to keep in view, as fractions of its width and
/// height, each from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct Focus {
    pub x: f64,
    pub y: f64,
}

impl From<Focus> for core::Focus {
    fn from(focus: Focus) -> Self {
        let Focus { x, y } = focus;

        Self { x, y }
    }
}

impl From<core::Focus> for Focus {
    fn from(focus: core::Focus) -> Self {
        let core::Focus { x, y } = focus;

        Self { x, y }
    }
}

/// A rectangle of the image as fractions of its width and height.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FrameRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl From<FrameRect> for core::FrameRect {
    fn from(r: FrameRect) -> Self {
        let FrameRect { x, y, w, h } = r;

        Self { x, y, w, h }
    }
}

impl From<core::FrameRect> for FrameRect {
    fn from(r: core::FrameRect) -> Self {
        let core::FrameRect { x, y, w, h } = r;

        Self { x, y, w, h }
    }
}

// The fractions come from JSON or a gesture, never NaN, so equality is
// reflexive and the records that hold them keep their `Eq`.
impl Eq for Focus {}
impl Eq for FrameRect {}

/// A rectangle of an image in pixels.
#[uniffi::remote(Record)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// A frame the person set by hand: its rectangle wins over the focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct FrameOverride {
    pub frame: Frame,
    pub rect: FrameRect,
}

/// How an image is framed: the focus every frame is placed from, and a
/// rectangle for each frame adjusted on its own (covers only).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Framing {
    pub focus: Focus,
    #[uniffi(default = [])]
    pub overrides: Vec<FrameOverride>,
}

/// The size a frame is stored at, in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct FrameSize {
    pub w: u32,
    pub h: u32,
}

/// Where a frame falls in the master, for a preview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct PlacedFrame {
    pub frame: Frame,
    pub rect: PixelRect,
}

impl From<FrameKind> for core::FrameKind {
    fn from(kind: FrameKind) -> Self {
        match kind {
            FrameKind::Cover => Self::Cover,
            FrameKind::Photo => Self::Photo,
        }
    }
}

impl From<Framing> for core::Framing {
    /// A frame named twice keeps the last rectangle.
    fn from(framing: Framing) -> Self {
        let Framing { focus, overrides } = framing;

        Self {
            focus: focus.into(),
            overrides: overrides
                .into_iter()
                .map(|FrameOverride { frame, rect }| (frame, rect.into()))
                .collect(),
        }
    }
}

impl From<core::Framing> for Framing {
    fn from(framing: core::Framing) -> Self {
        let core::Framing { focus, overrides } = framing;

        Self {
            focus: focus.into(),
            overrides: overrides
                .into_iter()
                .map(|(frame, rect)| FrameOverride {
                    frame,
                    rect: rect.into(),
                })
                .collect(),
        }
    }
}

/// The frame a window `width_dp` wide shows (0086): a cover follows the
/// size classes, `Compact` below 600, `Medium` from 600 to below 840,
/// `Expanded` from 840; a photo or picture is always `Square`. Pass dp on
/// Android, points on iOS and CSS pixels on the web.
#[uniffi::export]
pub fn frame_for_width(kind: FrameKind, width_dp: u32) -> Frame {
    core::frame_for_width(kind.into(), width_dp)
}

/// The size `frame` is stored at, none when `kind` has no such frame. Its
/// aspect is the shape the crop sheet shows.
#[uniffi::export]
pub fn frame_size(kind: FrameKind, frame: Frame) -> Option<FrameSize> {
    core::FrameKind::from(kind)
        .size(frame)
        .map(|s| FrameSize { w: s.w, h: s.h })
}

/// The frames `kind` has, in size-class order.
#[uniffi::export]
pub fn frames_of(kind: FrameKind) -> Vec<Frame> {
    core::FrameKind::from(kind)
        .specs()
        .iter()
        .map(|(frame, _)| *frame)
        .collect()
}

/// The largest rectangle of aspect `aspect_w`:`aspect_h` in an image
/// `image_w` by `image_h`, centred on `focus` and moved inside the image;
/// the crop a frame without an override gets.
#[uniffi::export]
pub fn place_frame(
    image_w: u32,
    image_h: u32,
    aspect_w: u32,
    aspect_h: u32,
    focus: Focus,
) -> PixelRect {
    core::place_frame(image_w, image_h, aspect_w, aspect_h, focus.into())
}

/// A rectangle of fractions as pixels of an image, moved inside it.
#[uniffi::export]
pub fn override_rect(image_w: u32, image_h: u32, rect: FrameRect) -> PixelRect {
    core::override_rect(image_w, image_h, rect.into())
}

/// Where each frame of `kind` falls in an image `image_w` by `image_h` under
/// `framing`: the editor's previews, which show what the server will cut.
#[uniffi::export]
pub fn frames_for(
    kind: FrameKind,
    image_w: u32,
    image_h: u32,
    framing: Framing,
) -> Vec<PlacedFrame> {
    core::frames_for(kind.into(), image_w, image_h, &framing.into())
        .into_iter()
        .map(|(frame, rect)| PlacedFrame { frame, rect })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_exports_agree_with_the_core() {
        assert_eq!(frame_for_width(FrameKind::Cover, 599), Frame::Compact);
        assert_eq!(frame_for_width(FrameKind::Cover, 840), Frame::Expanded);
        assert_eq!(frame_for_width(FrameKind::Photo, 840), Frame::Square);
        assert_eq!(frames_of(FrameKind::Cover).len(), 3);
        assert_eq!(
            frame_size(FrameKind::Cover, Frame::Medium),
            Some(FrameSize { w: 1600, h: 400 })
        );
        assert_eq!(frame_size(FrameKind::Photo, Frame::Medium), None);
        let framing = Framing {
            focus: Focus { x: 0.5, y: 0.5 },
            overrides: vec![FrameOverride {
                frame: Frame::Compact,
                rect: FrameRect {
                    x: 0.0,
                    y: 0.0,
                    w: 0.5,
                    h: 0.5,
                },
            }],
        };
        let placed = frames_for(FrameKind::Cover, 4000, 3000, framing.clone());
        assert_eq!(
            placed[0].rect,
            PixelRect {
                x: 0,
                y: 0,
                w: 2000,
                h: 1500
            }
        );
        assert_eq!(
            placed[2].rect,
            PixelRect {
                x: 0,
                y: 750,
                w: 4000,
                h: 1500
            }
        );
        assert_eq!(Framing::from(core::Framing::from(framing.clone())), framing);
    }
}
