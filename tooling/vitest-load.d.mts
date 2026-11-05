export interface VitestLoadOptions {
  perForkMb?: number;
  reserveMb?: number;
  minWorkers?: number;
  baseTimeoutMs?: number;
  maxScale?: number;
  env?: Record<string, string | undefined>;
  readMeminfo?: () => number | null;
  loadavg?: () => number;
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
