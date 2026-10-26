// @ts-check
// Emits the web's API client from api/openapi.json (decision 0005): one
// TypeScript type per component schema and one function per operation a
// browser can call, typed end to end. The functions go through
// web/src/api/call.ts, which owns the fetch itself.
//
// openapi-typescript prints through the TypeScript 5 compiler API, which
// TypeScript 7 no longer has, and the spec uses a small part of OpenAPI. So
// the web gets this emitter instead.
//
// `node tooling/web-api.mjs`          write the TypeScript file
// `node tooling/web-api.mjs --check`  fail when it is stale (CI, pre-push)
//
// Only the schema keywords below are understood. Anything else fails loudly,
// so a richer schema means extending this file, not a silent `unknown`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJson, ROOT } from "./lib/repo.mjs";

const SPEC = "api/openapi.json";
export const OUTPUT = "web/src/generated/api.ts";

/**
 * The placing rule of decision 0086 has one source, the backend's pure module,
 * and the web gets it as a generated file: the module's zod schemas stay out
 * (between its `@web-omit` markers), and `Framing` is the contract's type.
 */
const FRAMES_SOURCE = "backend/src/api/image-frames.ts";
export const FRAMES_OUTPUT = "web/src/generated/frames.ts";

/**
 * The window size classes of `x-size-classes` (decision 0087) as Tailwind
 * breakpoints, so a class reads `medium:` or `expanded:` and no stylesheet
 * types the widths by hand.
 */
export const SIZE_CLASSES_OUTPUT = "web/src/generated/size-classes.css";

/** What a browser holds: the session cookie, or no credential at all. */
const WEB_SCHEME = "session";

/** Public operations a browser still never calls. */
const NATIVE_ONLY = new Set([
  // It makes a messaging device, which a browser is not (decision 0061).
  "registerDevice",
]);

/** Keywords that only validate or describe, and change no type. */
const IGNORED = new Set([
  "description",
  "example",
  "default",
  "deprecated",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "discriminator",
]);
const UNDERSTOOD = new Set([
  ...IGNORED,
  "$ref",
  "type",
  "enum",
  "properties",
  "required",
  "items",
  "oneOf",
  "anyOf",
  "allOf",
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const METHODS = ["get", "put", "post", "delete", "patch"];

/** @param {string} text */
function quote(text) {
  return JSON.stringify(text);
}

/** @param {string} name */
function key(name) {
  return IDENTIFIER.test(name) ? name : quote(name);
}

/**
 * A JSDoc block, or nothing.
 *
 * @param {string | undefined} text
 * @param {string} indent
 * @param {boolean} [deprecated]
 */
function doc(text, indent, deprecated = false) {
  const lines = [...(text ? text.replaceAll("*/", "*&#47;").split("\n") : [])];
  if (deprecated) lines.push("@deprecated");
  if (lines.length === 0) return "";
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

/**
 * Whether a schema only describes, and adds no type.
 *
 * @param {any} schema
 */
function annotation(schema) {
  return Object.keys(schema).every((k) => IGNORED.has(k));
}

/**
 * A property's description, also when it sits in an `allOf` beside a $ref.
 *
 * @param {any} schema
 * @returns {string | undefined}
 */
function description(schema) {
  return schema.description ?? schema.allOf?.find(annotation)?.description;
}

/**
 * A schema as a TypeScript type.
 *
 * @param {any} schema
 * @param {string} where for the error message
 * @param {string} indent of the line the type starts on
 * @returns {string}
 */
export function tsType(schema, where, indent = "") {
  const unknown = Object.keys(schema).filter((k) => !UNDERSTOOD.has(k));
  if (unknown.length > 0) {
    throw new Error(`${where}: unsupported ${unknown.join(", ")} (see tooling/web-api.mjs)`);
  }
  if (schema.$ref) {
    if (!String(schema.$ref).startsWith("#/components/schemas/")) {
      throw new Error(`${where}: unsupported $ref ${schema.$ref}`);
    }
    return String(schema.$ref).slice("#/components/schemas/".length);
  }
  // A union, and a nullable $ref, which zod-openapi writes as anyOf with null.
  const union = schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : null;
  if (union)
    return schema[union]
      .map((/** @type {any} */ s, /** @type {number} */ i) =>
        tsType(s, `${where}.${union}[${i}]`, indent),
      )
      .join(" | ");
  if (schema.allOf) {
    // zod-openapi puts a property's own description beside its $ref this way.
    return schema.allOf
      .filter((/** @type {any} */ s) => !annotation(s))
      .map((/** @type {any} */ s, /** @type {number} */ i) =>
        tsType(s, `${where}.allOf[${i}]`, indent),
      )
      .join(" & ");
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const parts = types.map((/** @type {string} */ type) => {
    if (type === "null") return "null";
    if (schema.enum) {
      if (type !== "string") throw new Error(`${where}: an enum must be of strings`);
      return schema.enum
        .filter((/** @type {unknown} */ v) => v !== null)
        .map(quote)
        .join(" | ");
    }
    if (type === "string") return "string";
    if (type === "integer" || type === "number") return "number";
    if (type === "boolean") return "boolean";
    if (type === "array") return `Array<${tsType(schema.items ?? {}, `${where}[]`, indent)}>`;
    if (type === "object") return objectType(schema, where, indent);
    throw new Error(`${where}: unsupported type ${JSON.stringify(schema.type)}`);
  });
  return parts.join(" | ");
}

/**
 * @param {any} schema
 * @param {string} where
 * @param {string} indent
 */
function objectType(schema, where, indent) {
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) return "Record<string, never>";
  const required = new Set(schema.required ?? []);
  const inner = `${indent}  `;
  const lines = properties.map(([name, property]) => {
    const p = /** @type {any} */ (property);
    const optional = required.has(name) ? "" : "?";
    return `${doc(description(p), inner, p.deprecated)}${inner}${key(name)}${optional}: ${tsType(p, `${where}.${name}`, inner)};`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** @param {string} name @param {any} schema */
function declaration(name, schema) {
  if (!IDENTIFIER.test(name)) throw new Error(`${name}: not a TypeScript name`);
  const type = tsType(schema, name);
  const head = doc(schema.description, "", schema.deprecated);
  // Only a plain object is an interface; a union of objects is a type.
  return schema.type === "object"
    ? `${head}export interface ${name} ${type}\n`
    : `${head}export type ${name} = ${type};\n`;
}

/**
 * Whether a browser can call the operation: it accepts the session, or no
 * credential at all, and is not one only an app calls. A WebSocket upgrade
 * (`x-ws-frames`) is not a fetch: the page opens it with `new WebSocket`.
 *
 * @param {any} op
 */
export function forWeb(op) {
  if (NATIVE_ONLY.has(op.operationId) || "x-ws-frames" in op) return false;
  const security = op.security ?? [];
  return (
    security.length === 0 ||
    security.some((/** @type {Record<string, unknown>} */ s) => WEB_SCHEME in s)
  );
}

/**
 * The type of a request or response body by its media type: JSON is its
 * schema, anything else is bytes.
 *
 * @param {Record<string, any>} content
 * @param {string} where
 * @param {"request" | "response"} side
 */
function bodyType(content, where, side) {
  const types = Object.entries(content).map(([media, { schema }]) =>
    media === "application/json"
      ? tsType(schema ?? {}, where, "  ")
      : side === "request"
        ? "Blob | ArrayBuffer"
        : "Blob",
  );
  return [...new Set(types)].join(" | ");
}

/**
 * The fields of an operation's `args`: its path and query parameters and its
 * body, each line indented by two.
 *
 * @param {string} name
 * @param {any} op
 * @returns {string[]}
 */
function argFields(name, op) {
  const parameters = op.parameters ?? [];
  const unhandled = parameters.find((/** @type {any} */ p) => p.in !== "path" && p.in !== "query");
  if (unhandled) throw new Error(`${name}: unsupported parameter in ${unhandled.in}`);
  /** @type {string[]} */
  const args = [];
  for (const where of ["path", "query"]) {
    const params = parameters.filter((/** @type {any} */ p) => p.in === where);
    if (params.length === 0) continue;
    const fields = params.map(
      (/** @type {any} */ p) =>
        `${doc(p.description, "    ")}    ${key(p.name)}${p.required ? "" : "?"}: ${tsType(p.schema ?? {}, `${name}.${p.name}`, "    ")};`,
    );
    const optional = params.every((/** @type {any} */ p) => !p.required);
    args.push(`  ${where}${optional ? "?" : ""}: {\n${fields.join("\n")}\n  };`);
  }
  if (op.requestBody) {
    const optional = op.requestBody.required ? "" : "?";
    args.push(`  body${optional}: ${bodyType(op.requestBody.content, `${name}.body`, "request")};`);
  }
  return args;
}

/**
 * The answers an operation declares, as a union tagged by status.
 *
 * @param {string} name
 * @param {any} op
 */
function results(name, op) {
  return Object.entries(op.responses ?? {}).map(([status, response]) => {
    if (!/^\d{3}$/.test(status)) throw new Error(`${name}: unsupported response ${status}`);
    const content = /** @type {any} */ (response).content;
    const data = content ? bodyType(content, `${name}.${status}`, "response") : "undefined";
    return `  | { status: ${status}; data: ${data} }`;
  });
}

/**
 * @param {string} path
 * @param {string} method
 * @param {any} op
 */
function operation(path, method, op) {
  const name = op.operationId;
  if (!IDENTIFIER.test(name ?? "")) throw new Error(`${method} ${path}: needs an operationId`);
  const args = argFields(name, op);
  const required = args.some((a) => !/^ {2}\w+\?:/.test(a));
  const params = args.length > 0 ? `args${required ? "" : "?"}: {\n${args.join("\n")}\n}, ` : "";
  const media = Object.keys(op.requestBody?.content ?? {})[0];
  const options = media && media !== "application/json" ? `, ${quote(media)}` : "";
  const text = [op.summary, op.description].filter(Boolean).join("\n\n");
  return [
    doc(text || undefined, "", op.deprecated),
    `export function ${name}(${params}init?: CallInit): Promise<\n${results(name, op).join("\n")}\n> {\n`,
    `  return call(${quote(method.toUpperCase())}, ${quote(path)}, ${args.length > 0 ? "args" : "undefined"}, init${options});\n}\n`,
  ].join("");
}

/** @param {any} spec the OpenAPI document */
export function emit(spec) {
  const schemas = Object.entries(spec.components?.schemas ?? {}).map(([name, schema]) =>
    declaration(name, schema),
  );
  const operations = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => /** @type {any} */ (item)[m] && forWeb(/** @type {any} */ (item)[m])).map(
      (m) => operation(path, m, /** @type {any} */ (item)[m]),
    ),
  );
  return [
    `// Generated by tooling/web-api.mjs from ${SPEC}. Do not edit; run\n// \`node tooling/web-api.mjs\` after \`pnpm --filter spjall-backend openapi\`.\n`,
    'import { call, type CallInit } from "../api/call.ts";\n',
    "// The schemas.\n",
    ...schemas,
    "// The operations a browser can call: those that take the session cookie,\n// or no credential and are not an app's alone.\n",
    ...operations,
  ].join("\n");
}

/**
 * The web's copy of the backend's frame module: the source without its
 * `@web-omit` blocks. Fails when the markers do not pair up, so a stray one
 * cannot silently drop code.
 *
 * @param {string} source
 */
export function emitFrames(source) {
  /** @type {string[]} */
  const kept = [];
  let omitting = false;
  for (const line of source.split("\n")) {
    if (line.trim() === "// @web-omit-start") {
      if (omitting) throw new Error(`${FRAMES_SOURCE}: nested @web-omit-start`);
      omitting = true;
    } else if (line.trim() === "// @web-omit-end") {
      if (!omitting) throw new Error(`${FRAMES_SOURCE}: @web-omit-end without a start`);
      omitting = false;
    } else if (!omitting) kept.push(line);
  }
  if (omitting) throw new Error(`${FRAMES_SOURCE}: @web-omit-start without an end`);
  return [
    `// Generated by tooling/web-api.mjs from ${FRAMES_SOURCE}. Do not edit; run`,
    "// `node tooling/web-api.mjs` after changing the backend module.",
    'import type { Framing as Contract } from "./api.ts";',
    "",
    "/** The framing of an image, as the contract gives it. */",
    "export type Framing = NonNullable<Contract>;",
    "",
    ...kept,
  ]
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n");
}

/**
 * The Tailwind theme of the size classes: one `--breakpoint-*` per class that
 * has a lower bound. Fails on a missing or non-increasing table, so a broken
 * contract cannot emit a stylesheet with no breakpoints.
 *
 * @param {any} spec the parsed api/openapi.json
 */
export function emitSizeClasses(spec) {
  const classes = spec?.["x-size-classes"];
  const { medium, expanded } = classes ?? {};
  if (
    !Number.isInteger(medium) ||
    !Number.isInteger(expanded) ||
    !(0 < medium && medium < expanded)
  ) {
    throw new Error(`${SPEC}: x-size-classes needs whole widths with 0 < medium < expanded`);
  }
  return [
    `/* Generated by tooling/web-api.mjs from ${SPEC} x-size-classes. Do not edit; run */`,
    "/* `node tooling/web-api.mjs` after changing SIZE_CLASSES in the backend. */",
    "@theme {",
    `  --breakpoint-medium: ${medium}px;`,
    `  --breakpoint-expanded: ${expanded}px;`,
    "}",
    "",
  ].join("\n");
}

function main() {
  const outputs = [
    { file: OUTPUT, from: SPEC, text: emit(readJson(SPEC)) },
    {
      file: FRAMES_OUTPUT,
      from: FRAMES_SOURCE,
      text: emitFrames(readFileSync(join(ROOT, FRAMES_SOURCE), "utf8")),
    },
    { file: SIZE_CLASSES_OUTPUT, from: SPEC, text: emitSizeClasses(readJson(SPEC)) },
  ];
  const check = process.argv.includes("--check");
  let stale = false;
  for (const { file, from, text } of outputs) {
    const path = join(ROOT, file);
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`wrote ${file}`);
      continue;
    }
    let committed = "";
    try {
      committed = readFileSync(path, "utf8");
    } catch {
      // Missing counts as stale.
    }
    if (committed !== text) {
      console.error(`❌ ${file} is stale. Run \`node tooling/web-api.mjs\` and commit it.`);
      stale = true;
    } else console.log(`✓ ${file} matches ${from}`);
  }
  if (stale) process.exit(1);
}

if (import.meta.main) main();
