# 0047. The conversation header, a camera button, a quieter Ég, and a way back from Nýtt hjal

- Status: accepted; attaching amended by [0048](0048-server-time-lines-attachment-preview-and-photo-location.md)
  (the preview, which 0.6.2 did not have; location in a picked photo), implemented in the apps
  (4ff7327), released as 0.6.2
- Date: 2026-10-12
- Decided by: the maintainer, asking to continue with the next items (5 to 8) of the 0.5.0 UX
  review
- Amends: [0043](0043-first-launch-and-the-ui-pass.md) (Ég: the name and the photo buttons; the
  composer's one action)
- Builds on: [0039](0039-profile-photo.md) (the photo buttons), [0022](0022-the-conversation-surfaces.md) (the conversation's menu and information),
  [0023](0023-media-as-encrypted-blobs.md) (photos as encrypted blobs)

## Decision

### The conversation header

- **The menu button is each platform's own "more" mark**: ⋮ on Android, a circled ellipsis on
  iOS. The three-line mark reads as navigation on both.
- A tap on the name or the photo opens the conversation's information, as 0043 already says,
  in every state that has a menu.

### Attaching

- **While the field is empty, a camera button sits next to it**, beside the attach button of
  0043, and takes a photo with the system camera. Once there is text, send replaces both.
- The photo goes through the same preview and send as a picked one. **A photo taken in the app
  loses its location before it is sent**: the system camera may write GPS coordinates into the
  file, and the reader does not need to know where it was taken.
- The attach button keeps its two choices, "Mynd" and "Skrá". On Android "Mynd" opens the
  system photo picker, which is already a sheet from below; on iOS it opens PhotosPicker.
- Android asks for no camera permission: the system camera app takes the photo. iOS asks the
  first time the button is used, with its own usage sentence.

### Ég

- **The name is written as it is**, in the account-name size, not in capitals.
- **"Setja inn mynd" or "Skipta um mynd", and "Fjarlægja mynd", look like buttons**: an
  outlined pill each, as the invite card's buttons are.
- **"Skrá út" is its own button**, under the settings and above "Eyða aðgangi", and asks
  first. It does what revoking this device does today. The device list no longer offers
  "Aftengja" on this device, only on the others, so signing out is found where people look
  for it.

### Nýtt hjal

- **The header has a back button.** While picking several for a group it returns to picking
  one, as the system back already does; otherwise it closes the screen.

## Why

These are the items of the 0.5.0 review where the apps differ from what people know from
other messengers without a reason of their own: a menu mark that means something else, a photo
that takes three taps to take, a name that shouts, buttons that look like text, a sign-out
called something else and found only in a list of devices, and a screen with no visible way
back.

## Rules out

- A group name or photo. A group is titled by its members in v1 (0022); a name would be new
  group state in the core and needs its own record.
- Video from the camera, and a gallery grid of the app's own. The system picker already is
  one, and keeps the app from needing access to every photo.
- Asking Android for the camera permission.
