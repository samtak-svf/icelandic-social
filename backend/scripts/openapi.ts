// Writes api/openapi.json from the zod schemas in src/api/ (decision 0005).
// With --check it writes nothing and fails when the committed file is stale,
// which is the drift check CI runs.
//
// Runs under plain `node` (type stripping), so everything it imports must be
// free of `cloudflare:*` modules: src/app.ts and src/api/ are.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, DOCUMENT_INFO } from "../src/app.ts";

const target = join(import.meta.dirname, "../../api/openapi.json");
const document = createApp().getOpenAPI31Document(DOCUMENT_INFO);
const text = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (committed !== text) {
    console.error(
      "❌ api/openapi.json is stale. Run `pnpm --filter spjall-backend openapi` and commit it.",
    );
    process.exit(1);
  }
  console.log("✓ api/openapi.json matches src/api/");
} else {
  writeFileSync(target, text);
  console.log("wrote api/openapi.json");
}
