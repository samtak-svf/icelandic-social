import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

// vitest.config.ts reads backend/migrations/ in Node and binds them here.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(env.DB, TEST_MIGRATIONS);
