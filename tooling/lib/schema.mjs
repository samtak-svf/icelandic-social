// @ts-check
// JSON Schema (draft 2020-12) validation for the repo's hand-written JSON:
// identifiers/ids.json and brand/<name>/brand.json. One Ajv instance, errors
// rendered as `pointer: message` lines a person can act on.

import ajvModule from "ajv/dist/2020.js";

const Ajv2020 = ajvModule.default;

/**
 * @param {object} schema
 * @param {unknown} data
 * @returns {string[]} problems, empty when valid
 */
export function validate(schema, data) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const check = ajv.compile(schema);
  if (check(data)) return [];
  return (check.errors ?? []).map((e) => {
    const extra =
      e.keyword === "additionalProperties" ? ` (${String(e.params.additionalProperty)})` : "";
    return `${e.instancePath || "/"}: ${e.message ?? e.keyword}${extra}`;
  });
}
