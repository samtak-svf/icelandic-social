// @ts-check
// The page's own limits, checked before anything is handed over: a token file the page would
// drop part of is worse than one that fails here with the reason named.

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/;
const PX = /^\d+(\.\d+)?px$/;
const STACK_FORBIDDEN = /[;{}<>\\()]/;
const MAX = { colors: 600, other: 60, usage: 1000, families: 12, styles: 80, stack: 200 };

/** The caps of one publish: files and bytes. */
const PUBLISH = { files: 255, bytes: 16 * 1024 * 1024 };

/**
 * @param {string} family
 * @param {any} token
 * @param {Set<string>} seen names already taken, across every family
 * @returns {string[]}
 */
function checkNamed(family, token, seen) {
  const name = String(token?.name);
  /** @type {string[]} */
  const problems = [];
  if (!NAME.test(name)) problems.push(`${family}: name "${name}" does not match ${NAME}`);
  else if (seen.has(name)) problems.push(`${family}: duplicate name "${name}"`);
  seen.add(name);
  if (String(token?.usage ?? "").length > MAX.usage)
    problems.push(`${family} ${name}: usage is over ${MAX.usage} characters`);
  return problems;
}

/**
 * @param {any} list
 * @param {Set<string>} seen
 * @returns {string[]}
 */
function checkColors(list, seen) {
  /** @type {string[]} */
  const problems = [];
  if (list.length > MAX.colors) problems.push(`color: ${list.length} tokens, cap ${MAX.colors}`);
  for (const token of list) {
    problems.push(...checkNamed("color", token, seen));
    for (const mode of ["light", "dark"]) {
      const value = token?.value?.[mode];
      if (value === undefined) problems.push(`color ${token?.name}: no ${mode} value`);
      else if (!HEX.test(String(value)))
        problems.push(
          `color ${token?.name}: ${mode} value "${value}" is not a lowercase hex colour`,
        );
    }
  }
  return problems;
}

/**
 * @param {string} family
 * @param {any} list
 * @param {Set<string>} seen
 * @returns {string[]}
 */
function checkScale(family, list, seen) {
  /** @type {string[]} */
  const problems = [];
  if (list.length > MAX.other) problems.push(`${family}: ${list.length} tokens, cap ${MAX.other}`);
  for (const token of list) {
    problems.push(...checkNamed(family, token, seen));
    if (!PX.test(String(token?.value)))
      problems.push(`${family} ${token?.name}: value "${token?.value}" is not a px length`);
  }
  return problems;
}

/**
 * @param {any} type
 * @returns {string[]}
 */
function checkType(type) {
  /** @type {string[]} */
  const problems = [];
  const stacks = Object.entries(type?.families ?? {});
  if (stacks.length > MAX.families)
    problems.push(`type: ${stacks.length} families, cap ${MAX.families}`);
  for (const [key, stack] of stacks) {
    const text = String(stack);
    if (text.length > MAX.stack || STACK_FORBIDDEN.test(text))
      problems.push(
        `type family ${key}: stack "${text}" is over ${MAX.stack} characters or has one of ; { } < > \\ ( )`,
      );
  }
  const styles = (type?.groups ?? []).flatMap((/** @type {any} */ g) => g.styles ?? []);
  if (styles.length > MAX.styles) problems.push(`type: ${styles.length} styles, cap ${MAX.styles}`);
  for (const style of styles)
    if (String(style?.usage ?? "").length > MAX.usage)
      problems.push(`type ${style?.name}: usage is over ${MAX.usage} characters`);
  return problems;
}

/**
 * @param {any} tokens a tokens.json
 * @returns {string[]} one sentence per problem, empty when the file is sound
 */
export function validateTokens(tokens) {
  const seen = new Set();
  return [
    ...checkColors(tokens.color?.tokens ?? [], seen),
    ...checkScale("spacing", tokens.spacing?.tokens ?? [], seen),
    ...checkScale("radius", tokens.radius?.tokens ?? [], seen),
    ...checkType(tokens.type),
  ];
}

/**
 * The publish manifest of a set of files, and the reasons it must not be published.
 *
 * @param {Array<{ path: string, content: string | Buffer }>} files
 * @returns {{ json: { files: Record<string, string>, count: number, bytes: number }, problems: string[] }}
 */
export function publishManifest(files) {
  const bytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
  /** @type {string[]} */
  const problems = [];
  if (files.length > PUBLISH.files)
    problems.push(`${files.length} files is over the ${PUBLISH.files} one publish may carry`);
  if (bytes > PUBLISH.bytes) problems.push(`${bytes} bytes is over the 16 MiB a publish may carry`);
  return {
    json: {
      files: Object.fromEntries(files.map((f) => [f.path, f.path])),
      count: files.length,
      bytes,
    },
    problems,
  };
}
