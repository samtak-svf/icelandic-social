# 0086. A picture is framed by the person who sets it, and a cover once for each screen size

- Status: accepted; implemented in the Worker (#162), the web (#163), the core (#164, 0.39.0) and
  both apps (#166, #167; 0.12.0)
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0039](0039-profile-photo.md) (a stored master beside the fixed size; a framed crop
  instead of the centre), [0080](0080-communities-follow-the-familiar-group-layout.md) (the cover has
  one frame per window size class), [0009](0009-v1-scope.md) (the image editor is in v1)
- Closes: #160

## Decision

Today a community picture, a community cover and a profile photo go straight from the
system picker to the upload. Every client cuts the centre out before uploading, and the
Worker cuts the centre again (`fit: "cover"`). A cover chosen from a portrait photo keeps an
arbitrary middle strip; a profile photo may cut off the face. This record adds a framing
step, and for the cover one that sets the app apart: the person may frame it separately for
each screen it is shown on.

### Two levels, and the second is never forced on anyone

- **Default, what everyone sees:** after picking an image, one crop sheet in the shape the
  image has on this screen (a square for a picture or a photo), with drag, pinch and Save.
  Nothing else is new. The chosen rectangle sets a **focal point**, and every other frame is
  placed from it automatically. A person who never looks further gets a well-framed cover on
  every screen without learning that frames exist.
- **Advanced, a quiet text link inside the crop sheet** (not a button on the edit dialog), for
  covers only: every frame previewed at once (side by side, stacked on a phone), each
  adjustable on its own, and a reset that returns them to the focal point. Older and
  less practised people must not meet it by accident, so it never opens by itself and is
  never a step in the default flow.

### Frames follow window size classes, not devices

The three size classes every platform already speaks (Android `WindowSizeClass`, iOS size
classes, CSS media queries) decide which frame is shown, so a foldable, an iPad in split view
or a narrow browser window gets the frame that fits the space it has. Breakpoints are the
common ones: compact below 600, medium from 600 to below 840, expanded from 840 (dp, pt or
CSS px).

| Image                            | Frames (stored size)                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Community cover                  | compact 3:1 (1200×400), medium 4:1 (1600×400), expanded 8:3 (1600×600, today's shape) |
| Community picture, profile photo | one square (512×512)                                                                  |

The frame specifications are defined once in the backend's zod schemas, published in
`api/openapi.json`, and a guard holds every client's constants equal to them.

### What is stored, and the privacy property of 0039 and 0080

- **A master.** The upload is re-encoded once into a WebP capped at a 2400 px long edge.
  Images writes WebP without metadata, so EXIF location, the camera and the original file
  still never reach storage; the GPS test of 0039 holds for the master too. The master is
  stored beside the image and deleted with it. It is new stored data, which is why 0039 is
  amended: only re-encoded, metadata-free pixels are kept, as before, but at a larger size
  than the one shown.
- **One rendered WebP per frame**, cut from the master with the Images `trim` option and
  resized to the frame's size. Serving stays a static read from R2; nothing is transformed
  per view.
- **The framing** (the focal point and any per-frame override, as fractions of the image in
  `[0, 1]`) is stored as JSON beside the version token, so the editor reopens where the
  person left it.
- **The master is read only by who may change the image** (the account itself; a community's
  owner or a moderator), to re-frame without a new upload.

### The API stays additive

- The `PUT` of an image takes the bytes as today. Without framing, the frames are placed from
  the centre, which is what an old app gets and expects.
- A `PATCH …/frames` takes the focal point and the overrides and renders the frames again from
  the master, with a new version token. No new upload.
- A `GET` with `?frame=<name>` serves one frame. Without it, the frame an old app knows
  (expanded for a cover, the square for a picture) is served from the key it was always
  served from.
- An image uploaded before this record has no master. It keeps serving its one stored object
  for every frame until it is uploaded again.
- No field or route is removed or narrowed, so no `api: breaking`.

### One rule for placing a frame

A frame without an override is the largest rectangle of its aspect centred on the focal
point, moved inside the image where it would cross an edge. The backend and the Rust core
(which the Android and iOS apps use) each implement it, and both run one shared vector file,
so the clients and the server cannot place a frame differently.

### The clients stop cropping

The clients no longer cut the centre before uploading. They downscale to the 2400 px long
edge, encode JPEG under the 10 MB limit, upload, then send the framing. They show the cover in
the current size class's aspect, not a fixed height.

## Why

- A centre crop throws away what the person wanted to show; a crop sheet is the minimum.
- Every screen cuts a single cover again on its own, so one crop cannot be right on a phone
  and a desktop at once. Framing per size class is the honest fix, and it is what sets the
  editor apart.
- Hiding it behind a link inside the sheet keeps the default flow as simple as the system
  picker's own, for the people who would be confused by more.
- Keeping a metadata-free master is the only way to re-frame without asking for the file again,
  and costs no privacy the earlier records protected.
- Size classes, not device names, because the space an app has is what decides the shape.

## What this rules out

- Cropping on the client and uploading only the crop: the server could never re-frame.
- Storing the original file or its metadata.
- Transforming images per request at serving time.
- Post and comment images (0065, 0082): they keep their own path. They could use the same
  editor later, with a record of their own.
