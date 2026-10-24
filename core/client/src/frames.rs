//! Per-screen image framing (decision 0086). A picture or a cover is stored as
//! a master, and each frame is cut from it by the server. The person sets a
//! focal point, and any frame set by hand has a rectangle of its own; this
//! module places the frames the same way the Worker does
//! (`backend/src/api/image-frames.ts`), and both run `api/frames.vectors.json`,
//! so a preview in an app shows the crop the server will cut.
//!
//! Pure: no I/O, no clock. The frame sizes below are held equal to the ones
//! `api/openapi.json` publishes as `x-frame-specs` by `tooling/frames-check.mjs`,
//! which reads the constants as written, so keep each on the one-line form.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A frame's stored size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameSize {
    pub w: u32,
    pub h: u32,
}

/// A cover on a window below 600 (3:1).
pub const COVER_COMPACT: FrameSize = FrameSize { w: 1200, h: 400 };
/// A cover on a window from 600 to below 840 (4:1).
pub const COVER_MEDIUM: FrameSize = FrameSize { w: 1600, h: 400 };
/// A cover on a window from 840 (8:3), the shape an app from before 0086 knows.
pub const COVER_EXPANDED: FrameSize = FrameSize { w: 1600, h: 600 };
/// A profile photo and a community picture.
pub const PHOTO_SQUARE: FrameSize = FrameSize { w: 512, h: 512 };

/// The width, in dp, pt or CSS px, from which a window is medium.
pub const MEDIUM_FROM: u32 = 600;
/// The width from which a window is expanded.
pub const EXPANDED_FROM: u32 = 840;

/// What an image is: a community's cover, or a picture (an account's photo or
/// a community's picture).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    Cover,
    Photo,
}

/// One frame of an image, named as the API names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Frame {
    Compact,
    Medium,
    Expanded,
    Square,
}

impl Frame {
    /// The name in the API and in a `?frame=` query.
    pub fn name(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Medium => "medium",
            Self::Expanded => "expanded",
            Self::Square => "square",
        }
    }

    /// The frame called `name`, none for a name no frame has.
    pub fn from_name(name: &str) -> Option<Self> {
        [Self::Compact, Self::Medium, Self::Expanded, Self::Square]
            .into_iter()
            .find(|f| f.name() == name)
    }
}

impl FrameKind {
    /// The frames of this kind, with the size each is stored at.
    pub fn specs(self) -> &'static [(Frame, FrameSize)] {
        match self {
            Self::Cover => &[
                (Frame::Compact, COVER_COMPACT),
                (Frame::Medium, COVER_MEDIUM),
                (Frame::Expanded, COVER_EXPANDED),
            ],
            Self::Photo => &[(Frame::Square, PHOTO_SQUARE)],
        }
    }

    /// The stored size of `frame`, none when this kind has no such frame.
    pub fn size(self, frame: Frame) -> Option<FrameSize> {
        self.specs().iter().find(|(f, _)| *f == frame).map(|(_, s)| *s)
    }
}

/// The frame a window `width_dp` wide shows (0086): a cover follows the size
/// classes, compact below 600, medium from 600 to below 840, expanded from
/// 840; a picture has one square.
pub fn frame_for_width(kind: FrameKind, width_dp: u32) -> Frame {
    match kind {
        FrameKind::Photo => Frame::Square,
        FrameKind::Cover if width_dp < MEDIUM_FROM => Frame::Compact,
        FrameKind::Cover if width_dp < EXPANDED_FROM => Frame::Medium,
        FrameKind::Cover => Frame::Expanded,
    }
}

/// The point of the image to keep in view, as fractions of its width and
/// height.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Focus {
    pub x: f64,
    pub y: f64,
}

/// A rectangle of the image as fractions of its width and height.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FrameRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A rectangle of the master in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// The smallest side of an override, as a fraction of the image (as the API).
const MIN_SIDE: f64 = 0.001;

/// How an image is framed: the focus every frame is placed from, and a
/// rectangle for each frame the person set by hand, which wins over the
/// focus. The JSON is the API's `Framing`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Framing {
    pub focus: Focus,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub overrides: BTreeMap<Frame, FrameRect>,
}

impl Framing {
    /// The centred framing an upload starts with.
    pub fn centred() -> Self {
        Self { focus: Focus { x: 0.5, y: 0.5 }, overrides: BTreeMap::new() }
    }

    /// Whether the server would take it for `kind`: every fraction in range,
    /// every override inside the image and on a frame `kind` has.
    pub fn fits(&self, kind: FrameKind) -> bool {
        let unit = |v: f64| (0.0..=1.0).contains(&v);
        unit(self.focus.x)
            && unit(self.focus.y)
            && self.overrides.iter().all(|(frame, r)| {
                kind.size(*frame).is_some()
                    && unit(r.x)
                    && unit(r.y)
                    && (MIN_SIDE..=1.0).contains(&r.w)
                    && (MIN_SIDE..=1.0).contains(&r.h)
                    && r.x + r.w <= 1.0
                    && r.y + r.h <= 1.0
            })
    }
}

/// Round half up, which for the non-negative values here is `f64::round`.
fn round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A side in pixels: rounded, at least 1 and at most `max`.
fn side(exact: f64, max: u32) -> u32 {
    (round(exact).max(1.0) as u32).min(max)
}

/// A position in pixels: floored, then moved inside the image.
fn position(exact: f64, room: u32) -> u32 {
    (exact.floor().max(0.0) as u32).min(room)
}

/// The largest rectangle of aspect `aspect_w`:`aspect_h` that fits the image,
/// centred on `focus` and moved inside the image where it would cross an edge.
/// w and h are rounded half up and kept within 1 and the image; x and y are
/// floored, then clamped to `image - size`.
pub fn place_frame(
    image_w: u32,
    image_h: u32,
    aspect_w: u32,
    aspect_h: u32,
    focus: Focus,
) -> PixelRect {
    let (iw, ih) = (f64::from(image_w), f64::from(image_h));
    let (aw, ah) = (f64::from(aspect_w), f64::from(aspect_h));
    let wide = iw * ah >= ih * aw;
    let exact_w = if wide { ih * aw / ah } else { iw };
    let exact_h = if wide { ih } else { iw * ah / aw };
    let w = side(exact_w, image_w);
    let h = side(exact_h, image_h);
    PixelRect {
        x: position(focus.x * iw - exact_w / 2.0, image_w - w),
        y: position(focus.y * ih - exact_h / 2.0, image_h - h),
        w,
        h,
    }
}

/// A rectangle of fractions as pixels: w and h rounded (at least 1), x and y
/// floored, then moved inside the image as `place_frame` does.
pub fn override_rect(image_w: u32, image_h: u32, rect: FrameRect) -> PixelRect {
    let w = side(rect.w * f64::from(image_w), image_w);
    let h = side(rect.h * f64::from(image_h), image_h);
    PixelRect {
        x: position(rect.x * f64::from(image_w), image_w - w),
        y: position(rect.y * f64::from(image_h), image_h - h),
        w,
        h,
    }
}

/// The pixel rectangle of each frame of `kind` in an image `image_w` by
/// `image_h`: a frame with an override takes it, the others are placed from
/// the focus.
pub fn frames_for(
    kind: FrameKind,
    image_w: u32,
    image_h: u32,
    framing: &Framing,
) -> Vec<(Frame, PixelRect)> {
    kind.specs()
        .iter()
        .map(|(frame, size)| {
            let rect = match framing.overrides.get(frame) {
                Some(r) => override_rect(image_w, image_h, *r),
                None => place_frame(image_w, image_h, size.w, size.h, framing.focus),
            };
            (*frame, rect)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_classes_break_at_600_and_840() {
        let at = |w| frame_for_width(FrameKind::Cover, w);
        assert_eq!(at(0), Frame::Compact);
        assert_eq!(at(599), Frame::Compact);
        assert_eq!(at(600), Frame::Medium);
        assert_eq!(at(839), Frame::Medium);
        assert_eq!(at(840), Frame::Expanded);
        assert_eq!(frame_for_width(FrameKind::Photo, 1200), Frame::Square);
    }

    #[test]
    fn framing_json_is_the_apis() {
        let json = r#"{"focus":{"x":0.25,"y":0.5},"overrides":{"compact":{"x":0.1,"y":0.2,"w":0.5,"h":0.25}}}"#;
        let framing: Framing = serde_json::from_str(json).unwrap();
        assert_eq!(framing.overrides[&Frame::Compact].w, 0.5);
        assert_eq!(serde_json::to_string(&framing).unwrap(), json);
        let bare: Framing = serde_json::from_str(r#"{"focus":{"x":0,"y":1}}"#).unwrap();
        assert_eq!(serde_json::to_string(&bare).unwrap(), r#"{"focus":{"x":0.0,"y":1.0}}"#);
    }

    #[test]
    fn fits_refuses_what_the_server_would() {
        let mut framing = Framing::centred();
        assert!(framing.fits(FrameKind::Cover));
        framing.focus.x = 1.5;
        assert!(!framing.fits(FrameKind::Cover));
        let mut framing = Framing::centred();
        framing.overrides.insert(Frame::Compact, FrameRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
        assert!(framing.fits(FrameKind::Cover));
        assert!(!framing.fits(FrameKind::Photo), "a picture has no compact frame");
        framing.overrides.insert(Frame::Medium, FrameRect { x: 0.6, y: 0.0, w: 0.5, h: 0.5 });
        assert!(!framing.fits(FrameKind::Cover), "leaves the image");
    }

    #[test]
    fn frames_for_uses_overrides_and_the_focus() {
        let mut framing = Framing::centred();
        framing.overrides.insert(Frame::Compact, FrameRect { x: 0.0, y: 0.0, w: 0.5, h: 0.5 });
        let frames = frames_for(FrameKind::Cover, 4000, 3000, &framing);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0], (Frame::Compact, PixelRect { x: 0, y: 0, w: 2000, h: 1500 }));
        assert_eq!(frames[2], (Frame::Expanded, PixelRect { x: 0, y: 750, w: 4000, h: 1500 }));
    }
}
