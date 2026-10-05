// @ts-check
// Runs against the first committed brand, whichever it is, in a throwaway
// copy so a test can break one thing. No brand text appears here: the leak
// guard would (rightly) report it.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, run } from "../brand-gen.mjs";
import { leaksInFiles, loadBrands } from "../brand-leak-guard.mjs";
import { androidEscape } from "../lib/brand-gen/android.mjs";
import { renderPng } from "../lib/brand-gen/icon.mjs";
import { activeBrand, isOwned, OWNED_DIRS } from "../lib/brand-gen/paths.mjs";
import { brandNames, readJson, ROOT } from "../lib/repo.mjs";
import { copyRepo, editJson } from "./helpers.mjs";

const BRAND = brandNames()[0] ?? "";
const STRINGS = `brand/${BRAND}/strings.is.json`;
const RES = "android/core/brand/src/main/res";
const KOTLIN = "android/core/brand/src/main/kotlin/samtak/spjall/brand/BrandTokens.kt";
const XCSTRINGS = "ios/Generated/Localizable.xcstrings";
const IOS_ICON = "ios/Generated/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";

function fixture() {
  return copyRepo(["brand", "identifiers"]);
}

/**
 * @param {string} root
 * @param {string} path
 */
function output(root, path) {
  const file = generate(BRAND, root).files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} not generated`);
  return file.content.toString();
}

describe("brand-gen", () => {
  it("matches the committed outputs", () => {
    expect(run({ name: BRAND, check: true }).stale).toEqual([]);
  });

  it("writes only paths it owns", () => {
    expect(generate(BRAND).files.filter((f) => !isOwned(f.path))).toEqual([]);
  });

  it("escapes Android string syntax", () => {
    expect(androidEscape(`'já' & "nei" <b>`)).toBe(`\\'já\\' &amp; \\"nei\\" &lt;b&gt;`);
    expect(androidEscape("@stuff")).toBe("\\@stuff");
    expect(androidEscape("?stuff")).toBe("\\?stuff");
    expect(androidEscape("a@b")).toBe("a@b");
  });

  it("numbers placeholders in contract order, whatever the sentence order", () => {
    const root = fixture();
    editJson(root, STRINGS, (s) => {
      s.disappearing_set_card = "Eftir {duration} hverfur allt, sagði {name}. 100%";
    });
    expect(output(root, `${RES}/values/strings.xml`)).toContain(
      `<string name="disappearing_set_card">Eftir %2$s hverfur allt, sagði %1$s. 100%%</string>`,
    );
    const catalog = JSON.parse(output(root, XCSTRINGS));
    expect(catalog.strings.disappearing_set_card.localizations.is.stringUnit.value).toBe(
      "Eftir %2$@ hverfur allt, sagði %1$@. 100%%",
    );
  });

  it("emits plurals per platform", () => {
    const root = fixture();
    editJson(root, STRINGS, (s) => {
      s.unread_count = { one: "{count} eitt", other: "{count} mörg" };
    });
    const xml = output(root, `${RES}/values/strings.xml`);
    expect(xml).toContain(`<item quantity="one">%1$d eitt</item>`);
    expect(xml).toContain(`<item quantity="other">%1$d mörg</item>`);
    const plural = JSON.parse(output(root, XCSTRINGS)).strings.unread_count.localizations.is
      .variations.plural;
    expect(plural.one.stringUnit.value).toBe("%1$lld eitt");
    expect(plural.other.stringUnit.value).toBe("%1$lld mörg");
  });

  it("gives each surface only its own keys", () => {
    const root = fixture();
    const xml = output(root, `${RES}/values/strings.xml`);
    expect(xml).toContain(`name="notification_channel_messages_name"`);
    expect(xml).not.toContain(`name="push_fallback_body"`);
    const ios = JSON.parse(output(root, XCSTRINGS)).strings;
    expect(Object.keys(ios)).toContain("push_fallback_body");
    expect(Object.keys(ios)).not.toContain("notification_channel_messages_name");
    const ts = output(root, "backend/src/brand.gen.ts");
    expect(ts).toContain("push_fallback_body:");
    expect(ts).not.toContain("send:");
  });

  it("resolves alias colours and keeps alpha", () => {
    const root = fixture();
    editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
      t.color["bubble-own-bg"].$value = "{color.primary}";
      t.color.border.$value.alpha = 0.18;
    });
    const kotlin = output(root, KOTLIN);
    const value = (/** @type {string} */ name) =>
      new RegExp(`const val ${name}: Long = (0x[0-9A-F]{8}L)`).exec(kotlin)?.[1];
    expect(value("BUBBLE_OWN_BG")).toBe(value("PRIMARY"));
    expect(value("BORDER")?.slice(2, 4)).toBe(
      Math.round(0.18 * 255)
        .toString(16)
        .toUpperCase(),
    );
    expect(output(root, "ios/Generated/BrandTokens.swift")).toMatch(
      /static let border = Color\(.*opacity: 46 \/ 255\)/,
    );
  });

  it("generates nothing from a brand that brand-check rejects", () => {
    const root = fixture();
    editJson(root, STRINGS, (s) => {
      delete s.send;
    });
    const result = run({ name: BRAND, check: false, root });
    expect(result.problems).toContain("strings.is.json send: missing");
    expect(result.written).toBe(0);
    expect(OWNED_DIRS.some((dir) => existsSync(join(root, dir)))).toBe(false);
  });

  it("--check fails on a one-character edit and on a stray file", () => {
    const root = fixture();
    run({ name: BRAND, check: false, root });
    expect(run({ name: BRAND, check: true, root }).stale).toEqual([]);
    const path = join(root, RES, "values/strings.xml");
    writeFileSync(path, readFileSync(path, "utf8").replace("</resources>", "</resources> "));
    writeFileSync(join(root, RES, "values/extra.xml"), "<resources/>\n");
    expect(run({ name: BRAND, check: true, root }).stale).toEqual([
      `${RES}/values/strings.xml`,
      `${RES}/values/extra.xml (not generated)`,
    ]);
    run({ name: BRAND, check: false, root });
    expect(existsSync(join(root, RES, "values/extra.xml"))).toBe(false);
  });

  it("lets generated files name the active brand only", () => {
    const root = fixture();
    run({ name: BRAND, check: false, root });
    const files = generate(BRAND, root).files.map((f) => f.path);
    const brands = loadBrands(root);
    expect(leaksInFiles(files, brands, root, BRAND)).toEqual([]);
    expect(leaksInFiles(files, brands, root, "_other").length).toBeGreaterThan(0);
    const other = {
      name: "_other",
      leakTerms: { stems: ["zzqx"], allowPrefixes: [], allowPaths: [] },
    };
    const path = join(root, RES, "values/strings.xml");
    writeFileSync(path, `${readFileSync(path, "utf8")}<!-- zzqxleft -->\n`);
    expect(leaksInFiles(files, [...brands, other], root, BRAND).map((l) => l.brand)).toEqual([
      "_other",
    ]);
  });

  it("defaults to the only real brand and refuses to guess between two", () => {
    const root = fixture();
    const saved = process.env.BRAND;
    delete process.env.BRAND;
    try {
      expect(activeBrand(root)).toBe(BRAND);
      cpSync(join(root, "brand", BRAND), join(root, "brand", "_drill"), { recursive: true });
      expect(activeBrand(root)).toBe(BRAND);
      cpSync(join(root, "brand", BRAND), join(root, "brand", "second"), { recursive: true });
      expect(() => activeBrand(root)).toThrow(/set BRAND/);
    } finally {
      if (saved !== undefined) process.env.BRAND = saved;
    }
  });

  it("renders icons byte-identically, the iOS one without alpha", () => {
    const manifest = readJson(`brand/${BRAND}/brand.json`);
    const svg = readFileSync(join(ROOT, "brand", BRAND, manifest.icon.foreground), "utf8");
    expect(renderPng(svg, 108).equals(renderPng(svg, 108))).toBe(true);
    const root = fixture();
    const icon = () => generate(BRAND, root).files.find((f) => f.path === IOS_ICON)?.content;
    const first = icon();
    if (!Buffer.isBuffer(first)) throw new Error("iOS icon is not binary");
    expect(first.equals(/** @type {Buffer} */ (icon()))).toBe(true);
    expect(first[25]).toBe(2); // IHDR colour type 2: RGB, no alpha channel
  });
});
