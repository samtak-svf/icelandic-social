// @ts-check
// What brand-gen owns, and which brand is active.
//
// An owned directory holds nothing but generated files: brand-gen deletes
// anything else in it on write and --check fails on it, so a file a previous
// brand produced cannot survive a switch. tooling/brand-leak-guard.mjs lets
// the ACTIVE brand's name appear in owned paths and nowhere else.

import { brandNames, ROOT } from "../repo.mjs";

/** Directories brand-gen writes in full. */
export const OWNED_DIRS = ["android/core/brand/src/main/res", "ios/Generated"];

/** Single files brand-gen writes inside directories it does not own. */
const OWNED_FILES = [
  "android/core/brand/src/main/kotlin/samtak/spjall/brand/BrandTokens.kt",
  "backend/src/brand.gen.ts",
];

/** @param {string} file repo-relative */
export function isOwned(file) {
  return OWNED_FILES.includes(file) || OWNED_DIRS.some((dir) => file.startsWith(`${dir}/`));
}

/**
 * The brand the apps are built from: `BRAND` when set, else the only brand
 * under brand/ that is not generated (a leading `_`, like the rename drill's
 * _fixture). Code may not name a brand, so there is no hardcoded default;
 * with two real brands present, as mid-rename, BRAND must be set.
 *
 * @param {string} [root]
 */
export function activeBrand(root = ROOT) {
  if (process.env.BRAND) return process.env.BRAND;
  const real = brandNames(root).filter((name) => !name.startsWith("_"));
  if (real.length !== 1)
    throw new Error(`${real.length} brands under brand/ (${real.join(", ")}); set BRAND`);
  return /** @type {string} */ (real[0]);
}
