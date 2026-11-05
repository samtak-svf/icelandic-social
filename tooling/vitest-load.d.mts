export interface VitestLoadOptions {
  perForkMb?: number;
  reserveMb?: number;
  minWorkers?: number;
  baseTimeoutMs?: number;
  baseHookTimeoutMs?: number;
  maxScale?: number;
  env?: Record<string, string | undefined>;
  readMeminfo?: () => number | null;
  loadavg?: () => number;
  /** Aggregate /proc/stat cpu counters (idle includes iowait) and procs_running, or null when unreadable. */
  readCpu?: () => { idle: number; total: number; running?: number } | null;
  /** Synchronous pause between the two cpu samples. */
  sleep?: (ms: number) => void;
  sampleMs?: number;
  cores?: number;
}

export interface VitestLoad {
  maxWorkers: number | undefined;
  testTimeout: number;
  hookTimeout: number;
  scale: number;
  line: string;
}

export function vitestLoad(options?: VitestLoadOptions): VitestLoad;
