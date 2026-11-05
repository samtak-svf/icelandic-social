// Vitest sizing from the machine's real headroom: workers and timeouts.
// Canonical source: gudrodur/agent-config templates/vitest-load/vitest-load.mjs.
// Every repo vendors a byte-identical copy (scripts/sync-vendored.mjs --check
// compares them); edit the template, then run sync-vendored.mjs --write.
//
// Why: suites that pass alone time out when parallel sessions saturate the
// cores. Fewer workers (bounded by free memory and by idle cores) and timeouts
// scaled by busyCores/cores keep them green. Contention is MEASURED NOW: two
// /proc/stat samples ~250 ms apart (idle includes iowait). The 1-minute load
// average is only the fallback where /proc/stat is unreadable, because it stays
// high for minutes after a command of the same agent has finished.
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

const SAMPLE_MS = 250;

/** Aggregate cpu line of /proc/stat as { idle (idle + iowait), total, running (procs_running) }, or null. */
const defaultReadCpu = () => {
  try {
    const text = fs.readFileSync('/proc/stat', 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('cpu '));
    if (!line) return null;
    // procs_running is instantaneous (the run queue now), unlike the decayed load average.
    const running = Number(/^procs_running\s+(\d+)/m.exec(text)?.[1] ?? 0);
    const f = line.trim().split(/\s+/).slice(1).map(Number);
    if (f.length < 5 || f.some((n) => !Number.isFinite(n))) return null;
    // user nice system idle iowait irq softirq steal (guest is already inside user/nice)
    return { running, idle: (f[3] ?? 0) + (f[4] ?? 0), total: f.slice(0, 8).reduce((a, b) => a + b, 0) };
  } catch {
    return null;
  }
};

// vitest loads its config synchronously, so the pause must be synchronous too.
/** @param {number} ms */
const defaultSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const defaultLoadavg = () => os.loadavg()[0] ?? 0;

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
 * @param {{ env: Record<string, string | undefined>, cores: number, busy: number, availMb: number | null,
 *   perForkMb: number, reserveMb: number, minWorkers: number }} p
 * @returns {{ maxWorkers: number | undefined, basis: string }}
 */
const sizeWorkers = ({ env, cores, busy, availMb, perForkMb, reserveMb, minWorkers }) => {
  if (env.CI) return { maxWorkers: undefined, basis: 'CI' };
  const forks = positive(env.VITEST_MAX_FORKS);
  if (forks) return { maxWorkers: Math.max(minWorkers, Math.floor(forks)), basis: 'VITEST_MAX_FORKS' };
  const byMemory = availMb == null ? cores : Math.floor((availMb - reserveMb) / perForkMb);
  const byLoad = Math.max(1, cores - Math.round(busy));
  return {
    maxWorkers: Math.max(minWorkers, Math.min(cores, byMemory, byLoad)),
    basis: `min(cores ${cores}, memory ${availMb == null ? 'unknown' : byMemory}, busy ${byLoad})`,
  };
};

/**
 * @param {{ env: Record<string, string | undefined>, cores: number, pressure: number, maxScale: number }} p
 * @returns {{ scale: number, overridden: boolean }}
 */
const sizeScale = ({ env, cores, pressure, maxScale }) => {
  const override = positive(env.VITEST_TIMEOUT_SCALE);
  if (override) return { scale: override, overridden: true };
  if (env.CI) return { scale: 1, overridden: false };
  return { scale: Math.max(1, Math.min(maxScale, pressure / cores)), overridden: false };
};

/** @param {Record<string, any>} p */
const summary = (p) => {
  const mem = p.availMb == null ? 'unknown' : Math.round(p.availMb);
  const scale = `${p.scale.toFixed(2)}${p.overridden ? ' (VITEST_TIMEOUT_SCALE)' : ''}`;
  return `[vitest-load] workers=${p.maxWorkers ?? 'default'} (${p.basis}) cores=${p.cores} busyCores=${p.busy.toFixed(2)} (${p.source}) load1=${p.load1.toFixed(2)} memAvailMb=${mem} scale=${scale} testTimeout=${p.testTimeout}ms hookTimeout=${p.hookTimeout}ms`;
};

/**
 * Current contention in busy cores. Skipped (no sleep) when CI or both overrides make it unused;
 * falls back to the 1-minute load average when /proc/stat cannot be sampled twice.
 * @param {{ env: Record<string, string | undefined>, cores: number, load1: number,
 *   readCpu: () => { idle: number, total: number, running?: number } | null, sleep: (ms: number) => void, sampleMs: number }} p
 * `pressure` is the run-queue depth that stretches timeouts: 0 (scale 1) unless the sample shows
 * saturation, then the deeper of load1 and procs_running; the load1 fallback uses load1 itself.
 * @returns {{ busy: number, source: string, pressure: number }}
 */
const measureBusy = ({ env, cores, load1, readCpu, sleep, sampleMs }) => {
  const fallback = { busy: load1, pressure: load1, source: 'loadavg fallback: /proc/stat unreadable' };
  if (env.CI || (positive(env.VITEST_MAX_FORKS) && positive(env.VITEST_TIMEOUT_SCALE))) {
    return { busy: load1, pressure: load1, source: 'not sampled' };
  }
  const a = readCpu();
  if (!a) return fallback;
  sleep(sampleMs);
  const b = readCpu();
  const dTotal = b ? b.total - a.total : 0;
  if (!b || dTotal <= 0) return fallback;
  const busy = cores * (1 - (b.idle - a.idle) / dTotal);
  const clamped = Math.min(cores, Math.max(0, busy));
  const pressure = clamped >= 0.9 * cores ? Math.max(load1, Math.max(0, (b.running ?? 0) - 1)) : 0;
  return { busy: clamped, pressure, source: `/proc/stat ${sampleMs}ms sample` };
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
  loadavg = defaultLoadavg,
  readCpu = defaultReadCpu,
  sleep = defaultSleep,
  sampleMs = SAMPLE_MS,
  cores = os.availableParallelism(),
} = {}) => {
  const load1 = loadavg();
  const { busy, pressure, source } = measureBusy({ env, cores, load1, readCpu, sleep, sampleMs });
  const availMb = readMeminfo();
  const { maxWorkers, basis } = sizeWorkers({ env, cores, busy, availMb, perForkMb, reserveMb, minWorkers });
  const { scale, overridden } = sizeScale({ env, cores, pressure, maxScale });
  const testTimeout = Math.round(baseTimeoutMs * scale);
  const hookTimeout = Math.round(baseHookTimeoutMs * scale);
  const line = summary({ maxWorkers, basis, cores, busy, source, load1, availMb, scale, overridden, testTimeout, hookTimeout });
  return { maxWorkers, testTimeout, hookTimeout, scale, line };
};
