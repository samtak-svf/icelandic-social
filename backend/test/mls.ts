import fixture from "../../api/fixtures/mls-framing.json";

// Real OpenMLS messages from core/mls/tests/framing_fixture.rs: one scripted
// conversation between accounts "a" and "b", plus a PublicMessage commit.

export const hexBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export const mls = {
  ...fixture,
  /** A message of the fixture by name, as the contract's base64. */
  base64(name: string): string {
    const entry = fixture.messages.find((m) => m.name === name);
    if (!entry) throw new Error(`no fixture message ${name}`);
    return toBase64(hexBytes(entry.hex));
  },
  keyPackageBase64: toBase64(hexBytes(fixture.keyPackage.hex)),
  welcomeBase64: toBase64(hexBytes(fixture.welcome.hex)),
};
