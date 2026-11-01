import { describe, expect, it } from "vitest";
import {
  ExportTooBig,
  MAX_ENTRIES,
  centralDirectory,
} from "../../../src/modules/exports/zip-writer.ts";
import { fromImport } from "../../../src/modules/exports/format.ts";
import { parseExportFile } from "../../../src/modules/imports/export-file.ts";

// The file format and its writer. The bug each test names: the export forgetting a field the
// importer reads (so a file we write is poorer than the ones we accept), and a ZIP that
// silently wraps past its 16-bit entry count.

describe("the export's post fields", () => {
  it("name every field the importer reads from a real parsed post", async () => {
    const { items } = await parseExportFile([
      {
        timestamp: 1_558_096_245,
        data: [{ post: "Fyrsta færsla" }],
        attachments: [{ data: [{ media: { uri: "posts/media/a.jpg" } }] }],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!).sort()).toEqual(Object.keys(fromImport).sort());
  });
});

describe("the ZIP writer", () => {
  it("refuses a file with more entries than the format counts, instead of wrapping", () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
      name: `e${i}`,
      crc: 0,
      size: 0,
      offset: 0,
    }));
    expect(() => centralDirectory(entries, 0)).toThrow(ExportTooBig);
  });

  it("refuses a directory that would end past the 32-bit offset", () => {
    expect(() => centralDirectory([{ name: "a", crc: 0, size: 0, offset: 0 }], 0xffffffff)).toThrow(
      ExportTooBig,
    );
  });
});
