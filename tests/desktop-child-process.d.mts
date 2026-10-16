type Method = 'spawn' | 'spawnSync' | 'execFile' | 'execFileSync' | 'exec' | 'execSync';
export function hideChildProcessWindows(
  target: Record<Method, (...args: unknown[]) => unknown>,
  platform?: NodeJS.Platform,
): void;
