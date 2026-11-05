// Vitest sizing from the machine's real headroom: workers and timeouts.
// Canonical source: gudrodur/agent-config templates/vitest-load/vitest-load.mjs.
// Every repo vendors a byte-identical copy (scripts/sync-vendored.mjs --check
// compares them); edit the template, then run sync-vendored.mjs --write.
//
// Why: suites that pass alone time out when parallel sessions push the load
// average far above the core count. Fewer workers (bounded by free memory and
// by idle cores) and timeouts scaled by load/cores keep them green.
//
//   import { vitestLoad } from './tooling/vitest-load.mjs';
//   const load = vitestLoad({ perForkMb: 1100, reserveMb: 2048 });
//   console.error(load.line);
//   // maxWorkers: load.maxWorkers, testTimeout: load.testTimeout, hookTimeout: load.hookTimeout
//
// Overrides: VITEST_MAX_FORKS (workers), VITEST_TIMEOUT_SCALE (timeout scale).
// The bases are vitest's own defaults (5 s test, 10 s hook); load stretches them.
// In CI (env.CI) maxWorkers is undefined and scale is 1 unless overridden.
import fs from 'node:fs';
import os from 'node:os';

const defaultReadMeminfo = () => {
  try {
    const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
};

/** @param {unknown} v @returns {number | null} */
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {{ env: Record<string, string | undefined>, cores: number, load1: number, availMb: number | null,
 *   perForkMb: number, reserveMb: number, minWorkers: number }} p
 * @returns {{ maxWorkers: number | undefined, basis: string }}
 */
const sizeWorkers = ({ env, cores, load1, availMb, perForkMb, reserveMb, minWorkers }) => {
  if (env.CI) return { maxWorkers: undefined, basis: 'CI' };
  const forks = positive(env.VITEST_MAX_FORKS);
  if (forks) return { maxWorkers: Math.max(minWorkers, Math.floor(forks)), basis: 'VITEST_MAX_FORKS' };
  const byMemory = availMb == null ? cores : Math.floor((availMb - reserveMb) / perForkMb);
  const byLoad = Math.max(1, cores - Math.round(load1));
  return {
    maxWorkers: Math.max(minWorkers, Math.min(cores, byMemory, byLoad)),
    basis: `min(cores ${cores}, memory ${availMb == null ? 'unknown' : byMemory}, load ${byLoad})`,
  };
};

/**
 * @param {{ env: Record<string, string | undefined>, cores: number, load1: number, maxScale: number }} p
 * @returns {{ scale: number, overridden: boolean }}
 */
const sizeScale = ({ env, cores, load1, maxScale }) => {
  const override = positive(env.VITEST_TIMEOUT_SCALE);
  if (override) return { scale: override, overridden: true };
  if (env.CI) return { scale: 1, overridden: false };
  return { scale: Math.max(1, Math.min(maxScale, load1 / cores)), overridden: false };
};

/** @param {Record<string, any>} p */
const summary = (p) => {
  const mem = p.availMb == null ? 'unknown' : Math.round(p.availMb);
  const scale = `${p.scale.toFixed(2)}${p.overridden ? ' (VITEST_TIMEOUT_SCALE)' : ''}`;
  return `[vitest-load] workers=${p.maxWorkers ?? 'default'} (${p.basis}) cores=${p.cores} load1=${p.load1.toFixed(2)} memAvailMb=${mem} scale=${scale} testTimeout=${p.testTimeout}ms hookTimeout=${p.hookTimeout}ms`;
};

/** @param {import('./vitest-load.mjs').VitestLoadOptions} [options] */
export const vitestLoad = ({
  perForkMb = 1100,
  reserveMb = 2048,
  minWorkers = 1,
  baseTimeoutMs = 5000,
  baseHookTimeoutMs = 10_000,
  maxScale = 3,
  env = process.env,
  readMeminfo = defaultReadMeminfo,
  loadavg = () => os.loadavg()[0] ?? 0,
  cores = os.availableParallelism(),
} = {}) => {
  const load1 = loadavg() || 0;
  const availMb = readMeminfo();
  const { maxWorkers, basis } = sizeWorkers({ env, cores, load1, availMb, perForkMb, reserveMb, minWorkers });
  const { scale, overridden } = sizeScale({ env, cores, load1, maxScale });
  const testTimeout = Math.round(baseTimeoutMs * scale);
  const hookTimeout = Math.round(baseHookTimeoutMs * scale);
  const line = summary({ maxWorkers, basis, cores, load1, availMb, scale, overridden, testTimeout, hookTimeout });
  return { maxWorkers, testTimeout, hookTimeout, scale, line };
};
