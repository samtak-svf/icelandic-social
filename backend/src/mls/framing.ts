// The unencrypted framing of an MLS message (RFC 9420 §6), which is all the
// server reads (decisions 0002, 0017): which group, which epoch, and whether
// it is a commit. Everything after those fields is ciphertext or signed
// content it neither needs nor checks. api/fixtures/mls-framing.json holds
// real OpenMLS messages to test against.

/** RFC 9420 §6, `WireFormat`. */
const WIRE_FORMATS = {
  1: "public",
  2: "private",
  3: "welcome",
  4: "group_info",
  5: "key_package",
} as const;

/** RFC 9420 §6, `ContentType`. */
const CONTENT_TYPES = { 1: "application", 2: "proposal", 3: "commit" } as const;

type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

export type Framing =
  | {
      wireFormat: "public" | "private";
      groupId: Uint8Array;
      epoch: number;
      contentType: ContentType;
    }
  | { wireFormat: "welcome"; cipherSuite: number }
  | {
      wireFormat: "key_package";
      cipherSuite: number;
      /** The leaf's BasicCredential identity, `{accountId}/{deviceId}` (0018). */
      identity: Uint8Array;
      /** The leaf's signature key, the device key it was registered with. */
      signatureKey: Uint8Array;
    }
  | { wireFormat: "group_info" };

/** Bytes that are not a well-formed MLS 1.0 message. */
export class FramingError extends Error {}

const MLS10 = 1;

/** RFC 9420 §5.3, `CredentialType`: the only kind a client makes (0018). */
const BASIC_CREDENTIAL = 1;

class Reader {
  private at = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  private take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new FramingError("truncated");
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u16(): number {
    const [a, b] = this.take(2);
    return (a! << 8) | b!;
  }

  u32(): number {
    return new DataView(this.take(4).slice().buffer).getUint32(0);
  }

  /** A u64 that must fit a JavaScript number; an epoch never comes close. */
  u64(): number {
    const value = new DataView(this.take(8).slice().buffer).getBigUint64(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new FramingError("u64 out of range");
    return Number(value);
  }

  /** RFC 9420 §2.1.2: a variable-size vector, its length in the fewest bytes. */
  vector(): Uint8Array {
    const first = this.u8();
    const prefix = first >> 6;
    let length = first & 0x3f;
    if (prefix === 1) {
      length = (length << 8) | this.u8();
      if (length < 0x40) throw new FramingError("length not minimal");
    } else if (prefix === 2) {
      for (let i = 0; i < 3; i++) length = (length << 8) | this.u8();
      length >>>= 0;
      if (length < 0x4000) throw new FramingError("length not minimal");
    } else if (prefix === 3) {
      throw new FramingError("length prefix 0b11");
    }
    return this.take(length);
  }

  end(): void {
    if (this.at !== this.bytes.length) throw new FramingError("trailing bytes");
  }
}

function contentType(value: number): ContentType {
  const type = CONTENT_TYPES[value as keyof typeof CONTENT_TYPES];
  if (!type) throw new FramingError(`content type ${value}`);
  return type;
}

/** RFC 9420 §6, `Sender`: skipped, but its size depends on its type. */
function skipSender(reader: Reader): void {
  const type = reader.u8();
  if (type === 1 || type === 2) reader.u32();
  else if (type !== 3 && type !== 4) throw new FramingError(`sender type ${type}`);
}

/**
 * Reads the framing of one MLSMessage. A PrivateMessage and a Welcome are
 * read to their last byte; a PublicMessage, a KeyPackage and a GroupInfo up
 * to the fields the server uses, since the rest is signed content whose
 * checking is the clients' (decision 0002). A KeyPackage is read into its
 * leaf as far as the credential, which must be a BasicCredential.
 */
export function readFraming(bytes: Uint8Array): Framing {
  const reader = new Reader(bytes);
  if (reader.u16() !== MLS10) throw new FramingError("not MLS 1.0");
  const wire = reader.u16();
  const wireFormat = WIRE_FORMATS[wire as keyof typeof WIRE_FORMATS];
  switch (wireFormat) {
    case "public": {
      const groupId = reader.vector();
      const epoch = reader.u64();
      skipSender(reader);
      reader.vector(); // authenticated_data
      return { wireFormat, groupId, epoch, contentType: contentType(reader.u8()) };
    }
    case "private": {
      const groupId = reader.vector();
      const epoch = reader.u64();
      const type = contentType(reader.u8());
      reader.vector(); // authenticated_data
      reader.vector(); // encrypted_sender_data
      reader.vector(); // ciphertext
      reader.end();
      return { wireFormat, groupId, epoch, contentType: type };
    }
    case "welcome": {
      const cipherSuite = reader.u16();
      reader.vector(); // secrets
      reader.vector(); // encrypted_group_info
      reader.end();
      return { wireFormat, cipherSuite };
    }
    case "key_package": {
      if (reader.u16() !== MLS10) throw new FramingError("KeyPackage not MLS 1.0");
      const cipherSuite = reader.u16();
      reader.vector(); // init_key
      reader.vector(); // leaf_node.encryption_key
      const signatureKey = reader.vector();
      const credential = reader.u16();
      if (credential !== BASIC_CREDENTIAL) throw new FramingError(`credential type ${credential}`);
      return { wireFormat, cipherSuite, identity: reader.vector(), signatureKey };
    }
    case "group_info":
      return { wireFormat };
    default:
      throw new FramingError(`wire format ${wire}`);
  }
}
