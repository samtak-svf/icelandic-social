import fixture from "../../api/fixtures/mls-framing.json";

// Real OpenMLS messages from core/mls/tests/framing_fixture.rs: one scripted
// conversation between accounts "a" and "b", with the GroupInfo each commit
// carries and a new device's external commit, plus a PublicMessage commit,
// and a KeyPackage made by a device as `a_1/d_1`.

export const hexBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** RFC 9420 §2.1.2, for vectors shorter than 16 KiB. */
function vector(bytes: Uint8Array): Uint8Array {
  const prefix =
    bytes.length < 0x40 ? [bytes.length] : [0x40 | (bytes.length >> 8), bytes.length & 0xff];
  return Uint8Array.from([...prefix, ...bytes]);
}

/** Where the vector at `at` ends. */
function skip(bytes: Uint8Array, at: number): number {
  const first = bytes[at]!;
  if (first >> 6 === 0) return at + 1 + first;
  if (first >> 6 === 1) return at + 2 + (((first & 0x3f) << 8) | bytes[at + 1]!);
  throw new Error("vector too long for the fixture");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The fixture's KeyPackage with another identity and signature key in its
 * leaf, and a lifetime ending at `notAfter` (milliseconds; 84 days from now
 * if not given, as a device makes it, 0029). Its signature no longer
 * verifies, which only a client checks; the server reads who the package
 * names (0018) and when it expires, and that is what this changes.
 */
function keyPackageNaming(
  identity: string,
  signatureKey: Uint8Array,
  notAfter = Date.now() + 84 * DAY_MS,
): string {
  const bytes = hexBytes(fixture.keyPackage.hex);
  const initKey = 8; // MLSMessage version and wire format, then version and suite
  const keyAt = skip(bytes, skip(bytes, initKey)); // past init_key and encryption_key
  const credentialAt = skip(bytes, keyAt);
  const rest = skip(bytes, credentialAt + 2); // past the credential type and identity
  let lifetime = rest;
  for (let i = 0; i < 5; i++) lifetime = skip(bytes, lifetime); // the capabilities
  lifetime += 1; // the leaf's source, a KeyPackage
  const seconds = Math.floor(notAfter / 1000);
  return toBase64(
    Uint8Array.from([
      ...bytes.subarray(0, keyAt),
      ...vector(signatureKey),
      ...bytes.subarray(credentialAt, credentialAt + 2),
      ...vector(new TextEncoder().encode(identity)),
      ...bytes.subarray(rest, lifetime),
      ...u64(seconds - 2 * 60 * 60),
      ...u64(seconds),
      ...bytes.subarray(lifetime + 16),
    ]),
  );
}

/**
 * A PrivateMessage commit of the fixture with another claim in its
 * authenticated_data (0020), naming this test's accounts in place of "a"
 * and "b". Its AEAD no longer opens, which only a client checks.
 */
function claimed(name: string, roster: string[], welcome: string[] = []): string {
  const entry = fixture.messages.find((m) => m.name === name);
  if (entry?.wireFormat !== 2 || entry.contentType !== 3) {
    throw new Error(`${name} is not a PrivateMessage commit`);
  }
  const bytes = hexBytes(entry.hex);
  const aad = skip(bytes, 4) + 8 + 1; // past the header, group id, epoch and content type
  const claim = new TextEncoder().encode(JSON.stringify({ roster, welcome }));
  return toBase64(
    Uint8Array.from([
      ...bytes.subarray(0, aad),
      ...vector(claim),
      ...bytes.subarray(skip(bytes, aad)),
    ]),
  );
}

const u64 = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};

function named(name: string) {
  const found = fixture.messages.find((m) => m.name === name);
  if (!found) throw new Error(`no fixture message ${name}`);
  return found;
}

/**
 * The GroupInfo a commit of the fixture carries (0021), as base64, its
 * epoch moved to `epoch` if given. The server reads only its group and epoch.
 */
function groupInfo(name: string, epoch?: number): string {
  const hex = named(name).groupInfo;
  if (!hex) throw new Error(`${name} carries no GroupInfo`);
  const bytes = hexBytes(hex);
  if (epoch === undefined) return toBase64(bytes);
  const at = skip(bytes, 8); // past the header, version, suite and group id
  return toBase64(
    Uint8Array.from([...bytes.subarray(0, at), ...u64(epoch), ...bytes.subarray(at + 8)]),
  );
}

/**
 * The fixture's external commit with this test's claim, epoch and joining
 * leaf in place of its own. Its signature no longer verifies, which only a
 * client checks; the server reads the framing and whose leaf it brings.
 */
function joining(
  roster: string[],
  { epoch, identity, signatureKey }: { epoch: number; identity: string; signatureKey: Uint8Array },
): string {
  const bytes = hexBytes(named("a5 joins").hex);
  const epochAt = skip(bytes, 4);
  const aad = epochAt + 8 + 1; // past the epoch and the sender, a new member's commit
  const proposals = skip(bytes, aad) + 1; // past the claim and the content type
  const encryptionKey = skip(bytes, proposals) + 1; // past the proposals and the path's presence
  const signatureKeyAt = skip(bytes, encryptionKey);
  const credentialAt = skip(bytes, signatureKeyAt);
  const rest = skip(bytes, credentialAt + 2);
  const claim = new TextEncoder().encode(JSON.stringify({ roster, welcome: [] }));
  return toBase64(
    Uint8Array.from([
      ...bytes.subarray(0, epochAt),
      ...u64(epoch),
      ...bytes.subarray(epochAt + 8, aad),
      ...vector(claim),
      ...bytes.subarray(skip(bytes, aad), signatureKeyAt),
      ...vector(signatureKey),
      ...bytes.subarray(credentialAt, credentialAt + 2),
      ...vector(new TextEncoder().encode(identity)),
      ...bytes.subarray(rest),
    ]),
  );
}

export const mls = {
  ...fixture,
  /** A message of the fixture by name, as the contract's base64. */
  base64(name: string): string {
    const entry = fixture.messages.find((m) => m.name === name);
    if (!entry) throw new Error(`no fixture message ${name}`);
    return toBase64(hexBytes(entry.hex));
  },
  keyPackageBase64: toBase64(hexBytes(fixture.keyPackage.hex)),
  claimed,
  groupInfo,
  joining,
  keyPackageNaming,
  welcomeBase64: toBase64(hexBytes(fixture.welcome.hex)),
};
