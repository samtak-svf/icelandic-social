// @ts-check
// Shared by the platform emitters: which keys a surface gets, and how a
// `{name}` placeholder becomes a positional format specifier.

/**
 * @typedef {{ surfaces: string[], description: string, placeholders?: Record<string, string>, plural?: boolean }} ContractKey
 * @typedef {{ keys: Record<string, ContractKey> }} Contract
 * @typedef {string | Record<string, string>} StringValue
 */

/**
 * The keys a surface gets, in contract order.
 *
 * @param {Contract} contract
 * @param {string} surface
 * @returns {Array<[string, ContractKey]>}
 */
export function keysFor(contract, surface) {
  return Object.entries(contract.keys).filter(([, spec]) => spec.surfaces.includes(surface));
}

/**
 * Replaces each `{name}` with the positional specifier for its declared type.
 * Position is the order the contract declares the placeholders in, so every
 * brand's sentence may put them in any order. When the result will be passed
 * through a formatter, a literal `%` is doubled.
 *
 * @param {string} text
 * @param {ContractKey} spec
 * @param {(position: number, type: string) => string} specifier
 */
export function positional(text, spec, specifier) {
  const names = Object.keys(spec.placeholders ?? {});
  if (names.length === 0 && !spec.plural) return text;
  return text.replaceAll("%", "%%").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`placeholder {${name}} is not declared`);
    return specifier(index + 1, spec.placeholders?.[name] ?? "string");
  });
}

/**
 * `bubble-own-bg` → `bubbleOwnBg`.
 *
 * @param {string} name
 */
export function camel(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Everything an emitter reads, loaded once by tooling/brand-gen.mjs.
 *
 * @typedef {{
 *   name: string,
 *   manifest: any,
 *   strings: Record<string, StringValue>,
 *   contract: Contract,
 *   tokens: any,
 *   ids: any,
 *   iconSvg: string,
 * }} BrandInput
 * @typedef {{ path: string, content: string | Buffer }} OutputFile
 */
