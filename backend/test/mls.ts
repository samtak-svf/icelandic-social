import fixture from "../../api/fixtures/mls-framing.json";

// Real OpenMLS messages from core/mls/tests/framing_fixture.rs: one scripted
// conversation between accounts "a" and "b", plus a PublicMessage commit,
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

/**
 * The fixture's KeyPackage with another identity and signature key in its
 * leaf. Its signature no longer verifies, which only a client checks; the
 * server reads who the package names (0018), and that is what this changes.
 */
function keyPackageNaming(identity: string, signatureKey: Uint8Array): string {
  const bytes = hexBytes(fixture.keyPackage.hex);
  const initKey = 8; // MLSMessage version and wire format, then version and suite
  const keyAt = skip(bytes, skip(bytes, initKey)); // past init_key and encryption_key
  const credentialAt = skip(bytes, keyAt);
  const rest = skip(bytes, credentialAt + 2); // past the credential type and identity
  return toBase64(
    Uint8Array.from([
      ...bytes.subarray(0, keyAt),
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
  keyPackageNaming,
  welcomeBase64: toBase64(hexBytes(fixture.welcome.hex)),
};
