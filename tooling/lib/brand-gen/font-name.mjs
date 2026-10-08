// @ts-check
// The PostScript name of a TrueType or OpenType font, read from its `name`
// table. iOS finds a bundled face by this name, not by its file name, and a
// family name alone does not reach every face (an instanced variable font
// keeps the family of its source).

const POSTSCRIPT_NAME = 6;

/**
 * @param {Buffer} bytes the font file
 * @returns {string}
 */
export function postScriptName(bytes) {
  const tables = bytes.readUInt16BE(4);
  let name = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (bytes.toString("latin1", record, record + 4) === "name") {
      name = bytes.readUInt32BE(record + 8);
      break;
    }
  }
  if (name < 0) throw new Error("font has no name table");
  const count = bytes.readUInt16BE(name + 2);
  const strings = name + bytes.readUInt16BE(name + 4);
  /** @type {string | undefined} */
  let mac;
  for (let i = 0; i < count; i++) {
    const record = name + 6 + i * 12;
    const platform = bytes.readUInt16BE(record);
    const id = bytes.readUInt16BE(record + 6);
    if (id !== POSTSCRIPT_NAME) continue;
    const length = bytes.readUInt16BE(record + 8);
    const start = strings + bytes.readUInt16BE(record + 10);
    const raw = bytes.subarray(start, start + length);
    // Windows (3) and Unicode (0) store UTF-16BE; Macintosh (1) single bytes.
    if (platform === 3 || platform === 0) return Buffer.from(raw).swap16().toString("utf16le");
    if (platform === 1) mac = raw.toString("latin1");
  }
  if (mac) return mac;
  throw new Error("font has no PostScript name");
}
