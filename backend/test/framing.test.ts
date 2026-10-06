import { describe, expect, it } from "vitest";
import { base64url } from "../src/bytes.ts";
import { FramingError, readFraming } from "../src/mls/framing.ts";
import { hexBytes, mls } from "./mls.ts";

// The framing reader against real OpenMLS output (api/fixtures/mls-framing.json).

const CONTENT = { 1: "application", 2: "proposal", 3: "commit" } as const;
const WIRE = { 1: "public", 2: "private" } as const;

describe("the MLS framing reader", () => {
  it.each(mls.messages)("reads $name", (entry) => {
    const framing = readFraming(hexBytes(entry.hex));
    expect(framing).toEqual({
      wireFormat: WIRE[entry.wireFormat as 1 | 2],
      groupId: hexBytes(entry.groupId),
      epoch: entry.epoch,
      contentType: CONTENT[entry.contentType as 1 | 2 | 3],
    });
  });

  it("reads a Welcome and a KeyPackage with their suite", () => {
    expect(readFraming(hexBytes(mls.welcome.hex))).toEqual({
      wireFormat: "welcome",
      cipherSuite: mls.ciphersuite,
    });
    expect(readFraming(hexBytes(mls.keyPackage.hex))).toEqual({
      wireFormat: "key_package",
      cipherSuite: mls.ciphersuite,
    });
  });

  it("refuses every truncation of a PrivateMessage and a Welcome", () => {
    for (const hex of [mls.messages[1]!.hex, mls.welcome.hex]) {
      const bytes = hexBytes(hex);
      for (let n = 0; n < bytes.length; n++) {
        expect(() => readFraming(bytes.subarray(0, n)), `${n} bytes`).toThrow(FramingError);
      }
    }
  });

  it("fails only with FramingError on any truncation of any message", () => {
    const all = [...mls.messages.map((m) => m.hex), mls.welcome.hex, mls.keyPackage.hex];
    for (const bytes of all.map(hexBytes)) {
      for (let n = 0; n < bytes.length; n++) {
        try {
          readFraming(bytes.subarray(0, n));
        } catch (error) {
          expect(error).toBeInstanceOf(FramingError);
        }
      }
    }
  });

  it("refuses trailing bytes, another version and a length not in its fewest bytes", () => {
    const message = hexBytes(mls.messages[1]!.hex);
    expect(() => readFraming(Uint8Array.of(...message, 0))).toThrow(/trailing/);
    expect(() => readFraming(Uint8Array.of(0, 2, ...message.subarray(2)))).toThrow(/MLS 1.0/);
    // A one-byte group id written with a two-byte length.
    const padded = Uint8Array.of(0, 1, 0, 2, 0x40, 0x01, 0xaa);
    expect(() => readFraming(padded)).toThrow(/minimal/);
  });

  it("writes a group id as unpadded base64url", () => {
    expect(base64url(Uint8Array.of(0xfb, 0xff))).toBe("-_8");
    expect(base64url(hexBytes(mls.messages[0]!.groupId))).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
