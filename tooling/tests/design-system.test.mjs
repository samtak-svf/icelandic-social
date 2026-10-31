// @ts-check
// The design-system export (docs/design-system.md): every claim the page makes is
// measured from the brand or from source text. Runs on the first committed brand and on a
// fixture brand under another name, so no brand text appears here.
import { describe, expect, it } from "vitest";
import { loadBrand } from "../brand-gen.mjs";
import { brandColors, hex, radii, spacing, typeStyles } from "../lib/brand-gen/color.mjs";
import { designSystem } from "../lib/brand-gen/design-system.mjs";
import { adHocSizes, wiredStatus } from "../lib/design-system/scan.mjs";
import { publishManifest, validateTokens } from "../lib/design-system/validate.mjs";
import { brandNames, readJson } from "../lib/repo.mjs";

const NAME = brandNames()[0] ?? "";
const brand = loadBrand(NAME);
const pairs = readJson("brand/contrast-pairs.json");
const AT = "2026-10-31T12:00:00Z";

/** @type {import("../lib/design-system/scan.mjs").Scan} */
const EMPTY_SCAN = {
  wired: { radius: {}, type: {}, spacing: {} },
  inventory: { "web/src/ui": ["a.tsx"] },
  adHoc: { android: [{ value: "14.5", count: 4 }], ios: [], web: [], semibold: 3 },
};

/**
 * @param {Partial<Parameters<typeof designSystem>[0]>} [over]
 */
function build(over = {}) {
  return designSystem({
    brand,
    pairs,
    scan: EMPTY_SCAN,
    sha: "0123456789abcdef0123456789abcdef01234567",
    tokensSha256: "f".repeat(64),
    at: AT,
    by: "design-system export",
    ...over,
  });
}

const built = build();
/** @param {string} path */
const text = (path) => {
  const file = built.files.find((f) => f.path === `project/${path}`);
  if (!file) throw new Error(`${path} not generated`);
  return file.content.toString();
};
const tokens = () => JSON.parse(text("tokens.json"));

describe("design system tokens", () => {
  it("passes its own validation", () => {
    expect(built.problems).toEqual([]);
  });

  it("carries every colour in both themes, as the generator resolves it", () => {
    const light = brandColors(brand.tokens);
    const dark = brandColors(brand.tokens, "dark");
    const out = tokens().color.tokens;
    expect(out.map((/** @type {any} */ t) => t.name)).toEqual(light.map((c) => c.name));
    light.forEach((c, i) => {
      expect(out[i].value).toEqual({ light: hex(c), dark: hex(/** @type {any} */ (dark[i])) });
      expect(out[i].usage.length).toBeGreaterThan(0);
    });
    expect(tokens().color.themes.map((/** @type {any} */ t) => t.id)).toEqual(["light", "dark"]);
  });

  it("carries the radius, spacing and type scales with their values", () => {
    const t = tokens();
    expect(t.radius.tokens).toEqual(
      radii(brand.tokens).map((r) =>
        expect.objectContaining({ name: `radius-${r.name}`, value: `${r.value}px` }),
      ),
    );
    expect(t.spacing.tokens).toEqual(
      spacing(brand.tokens).map((s) =>
        expect.objectContaining({ name: s.name, value: `${s.value}px` }),
      ),
    );
    const styles = t.type.groups.flatMap((/** @type {any} */ g) => g.styles);
    for (const s of typeStyles(brand.tokens)) {
      const got = styles.find((/** @type {any} */ x) => x.name === s.name);
      expect(got).toBeDefined();
      expect(got.fontSize).toBe(`${s.size}px`);
      expect(got.fontWeight).toBe(s.weight);
      expect(got.lineHeight).toBe(s.lineHeight === undefined ? undefined : `${s.lineHeight}px`);
      expect(got.letterSpacing).toBe(
        s.letterSpacing === undefined ? undefined : `${s.letterSpacing}em`,
      );
    }
    expect(t.meta.source).toEqual({
      commit: "0123456789abcdef0123456789abcdef01234567",
      tokensSha256: "f".repeat(64),
    });
  });

  it("names the ground each text colour reads on, per mode", () => {
    const fg = tokens().color.tokens.find((/** @type {any} */ t) => t.name === "fg");
    expect(fg.usage).toMatch(/surface/);
    expect(fg.usage).toMatch(/light/i);
  });

  it("writes tokens.css with the exact first line and every block", () => {
    const css = text("tokens.css");
    expect(css.split("\n")[0]).toBe(
      `/* ${brand.manifest.displayName} design system — generated from tokens.json */`,
    );
    expect(css).toContain(':root, [data-theme="light"] {');
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain("@font-face {");
    expect(css).toMatch(/--radius-[a-z-]+: \d+px;/);
    expect(css).toMatch(/--space-2|--space-/);
  });

  it("is kept in code and never claims to be a CI write", () => {
    const index = JSON.parse(text("design-system.json"));
    expect(index.editing).toBe("code");
    expect(index.v).toBe(3);
    expect(index.layout).toBe("files");
    expect(index.lastChange.via.startsWith("CI")).toBe(false);
    expect(index.lastChange.at).toBe(AT);
    expect(index.assetGroups.Logos.order).toEqual([]);
    expect(index.groups).toEqual(["Logos"]);
  });

  it("files the icon under Logos when given a blob id", () => {
    const withIcon = build({ iconBlob: "abc123" });
    const file = withIcon.files.find((f) => f.path === "project/design-system.json");
    const index = JSON.parse(String(file?.content));
    const [key] = index.assetGroups.Logos.order;
    // A record is named by its path below the group's folder, and so is its key.
    expect(key).not.toContain("/");
    expect(index.assetGroups.Logos.files[key]).toMatchObject({
      name: key,
      blob: "abc123",
      type: "image/svg+xml",
    });
    expect(index.assetGroups.Logos.files[key].size).toBe(Buffer.byteLength(brand.iconSvg));
  });
});

describe("design system self-validation", () => {
  /** @param {(t: any) => void} mutate */
  const problemsAfter = (mutate) => {
    const t = tokens();
    mutate(t);
    return validateTokens(t);
  };

  it("accepts the untouched tokens", () => {
    expect(validateTokens(tokens())).toEqual([]);
  });

  it("refuses a bad name", () => {
    expect(problemsAfter((t) => (t.color.tokens[0].name = "-bad name"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/name/)]),
    );
  });

  it("refuses a duplicate name across families", () => {
    expect(problemsAfter((t) => (t.spacing.tokens[0].name = t.color.tokens[0].name))).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate/)]),
    );
  });

  it("refuses a named colour, a var() and an alias", () => {
    for (const bad of ["red", "var(--x)", "{fg}", "color-mix(in srgb, red, blue)"]) {
      expect(problemsAfter((t) => (t.color.tokens[1].value.dark = bad))).toEqual(
        expect.arrayContaining([expect.stringMatching(/colou?r/)]),
      );
    }
  });

  it("refuses a colour with no dark value", () => {
    expect(problemsAfter((t) => delete t.color.tokens[2].value.dark)).toEqual(
      expect.arrayContaining([expect.stringMatching(/dark/)]),
    );
  });

  it("refuses a family stack with a forbidden character and a usage over the cap", () => {
    expect(problemsAfter((t) => (t.type.families.sans = "A; B"))).not.toEqual([]);
    expect(problemsAfter((t) => (t.color.tokens[0].usage = "x".repeat(1001)))).not.toEqual([]);
  });

  it("refuses an output with no dark theme file list problem, and over-cap publishes", () => {
    const many = Array.from({ length: 256 }, (_, i) => ({ path: `project/f${i}`, content: "x" }));
    expect(publishManifest(many).problems).toEqual(
      expect.arrayContaining([expect.stringMatching(/256/)]),
    );
    const big = [{ path: "project/big", content: Buffer.alloc(16 * 1024 * 1024 + 1) }];
    expect(publishManifest(big).problems).not.toEqual([]);
    const ok = publishManifest(built.files);
    expect(ok.problems).toEqual([]);
    expect(ok.json.count).toBe(built.files.length);
    expect(Object.keys(ok.json.files)).toHaveLength(built.files.length);
    expect(ok.json.files["project/tokens.json"]).toBe("project/tokens.json");
  });
});

describe("design system from input only", () => {
  it("names the brand only as the input says, never from the code", () => {
    const stems = /** @type {string[]} */ (brand.manifest.leakTerms.stems);
    const other = build({
      brand: {
        ...brand,
        name: "zeta",
        manifest: { ...brand.manifest, name: "zeta", displayName: "Zeta Quill" },
      },
    });
    expect(other.problems).toEqual([]);
    for (const file of other.files) {
      if (/\.(woff2)$/.test(file.path)) continue;
      const body = file.content.toString();
      for (const stem of stems) expect(body.toLowerCase(), file.path).not.toContain(stem);
    }
    const cover = String(other.files.find((f) => f.path.endsWith("Cover/preview.html"))?.content);
    expect(cover).toContain("Zeta Quill");
  });
});

describe("README", () => {
  const readme = () => text("README.md");

  it("has no title, one read-only sentence, and the generated sections", () => {
    const md = readme();
    expect(md.startsWith("#")).toBe(false);
    expect(md).toContain(brand.manifest.displayName);
    expect(md).toMatch(/read-only/);
    for (const heading of ["## Contrast", "## Wired status", "## Components", "## Ad hoc sizes"])
      expect(md).toContain(heading);
    expect(md).toContain("Component previews are not on this page yet");
  });

  it("keeps a contrast row for every pair and mode, and flags a failure", () => {
    const md = readme();
    expect(md).toMatch(/\| `fg` on `surface`/);
    const failing = build({
      brand: {
        ...brand,
        tokens: {
          ...brand.tokens,
          color: { ...brand.tokens.color, fg: { $value: "{color.surface}" } },
        },
      },
    });
    const failMd = String(failing.files.find((f) => f.path === "project/README.md")?.content);
    expect(failMd).toMatch(/FAIL/);
  });

  it("stays within the section cap", () => {
    const sections = built.files.filter(
      (f) => /\.mdx?$/.test(f.path) && !f.path.includes("components/"),
    );
    expect(sections.length).toBeLessThanOrEqual(24);
  });
});

describe("cover", () => {
  const cover = () => text("components/Cover/preview.html");

  it("follows the contract: marker, one svg, token-bound shapes, no motion", () => {
    const html = cover();
    expect(html.split("\n")[0]).toMatch(/^<!-- @dsCard height=(\d+) -->$/);
    const height = Number(/height=(\d+)/.exec(html)?.[1]);
    expect(height).toBeGreaterThanOrEqual(240);
    expect(height).toBeLessThanOrEqual(360);
    expect(html.match(/<svg\b/g)).toHaveLength(1);
    expect(html).not.toMatch(
      /@media|@container|gradient|<image|<img|animation|transition|\bvw\b|cqw/,
    );
    expect(html).not.toMatch(/(fill|stroke)="/);
    expect(html).toContain("<!--");
    expect(html).toContain(brand.manifest.displayName);
    expect(html).toMatch(/var\(--radius-/);
  });

  it("keeps every block and unit right of x = 480, and counts a pattern of 12 to 60", () => {
    const html = cover();
    const xs = [...html.matchAll(/<rect[^>]*\bx="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(480);
    const units = [...html.matchAll(/class="dot"/g)].length;
    expect(units).toBeGreaterThanOrEqual(12);
    expect(units).toBeLessThanOrEqual(60);
    const blocks = [...html.matchAll(/class="block /g)].length;
    expect(blocks).toBeGreaterThanOrEqual(3);
    expect(blocks).toBeLessThanOrEqual(5);
  });
});

describe("source scan", () => {
  it("reads a token as wired only where a platform's reader names it", () => {
    const wired = wiredStatus(
      {
        radius: ["card", "pill", "pill-lg"],
        type: ["bubble", "screen-title"],
        spacing: ["space-4"],
      },
      {
        android:
          "val a = BrandTokens.Radius.CARD_DP; val b = BrandTokens.Radius.PILL_LG_DP; BrandTokens.Type.BUBBLE; BrandTokens.Spacing.SPACE_4_DP",
        ios: "BrandTokens.Radius.card BrandTokens.Typography.screenTitle",
        web: 'className="rounded-t-pill md:rounded-card text-bubble"',
      },
    );
    expect(wired.radius["card"]).toEqual({ android: true, ios: true, web: true });
    expect(wired.radius["pill"]).toEqual({ android: false, ios: false, web: true });
    expect(wired.radius["pill-lg"]).toEqual({ android: true, ios: false, web: false });
    expect(wired.type["bubble"]).toEqual({ android: true, ios: false, web: true });
    expect(wired.type["screen-title"]).toEqual({ android: false, ios: true, web: false });
    expect(wired.spacing["space-4"]).toEqual({ android: true, ios: false, web: null });
  });

  it("counts literal sizes per value", () => {
    const sizes = adHocSizes({
      android: "fontSize = 14.5.sp, 14.5.sp, 18.sp",
      ios: "Font.sans(10, .black) .headline(30) Font.sans(10)",
      web: 'class="text-sm text-[13px] text-sm font-semibold text-xl"',
    });
    expect(sizes.android).toEqual([
      { value: "14.5", count: 2 },
      { value: "18", count: 1 },
    ]);
    expect(sizes.ios).toEqual([
      { value: "10", count: 2 },
      { value: "30", count: 1 },
    ]);
    expect(sizes.web).toEqual([
      { value: "text-sm", count: 2 },
      { value: "text-[13px]", count: 1 },
      { value: "text-xl", count: 1 },
    ]);
    expect(sizes.semibold).toBe(1);
  });
});
