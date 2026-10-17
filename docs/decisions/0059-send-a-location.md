# 0059. A location is sent once, shown without a map, and opened on map.is or a map app

- Status: accepted; implemented in the core (#261, core 0.28.0) and the apps, released as 0.8.8
- Date: 2026-10-17
- Decided by: the maintainer, asking for a location sent with map.is and choosing the current place
  only, a bubble without a map, and opening on map.is or the phone's map app
- Builds on: [0002](0002-mls-end-to-end-encryption.md) (the envelope is end-to-end encrypted),
  [0025](0025-push-without-ids.md) (what a notice may say),
  [0041](0041-forward-a-message.md) (forward), [0046](0046-copy-a-message-and-open-its-links.md)
  (copy, and opening outside the app)
- Amends: 0009 (messaging: a location)

## Decision

### What is sent

- **One place, once: where the phone is when the person sends it.** There is no point picked
  on a map and no location that keeps updating.
- **It is a new envelope kind, `location`**, so the server sees only ciphertext, as it does for
  every message (0002):

  ```json
  { "v": 1, "id": "…", "ts": …, "kind": "location", "latE6": 64141960, "lonE6": -21926570, "accuracy": 12 }
  ```

  `latE6` and `lonE6` are WGS 84 degrees times 10⁶ as integers (about 0.1 m), so the envelope
  never carries a float and decodes the same everywhere. `accuracy` is the fix's radius in whole
  metres, absent when the system gives none. `forwarded` is as in 0041.

- **The core refuses to send** a latitude outside ±90° or a longitude outside ±180°, and a
  received one out of range is skipped as an unknown kind is, never shown as a place.
- Nothing changes on the server. It is a message like any other: it wakes the reader's devices
  (`urgent`), and the disappearing timer, delete for everyone, reactions, replies and forward
  (as a fresh copy marked "Áframsent") apply to it. Edit does not: there is no text to edit.

### Sending

- **The attach button gets a third choice, "Staðsetning"**, after "Mynd" and "Skrá".
- The app asks for location **only then, the first time, and only while it is in use**: iOS
  "when in use", Android fine and coarse. On Android the person may grant only an approximate
  location; the place is then sent with that accuracy. The app never asks for background
  location and never reads the location at any other moment.
- **It takes a fresh fix**, never a remembered last-known place, and gives up after 30 seconds
  with a message that the place could not be found.
- **A dialog asks before sending**, with the accuracy ("Nákvæmni um 12 m") and "Senda" /
  "Hætta við". A location is the one message that says where someone is right now, so one
  mistaken tap must not send it.

### Showing

- **The bubble is a card without a map**: a pin mark, "Staðsetning", the coordinates in degrees
  with the Icelandic decimal comma (`64,14196° N, 21,92657° V`) and the accuracy. **Nothing is
  fetched to draw it**: no map tile, no address. A map or an address would send the coordinates
  to a third party from every reader's phone the moment the message arrives.
- The conversation list and a notice say only "Staðsetning". **Coordinates are never in a
  notice**: a notice is shown on a locked screen.
- Copy (0046) copies the coordinates as `64.141960, -21.926570`, which every map app and search
  field accepts.

### Opening

- **A tap on the card offers "Opna á map.is" and "Opna í kortaappi".** Only a tap sends the
  coordinates anywhere, and only to the one place chosen.
- **map.is** opens in the default browser at
  `https://map.is/?action=pin{lon:<x>,lat:<y>,zoom:<z>}`. Despite its names, map.is reads `lon`
  and `lat` as ISN93 easting and northing in metres (EPSG:3057), so the core projects the
  WGS 84 point to ISN93 (Lambert conformal conic on GRS 80). The format is not documented by
  map.is; it is read from its own page code (2026-10-17). It is built in **one place, the core**,
  tested against a known point, so when map.is changes it, one change in the core fixes both apps.
- **Outside ISN93's area (Iceland and its waters)** map.is has nothing to show, so the card opens
  the map app directly.
- **The map app** is the system's own handler: Android a `geo:` intent, iOS an Apple Maps link,
  which on iOS opens the person's chosen maps app where the system allows one.

## Why

Telling someone where you are, at a meeting point, on a hike or after a car breaks down, is an
everyday message, and today it means typing an address or a screenshot of a map. map.is has
Iceland's detailed aerial photos and place names, which is what someone in Iceland wants to
see; a map app gives directions. Keeping the card free of a map is what keeps the place inside
the end-to-end encryption until the reader chooses to open it.

## Rules out

- **A live location**, updated over minutes. It needs the phone to read and send its place in
  the background, a stop control, and a record of its own.
- **Picking a point on a map** before sending, which needs a map inside the app and so tiles
  fetched from a third party.
- **A map or an address in the bubble**, drawn from tiles or a geocoder. Either tells a third
  party where the people in the conversation are.
- **Background location**, and reading the location for anything but the one place sent.
- **Rounding the place to blur it.** The person sees the accuracy before sending and can grant
  Android only an approximate place; an app-chosen blur would be a guess at what they want.
