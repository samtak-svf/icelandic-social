const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
/** Day, month and serial give 28 × 12 × 80 people, split into one band per parallel worker. */
const SPACE = 28 * 12 * 80;
const BANDS = 8;
const BAND = SPACE / BANDS;
const slot = Number(process.env.TEST_PARALLEL_INDEX ?? 0) % BANDS;
let people = slot * BAND + Math.floor(Math.random() * (BAND - 1000));

/**
 * A new person's kennitala, born on a day in 2099: structurally valid, so it
 * passes as Kenni's, and nobody's. Computed rather than written out, because
 * tooling/pii-guard.mjs refuses a valid kennitala in any file (as in
 * backend/test/oidc.ts). Each parallel worker counts in a band of its own,
 * so two workers never make the same person (1000 numbers each); the start
 * within the band is random, so a rerun against the same `cf dev` state is
 * a new person too.
 */
export function newKennitala(): string {
  for (;;) {
    const n = people++;
    const day = String(1 + (n % 28)).padStart(2, "0");
    const month = String(1 + (Math.floor(n / 28) % 12)).padStart(2, "0");
    const serial = String(20 + (Math.floor(n / 336) % 80)).padStart(2, "0");
    const first = `${day}${month}99${serial}`;
    const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first[i]), 0);
    const remainder = sum % 11;
    if (remainder === 1) continue;
    return `${first}${remainder === 0 ? 0 : 11 - remainder}0`;
  }
}

/** A new Google subject, nobody's. */
export function newGoogleSubject(): string {
  return `e2e-${crypto.randomUUID()}`;
}
