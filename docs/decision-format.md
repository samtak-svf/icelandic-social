# Decision record format

Each record opens with `# NNNN. Title` and a header list: `- Status:` (`accepted`, with
"implemented …", "designed, not yet implemented", "deferred" or "amended by NNNN" when that
applies; the test refuses any other state, so a status is updated in the PR that lands the work),
`- Date:` and `- Decided by:` (a person, or the overseer on a named person's question or order, ending
"his to overturn"; never a bare agent), then any `Amended by`, `Supersedes` or
`Closes` lines. The body starts at `## Decision`; `tooling/tests/decisions.test.mjs` holds this.
