// @ts-check
// Runs against the first committed brand, whichever it is, in a throwaway
// copy so a test can break one thing. No brand text appears here: the leak
// guard would (rightly) report it.
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { generate, run } from "../brand-gen.mjs";
import { leaksInFiles, loadBrands } from "../brand-leak-guard.mjs";
import { androidEscape, fontResource } from "../lib/brand-gen/android.mjs";
import { postScriptName } from "../lib/brand-gen/font-name.mjs";
import { renderPng } from "../lib/brand-gen/icon.mjs";
import { activeBrand, isOwned, OWNED_DIRS } from "../lib/brand-gen/paths.mjs";
import { brandNames, readJson, ROOT } from "../lib/repo.mjs";
import { copyRepo, editJson } from "./helpers.mjs";

const BRAND = brandNames()[0] ?? "";
const STRINGS = `brand/${BRAND}/strings.is.json`;
const RES = "android/core/brand/src/generated/res";
const KOTLIN = "android/core/brand/src/generated/kotlin/samtak/spjall/brand/BrandTokens.kt";
const XCSTRINGS = "ios/Generated/Localizable.xcstrings";
const WEB = "web/src/generated/brand";
const IOS_ICON = "ios/Generated/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";

function fixture() {
  return copyRepo(["brand", "identifiers"]);
}

/**
 * @param {string} root
 * @param {string} path
 */
function output(root, path) {
  return generated(root)(path);
}

/**
 * Generates once and reads any number of files from that run: a full generation renders the
 * icons and the fonts, so a test that reads many files must not pay for it per file.
 * @param {string} root
 */
function generated(root) {
  const files = new Map(generate(BRAND, root).files.map((f) => [f.path, f.content]));
  return (/** @type {string} */ path) => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`${path} not generated`);
    return content.toString();
  };
}

describe("brand-gen", () => {
  it("matches the committed outputs", () => {
    expect(run({ name: BRAND, check: true }).stale).toEqual([]);
  });

  it("writes only into generated directories, bar the named exceptions", () => {
    /** Outputs a tool or platform names, so they cannot sit in a directory called `generated`. */
    const exceptions = new Map([
      [
        "backend/src/brand.gen.ts",
        "the `.gen.ts` suffix is the generated-file marker for TypeScript files",
      ],
      [
        "ios/Generated/",
        "XcodeGen's project.yml and the Swift sources read the capitalised directory",
      ],
    ]);
    const outside = generate(BRAND)
      .files.map((f) => f.path)
      .filter((path) => !path.split("/").includes("generated"))
      .filter((path) => ![...exceptions.keys()].some((key) => path.startsWith(key)));
    expect(outside).toEqual([]);
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

  it("emits web plurals by Icelandic rules and placeholders as typed arguments", async () => {
    const root = fixture();
    editJson(root, "brand/strings.contract.json", (c) => {
      c.keys.unread_count.surfaces.push("web");
      c.keys.link_invited_by.surfaces.push("web");
    });
    editJson(root, STRINGS, (s) => {
      s.unread_count = { one: "{count} eitt", other: "{count} mörg" };
      s.link_invited_by = 'Frá "{name}" \\ hér';
    });
    const ts = output(root, `${WEB}/strings.ts`);
    expect(ts).toContain("unread_count: (args: { count: number }): string =>");
    expect(ts).toContain("link_invited_by: (args: { name: string }): string =>");
    const dir = mkdtempSync(join(tmpdir(), "brand-gen-web-"));
    writeFileSync(join(dir, "strings.ts"), ts);
    const { strings } = await import(pathToFileURL(join(dir, "strings.ts")).href);
    // Icelandic takes the singular for every number ending in 1 but 11.
    expect([1, 21, 101].map((count) => strings.unread_count({ count }))).toEqual([
      "1 eitt",
      "21 eitt",
      "101 eitt",
    ]);
    expect([0, 2, 11, 111].map((count) => strings.unread_count({ count }))).toEqual([
      "0 mörg",
      "2 mörg",
      "11 mörg",
      "111 mörg",
    ]);
    expect(strings.link_invited_by({ name: "x`${y}" })).toBe('Frá "x`${y}" \\ hér');
  });

  it("gives the web the tokens as theme variables, dark mode included", () => {
    const root = fixture();
    editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
      t.dark.surface.$value = { colorSpace: "oklch", components: [0, 0, 0] };
    });
    const css = output(root, `${WEB}/theme.css`);
    const theme = /@theme static \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const dark = /prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const names = (/** @type {string} */ text) =>
      [...text.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(names(theme).length).toBeGreaterThan(0);
    expect(names(dark)).toEqual(names(theme));
    expect(dark).toContain("--color-surface: #000000;");
    expect(theme).toContain("--color-*: initial;");
    expect(theme).toMatch(/--font-sans: "[^"]+", /);
    expect(theme).toContain("--radius-md: 6px;");
  });

  it("gives each surface only its own keys", () => {
    const root = fixture();
    const xml = output(root, `${RES}/values/strings.xml`);
    expect(xml).toContain(`name="notification_channel_messages_name"`);
    expect(xml).not.toContain(`name="link_open_in_app"`);
    const ios = JSON.parse(output(root, XCSTRINGS)).strings;
    expect(Object.keys(ios)).toContain("push_fallback_body");
    expect(Object.keys(ios)).not.toContain("notification_channel_messages_name");
    expect(Object.keys(ios)).not.toContain("link_open_in_app");
    const ts = output(root, "backend/src/brand.gen.ts");
    expect(ts).toContain("push_fallback_body:");
    expect(ts).not.toContain("send:");
    const web = output(root, `${WEB}/strings.ts`);
    expect(web).toContain("app_name:");
    expect(web).not.toContain("push_fallback_body:");
  });

  it("hands Xcode the frozen ids, with an empty team while it is null", () => {
    const ids = readJson("identifiers/ids.json");
    const xcconfig = output(ROOT, "ios/Generated/Ids.xcconfig");
    expect(xcconfig).toContain(`SPJALL_BUNDLE_ID = ${ids.store.iosBundleId}\n`);
    expect(xcconfig).toContain(`SPJALL_APP_GROUP = ${ids.store.appGroup}\n`);
    const root = fixture();
    editJson(root, "identifiers/ids.json", (i) => {
      i.services.appleTeamId = null;
    });
    expect(output(root, "ios/Generated/Ids.xcconfig")).toContain("DEVELOPMENT_TEAM = \n");
    editJson(root, "identifiers/ids.json", (i) => {
      i.services.appleTeamId = "ABCDE12345";
    });
    expect(output(root, "ios/Generated/Ids.xcconfig")).toContain("DEVELOPMENT_TEAM = ABCDE12345\n");
  });

  it("gives the Interim configuration the interim ids and team, never the frozen ones", () => {
    const ids = readJson("identifiers/ids.json");
    const interim = output(ROOT, "ios/Generated/IdsInterim.xcconfig");
    expect(interim).toContain(`SPJALL_BUNDLE_ID = ${ids.appleInterim.iosBundleId}\n`);
    expect(interim).toContain(
      `SPJALL_NSE_BUNDLE_ID = ${ids.appleInterim.iosNotificationServiceBundleId}\n`,
    );
    expect(interim).toContain(`SPJALL_APP_GROUP = ${ids.appleInterim.appGroup}\n`);
    expect(interim).toContain(`DEVELOPMENT_TEAM = ${ids.appleInterim.teamId}\n`);
    expect(interim).not.toContain(`= ${ids.store.iosBundleId}\n`);
    const plist = output(ROOT, "ios/Generated/ExportOptions.Interim.plist");
    expect(plist).toContain(`<string>${ids.appleInterim.teamId}</string>`);
    expect(plist).toContain(`<key>${ids.appleInterim.iosBundleId}</key>`);
    expect(plist).toContain(`<key>${ids.appleInterim.iosNotificationServiceBundleId}</key>`);
  });

  it("writes no Interim files when there is no interim team", () => {
    const root = fixture();
    editJson(root, "identifiers/ids.json", (i) => {
      i.appleInterim = null;
    });
    const paths = generate(BRAND, root).files.map((f) => f.path);
    expect(paths).not.toContain("ios/Generated/IdsInterim.xcconfig");
    expect(paths).not.toContain("ios/Generated/ExportOptions.Interim.plist");
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
    const border = JSON.parse(
      output(root, "ios/Generated/Assets.xcassets/Brand/border.colorset/Contents.json"),
    );
    expect(border.colors[0].color.components.alpha).toBe((46 / 255).toFixed(3));
  });

  it("emits every colour in both modes on both platforms", () => {
    const root = fixture();
    editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
      t.dark.surface.$value = { colorSpace: "oklch", components: [0, 0, 0] };
    });
    const out = generated(root);
    const kotlin = out(KOTLIN);
    const block = (/** @type {string} */ name) =>
      new RegExp(`object ${name} \\{([^}]*)\\}`).exec(kotlin)?.[1] ?? "";
    const keys = (/** @type {string} */ text) =>
      [...text.matchAll(/const val (\w+):/g)].map((m) => m[1]);
    expect(keys(block("DarkColors"))).toEqual(keys(block("Colors")));
    expect(block("DarkColors")).toContain("const val SURFACE: Long = 0xFF000000L");
    expect(out(`${RES}/values-night/themes.xml`)).toContain(
      '<item name="android:windowBackground">#FF000000</item>',
    );
    expect(out(`${RES}/values-night/themes.xml`)).toContain("Theme.Material.NoActionBar");
    expect(out(`${RES}/values/themes.xml`)).toContain("Theme.Material.Light.NoActionBar");

    const swift = out("ios/Generated/BrandTokens.swift");
    const names = [...swift.matchAll(/Color\("Brand\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const set = JSON.parse(
        out(`ios/Generated/Assets.xcassets/Brand/${name}.colorset/Contents.json`),
      );
      expect(set.colors.map((/** @type {any} */ c) => c.appearances?.[0]?.value ?? "any")).toEqual([
        "any",
        "dark",
      ]);
    }
    const surface = JSON.parse(
      out("ios/Generated/Assets.xcassets/Brand/surface.colorset/Contents.json"),
    );
    expect(surface.colors[1].color.components).toMatchObject({ red: "0x00", green: "0x00" });
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
    const night = join(root, RES, "values-night/themes.xml");
    writeFileSync(night, readFileSync(night, "utf8").replace("#FF", "#EE"));
    writeFileSync(join(root, RES, "values/extra.xml"), "<resources/>\n");
    expect(run({ name: BRAND, check: true, root }).stale).toEqual([
      `${RES}/values-night/themes.xml`,
      `${RES}/values/strings.xml`,
      `${RES}/values/extra.xml (not generated)`,
    ]);
    run({ name: BRAND, check: false, root });
    expect(existsSync(join(root, RES, "values/extra.xml"))).toBe(false);
  });

  it("--check fails when a token changes and the web theme was not regenerated", () => {
    const root = fixture();
    run({ name: BRAND, check: false, root });
    editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
      t.radius.md.$value = { value: 7, unit: "px" };
    });
    expect(run({ name: BRAND, check: true, root }).stale).toContain(`${WEB}/theme.css`);
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
      cpSync(join(root, "brand", BRAND), join(root, "brand", "_drill"), {
        recursive: true,
      });
      expect(activeBrand(root)).toBe(BRAND);
      cpSync(join(root, "brand", BRAND), join(root, "brand", "second"), {
        recursive: true,
      });
      expect(() => activeBrand(root)).toThrow(/set BRAND/);
    } finally {
      if (saved !== undefined) process.env.BRAND = saved;
    }
  });

  it("bundles each font byte for byte in the apps and as WOFF2 on the web, with its licence", () => {
    const manifest = readJson(`brand/${BRAND}/brand.json`);
    const files = generate(BRAND).files;
    /** @param {string} path */
    const bytes = (path) => files.find((f) => f.path === path)?.content;
    for (const font of manifest.fonts ?? []) {
      const source = readFileSync(join(ROOT, "brand", BRAND, font.file));
      const android = bytes(`${RES}/font/${fontResource(font)}.ttf`);
      const ios = bytes(`ios/Generated/Fonts/${font.file.split("/").pop()}`);
      expect(Buffer.isBuffer(android) && source.equals(android)).toBe(true);
      expect(Buffer.isBuffer(ios) && source.equals(ios)).toBe(true);
      const license = readFileSync(join(ROOT, "brand", BRAND, font.license), "utf8").trimEnd();
      expect(bytes(`${RES}/raw/font_licenses.txt`)?.toString()).toContain(license);
      expect(output(ROOT, KOTLIN)).toContain(`R.font.${fontResource(font)} to ${font.weight}`);
      const name = font.file
        .split("/")
        .pop()
        .replace(/\.ttf$/, ".woff2");
      const web = bytes(`${WEB}/fonts/${name}`);
      // A WOFF2 of the same font: the signature, the source's flavour and
      // table count, and fewer bytes than the TTF.
      expect(Buffer.isBuffer(web)).toBe(true);
      const woff = /** @type {Buffer} */ (web);
      expect(woff.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(woff.readUInt32BE(4)).toBe(source.readUInt32BE(0));
      expect(woff.readUInt16BE(12)).toBe(source.readUInt16BE(4));
      expect(woff.length).toBeLessThan(source.length * 0.4);
      expect(output(ROOT, `${WEB}/theme.css`)).toContain(`url("./fonts/${name}") format("woff2")`);
      const webLicense = bytes(`${WEB}/fonts/${font.license.split("/").pop()}`)?.toString();
      expect(webLicense).toContain(license);
    }
  });

  it("makes the primary colour the iOS accent, in both modes", () => {
    const set = (/** @type {string} */ name) =>
      JSON.parse(output(ROOT, `ios/Generated/Assets.xcassets/${name}.colorset/Contents.json`));
    expect(set("AccentColor")).toEqual(set("Brand/primary"));
  });

  it("lists each iOS face by file, PostScript name and weight", () => {
    const manifest = readJson(`brand/${BRAND}/brand.json`);
    const swift = output(ROOT, "ios/Generated/BrandTokens.swift");
    for (const font of manifest.fonts ?? []) {
      const bytes = readFileSync(join(ROOT, "brand", BRAND, font.file));
      const name = postScriptName(bytes);
      // A PostScript name is printable ASCII without spaces.
      expect(name).toMatch(/^[\x21-\x7e]{1,63}$/);
      expect(swift).toContain(`("${font.file.split("/").pop()}", "${name}", ${font.weight}),`);
    }
    expect(() => postScriptName(Buffer.alloc(12))).toThrow(/no name table/);
  });

  it("refuses a font whose family is not a token or whose file is missing", () => {
    const root = fixture();
    editJson(root, `brand/${BRAND}/brand.json`, (m) => {
      m.fonts = [
        {
          family: "nope",
          weight: 400,
          file: "assets/fonts/A.ttf",
          license: "assets/fonts/A.txt",
          source: "x",
        },
      ];
    });
    const { problems } = generate(BRAND, root);
    expect(problems).toContain('fonts assets/fonts/A.ttf: family "nope" is not a font token');
    expect(problems).toContain("fonts assets/fonts/A.ttf: missing");
    expect(problems).toContain("fonts assets/fonts/A.txt: missing");
  });

  it("emits type, radius and spacing tokens for every platform", () => {
    const root = fixture();
    editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
      t.type["screen-title"].$value.fontSize = { value: 31, unit: "px" };
      t.type["section-label"].$value.letterSpacing = { value: 0.2, unit: "em" };
    });
    const out = generated(root);
    const kotlin = out(KOTLIN);
    expect(kotlin).toMatch(
      /object Type \{[\s\S]*val SCREEN_TITLE = Style\("headline", 800, 31f, 32f, null\)/,
    );
    expect(kotlin).toContain('val SECTION_LABEL = Style("sans", 900, 10f, null, 0.2f)');
    expect(kotlin).toContain("const val POST_BUBBLE_DP: Int = 16");
    expect(kotlin).toContain("const val SPACE_2_DP: Int = 2");
    const swift = out("ios/Generated/BrandTokens.swift");
    expect(swift).toContain(
      'static let screenTitle = Style(family: "headline", weight: 800, size: 31, lineHeight: 32, tracking: 0)',
    );
    expect(swift).toContain("tracking: 2)"); // 0.2em of 10pt, in points
    expect(swift).toContain("static let postBubble: CGFloat = 16");
    expect(swift).toContain("static let space2: CGFloat = 2");
    const theme = out(`${WEB}/theme.css`);
    expect(theme).toContain("--text-screen-title: 31px;");
    expect(theme).toContain("--text-screen-title--line-height: 32px;");
    expect(theme).toContain("--text-screen-title--font-weight: 800;");
    expect(theme).toContain("--text-section-label--letter-spacing: 0.2em;");
    expect(theme).not.toContain("--text-section-label--line-height");
    expect(theme).not.toContain("--text-*: initial");
    expect(theme).toContain("--radius-card: 14px;");
    expect(theme).not.toContain("--spacing");
  });

  it("refuses a type or spacing token in the wrong unit", () => {
    for (const edit of [
      (/** @type {any} */ t) => (t.type.bubble.$value.fontSize.unit = "rem"),
      (/** @type {any} */ t) => (t.type.bubble.$value.lineHeight.unit = "em"),
      (/** @type {any} */ t) => (t.spacing["space-4"].$value.unit = "rem"),
    ]) {
      const root = fixture();
      editJson(root, `brand/${BRAND}/tokens.json`, edit);
      expect(generate(BRAND, root).problems.join()).toMatch(/unit/);
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
