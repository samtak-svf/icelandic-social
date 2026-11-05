# Infrastructure: Cloudflare, secrets and who creates resources

Moved verbatim from AGENTS.md. Two rules stay there: the EU jurisdiction and the creation step being Guðröður's.

- **Cloudflare: Samtak's own account**, never another organisation's. Every stateful
  resource is created in the **EU jurisdiction**: `cf d1 create --name … --jurisdiction eu`,
  `cf r2 buckets create --name … --cf-r2-jurisdiction eu`. A jurisdiction can only be set at
  creation. Durable Objects are pinned **per object id in code**:
  `env.CONVERSATION.jurisdiction("eu").getByName(…)`; a bare `idFromName` or `getByName` on
  the namespace is a residency bug (decision 0001).
- **Only `backend/src/env/` reads a binding, var or secret, and only it makes DO stubs**
  (`tooling/seam-guard.mjs`). `tooling/jurisdiction-check.mjs` checks that
  `backend/cloudflare.config.ts` names the frozen ids with R2 jurisdiction `eu`; with `--live` (CI,
  read-only token) it asks the Cloudflare API whether D1 and R2 really are in the EU.
- Local workerd does not implement DO jurisdictions: `jurisdiction()` throws there. Tests wrap
  the namespace (`backend/test/shared/env.test.ts`) instead of loosening the seam.
- **Never deploy before D1 and R2 exist.** `cf deploy` provisions a missing one without a
  jurisdiction, so every deploy runs `cf deploy --no-provision` behind
  `jurisdiction-check.mjs --deploy`. The creation commands are in `backend/README.md`.
- **No Cloudflare Queues** (no jurisdiction). Nothing personal is stored outside D1, R2 and
  the Durable Objects.
- **Secrets** live in the maintainer's GCP vault under the prefix `samtak-spjall-`, and
  nowhere in the repo. Signing material for a whole team goes in a GitHub environment, never
  in repo secrets. gitleaks runs pre-commit and in CI.
- Creating Cloudflare, Firebase, Apple, Play or Kenni resources, and DNS, is Guðröður's
  step. Agents prepare the exact commands and values, they do not run them. One standing
  exception, approved 2026-10-08: the first-deploy steps in `backend/README.md` (EU D1/R2, the
  R2 lifecycle rule, the API tokens, the custom domain). A second, approved 2026-10-10: an
  agent may dispatch a `production` deploy of merged `main` and approve its run, then checks
  `/health`.
