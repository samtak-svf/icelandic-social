//! A group's photo (0094), end-to-end encrypted like its name. The core
//! makes the picture itself: it decodes the file, crops a centred square,
//! scales it to `SIDE` px and encodes a new JPEG, so nothing of the
//! original's metadata (EXIF location, the camera) is ever copied, and the
//! server, which only sees the sealed blob, could not strip it. The blob is
//! sealed as media is (0023); `Body::Photo` carries its key inside MLS.
//!
//! This device keeps the decrypted picture in the media folder's
//! `group-photo/<id>.jpg`, one per conversation at most.

use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};

use spjall_envelope::{Body, PhotoRef};
use spjall_store::rusqlite::{self, params};

use crate::api::{Transport, base64, conversation_id, from_base64, group_id};
use crate::media::{MediaError, object_id, open, remove, seal};
use crate::{Client, ClientError, authed, is_group, open_conversation};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, Limits, RgbImage};

/// The picture's side, in px.
pub const SIDE: u32 = 512;
/// The most plaintext a group photo may be, in bytes; the server refuses
/// more than 1 MB of ciphertext (0094).
pub const MAX_BYTES: u64 = 900 * 1024;
/// The largest file `set_group_photo` reads, as for a profile photo (0039).
const MAX_SOURCE: u64 = crate::photo::MAX_PHOTO;
const QUALITY: u8 = 85;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum GroupPhotoError {
    /// Not a JPEG, PNG or WebP the core can read.
    #[error("the file is not a JPEG, PNG or WebP image")]
    Unsupported,
}

fn unsupported<E>(_: E) -> GroupPhotoError {
    GroupPhotoError::Unsupported
}

/// The JPEG of a group photo made from the bytes of a JPEG, PNG or WebP
/// file: oriented as the file says, cropped to a centred square, `SIDE` px
/// wide, with no metadata.
pub fn process(bytes: &[u8]) -> Result<Vec<u8>, GroupPhotoError> {
    let reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(unsupported)?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)
    ) {
        return Err(GroupPhotoError::Unsupported);
    }
    let mut decoder = reader.into_decoder().map_err(unsupported)?;
    // A small file can claim a huge canvas: bound what decoding may allocate.
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    decoder.set_limits(limits).map_err(unsupported)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(unsupported)?;
    image.apply_orientation(orientation);
    let (width, height) = (image.width(), image.height());
    let side = width.min(height);
    let square = image.crop_imm((width - side) / 2, (height - side) / 2, side, side);
    let scaled = square.resize_exact(SIDE, SIDE, FilterType::Lanczos3);
    let flat = flatten(&scaled);
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, QUALITY)
        .encode_image(&flat)
        .map_err(unsupported)?;
    Ok(out)
}

/// The pixels over white, so a transparent PNG does not turn black.
fn flatten(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let over = |c: u8| ((u16::from(c) * u16::from(a) + 255 * (255 - u16::from(a))) / 255) as u8;
        image::Rgb([over(r), over(g), over(b)])
    })
}

/// Reads at most `cap` bytes, `None` when there are more.
pub(crate) fn read_capped(mut reader: impl std::io::Read, cap: u64) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(cap + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= cap).then_some(bytes)
}

/// Where this device keeps the decrypted photo of `conversation`.
pub(crate) fn path_of(media: &Path, conversation: &str) -> PathBuf {
    media
        .join("group-photo")
        .join(format!("{conversation}.jpg"))
}

impl<T: Transport> Client<T> {
    /// Gives a group a photo (0094) from the JPEG, PNG or WebP file at
    /// `path`: the core makes the square JPEG, seals it as media is, uploads
    /// it and sends the `photo` message. Any member may. `NotAGroup` for a
    /// conversation of two; a file of another format is `GroupPhoto`.
    /// Returns the envelope's id.
    pub fn set_group_photo(
        &mut self,
        conversation: &str,
        path: &Path,
    ) -> Result<String, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.require_group(&group)?;
        let source = self.blobs.open_read(path).map_err(MediaError::from)?;
        let bytes = read_capped(source, MAX_SOURCE)
            .ok_or(ClientError::Invalid("the image is over 10 MB"))?;
        let jpeg = process(&bytes)?;
        let outgoing = self.media.join("out");
        self.blobs
            .create_dir_all(&outgoing)
            .map_err(MediaError::from)?;
        let id = object_id();
        let (plain, sealed) = (outgoing.join(format!("{id}.jpg")), outgoing.join(&id));
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).expect("the OS has randomness");
        let sent = (|| {
            let mut out = self.blobs.create_write(&plain).map_err(MediaError::from)?;
            out.write_all(&jpeg).map_err(MediaError::from)?;
            out.finish().map_err(MediaError::from)?;
            let (size, sha256) = seal(&*self.blobs, &plain, &sealed, &key)?;
            authed(&self.transport, &self.token, &self.client)?.put_group_photo(
                conversation,
                &id,
                &sealed,
            )?;
            // This device shows the picture it made without fetching it back.
            let kept = path_of(&self.media, conversation);
            if let Some(dir) = kept.parent() {
                self.blobs.create_dir_all(dir).map_err(MediaError::from)?;
            }
            self.blobs.copy(&plain, &kept).map_err(MediaError::from)?;
            Ok::<_, ClientError>(Body::Photo {
                photo: Some(PhotoRef {
                    id,
                    mime: "image/jpeg".into(),
                    size,
                    key: base64(&key),
                    sha256,
                }),
            })
        })();
        remove(&*self.blobs, &plain);
        remove(&*self.blobs, &sealed);
        self.send(conversation, sent?)
    }

    /// Takes a group's photo away (0094): the server deletes the object and
    /// every member is told. `NotAGroup` for a conversation of two.
    pub fn clear_group_photo(&mut self, conversation: &str) -> Result<String, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.require_group(&group)?;
        authed(&self.transport, &self.token, &self.client)?.delete_group_photo(conversation)?;
        self.send(conversation, Body::Photo { photo: None })
    }

    fn require_group(&mut self, group: &[u8]) -> Result<(), ClientError> {
        self.store.try_write(|tx| {
            open_conversation(tx, group)?;
            if !is_group(tx, group)? {
                return Err(ClientError::NotAGroup);
            }
            Ok(())
        })
    }

    /// Brings this device's copy of every group's photo in step with the
    /// folded state (0094): fetches and opens what is new, removes what was
    /// cleared. A photo that cannot be had now (offline, not yet on the
    /// server) is left for the next sync; one that does not match its
    /// message is dropped for good.
    pub(crate) fn fetch_group_photos(&mut self) -> Result<(), ClientError> {
        let due: Vec<(Vec<u8>, Option<String>)> = self.store.try_write(|tx| {
            let mut statement =
                tx.prepare("SELECT group_id, photo FROM conversations WHERE photo_ready = 2")?;
            let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()
        })?;
        for (group, photo) in due {
            let conversation = conversation_id(&group);
            let kept = path_of(&self.media, &conversation);
            let ready = match photo.and_then(|p| serde_json::from_str::<PhotoRef>(&p).ok()) {
                None => {
                    remove(&*self.blobs, &kept);
                    false
                }
                Some(photo) => match self.open_group_photo(&conversation, &photo, &kept) {
                    Ok(()) => true,
                    Err(ClientError::Media(MediaError::Tampered)) => {
                        remove(&*self.blobs, &kept);
                        false
                    }
                    // Not now; `photo_ready` stays 2.
                    Err(_) => continue,
                },
            };
            self.store.try_write(|tx| {
                // Only if the photo is still the one fetched: a fold may have
                // changed it meanwhile.
                tx.execute(
                    "UPDATE conversations SET photo_ready = ?2 WHERE group_id = ?1
                     AND photo_ready = 2",
                    params![group, u8::from(ready)],
                )
            })?;
        }
        Ok(())
    }

    fn open_group_photo(
        &self,
        conversation: &str,
        photo: &PhotoRef,
        kept: &Path,
    ) -> Result<(), ClientError> {
        let key = from_base64(&photo.key).ok_or(MediaError::Tampered)?;
        let incoming = self.media.join("in");
        self.blobs
            .create_dir_all(&incoming)
            .map_err(MediaError::from)?;
        if let Some(dir) = kept.parent() {
            self.blobs.create_dir_all(dir).map_err(MediaError::from)?;
        }
        let (blob, plain) = (
            incoming.join(format!("{}.blob", photo.id)),
            incoming.join(&photo.id),
        );
        let opened = (|| {
            authed(&self.transport, &self.token, &self.client)?.get_group_photo(
                conversation,
                &photo.id,
                &blob,
            )?;
            open(&*self.blobs, &blob, &plain, &key, &photo.sha256)?;
            // What was sealed is a picture the core made, not whatever the
            // sender's message says: it must still pass as one.
            let bytes = read_capped(
                self.blobs.open_read(&plain).map_err(MediaError::from)?,
                MAX_BYTES,
            )
            .ok_or(MediaError::Tampered)?;
            if !matches!(image::guess_format(&bytes), Ok(image::ImageFormat::Jpeg)) {
                return Err(MediaError::Tampered.into());
            }
            self.blobs.rename(&plain, kept).map_err(MediaError::from)?;
            Ok::<_, ClientError>(())
        })();
        remove(&*self.blobs, &blob);
        remove(&*self.blobs, &plain);
        opened
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder as _, Rgb};

    /// A little-endian TIFF with one GPS IFD (a latitude reference and a
    /// latitude), the shape a phone writes; built here so no fixture holds
    /// a real place.
    fn exif_with_gps() -> Vec<u8> {
        let mut tiff = b"II*\0\x08\0\0\0".to_vec();
        // IFD0: one entry, GPSInfo (0x8825) LONG 1 -> offset 26.
        tiff.extend([1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0]);
        // GPS IFD: GPSLatitudeRef (1) ASCII "N".
        tiff.extend([1, 0, 1, 0, 2, 0, 2, 0, 0, 0, b'N', 0, 0, 0, 0, 0, 0, 0]);
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend(tiff);
        let mut out = vec![0xFF, 0xE1];
        out.extend(((segment.len() + 2) as u16).to_be_bytes());
        out.extend(segment);
        out
    }

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_fn(width, height, |x, y| {
            Rgb([(x % 256) as u8, (y % 256) as u8, 90])
        });
        let mut out = Vec::new();
        JpegEncoder::new(&mut out).encode_image(&image).unwrap();
        out
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_fn(width, height, |x, _| {
            if x < width / 2 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 255])
            }
        });
        let mut out = Vec::new();
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(
                image.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgb8,
            )
            .unwrap();
        out
    }

    /// The marker segments of a JPEG up to the scan: (marker byte, payload).
    fn segments(jpeg: &[u8]) -> Vec<(u8, Vec<u8>)> {
        assert_eq!(jpeg[..2], [0xFF, 0xD8]);
        let (mut at, mut found) = (2, Vec::new());
        while at + 4 <= jpeg.len() && jpeg[at] == 0xFF {
            let marker = jpeg[at + 1];
            let len = usize::from(u16::from_be_bytes([jpeg[at + 2], jpeg[at + 3]]));
            found.push((marker, jpeg[at + 4..at + 2 + len].to_vec()));
            if marker == 0xDA {
                break;
            }
            at += 2 + len;
        }
        found
    }

    #[test]
    fn a_gps_tag_does_not_survive() {
        let plain = jpeg(40, 30);
        let mut tagged = plain[..2].to_vec();
        tagged.extend(exif_with_gps());
        tagged.extend(&plain[2..]);
        // The test input does carry the tag, or the assertion below proves nothing.
        assert!(
            segments(&tagged)
                .iter()
                .any(|(m, p)| *m == 0xE1 && p.starts_with(b"Exif"))
        );
        assert!(tagged.windows(4).any(|w| w == b"Exif"));

        let out = process(&tagged).unwrap();
        assert!(!out.windows(4).any(|w| w == b"Exif"));
        assert!(segments(&out).iter().all(|(m, _)| *m != 0xE1));
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (SIDE, SIDE));
    }

    #[test]
    fn a_wide_png_is_cropped_to_the_centre_square() {
        let out = process(&png(300, 100)).unwrap();
        let decoded = image::load_from_memory(&out).unwrap().to_rgb8();
        assert_eq!((decoded.width(), decoded.height()), (SIDE, SIDE));
        // The centre 100 px of 300 is the left half's last 50 px (red) and the
        // right half's first 50 (blue): the edges of the crop are those two.
        let left = decoded.get_pixel(20, 256).0;
        let right = decoded.get_pixel(SIDE - 20, 256).0;
        assert!(left[0] > 200 && left[2] < 60, "{left:?}");
        assert!(right[2] > 200 && right[0] < 60, "{right:?}");
    }

    #[test]
    fn another_format_is_refused() {
        assert_eq!(
            process(b"GIF89a\x01\0\x01\0\0\0\0;"),
            Err(GroupPhotoError::Unsupported)
        );
        assert_eq!(process(b""), Err(GroupPhotoError::Unsupported));
        assert_eq!(
            process(&[0xFF, 0xD8, 0xFF]),
            Err(GroupPhotoError::Unsupported)
        );
    }
}
