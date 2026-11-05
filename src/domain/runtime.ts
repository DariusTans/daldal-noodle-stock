/**
 * Clock + randomness used by every domain operation.
 * Defaults to the real clock; the server (or tests) can pin both for determinism.
 * The id format matches the legacy prototype exactly: `<prefix>-<ms base36>-<random base36>`.
 */
export interface Runtime {
  now(): Date;
  random(): number;
}

const systemRuntime: Runtime = { now: () => new Date(), random: () => Math.random() };
let active: Runtime = systemRuntime;

export function withRuntime<T>(runtime: Runtime, fn: () => T): T {
  const previous = active;
  active = runtime;
  try {
    return fn();
  } finally {
    active = previous;
  }
}

export const nowIso = (): string => active.now().toISOString();
export const nowMs = (): number => active.now().getTime();
export const nowDate = (): Date => active.now();

/** `randomLength` is 6 for master data / count rounds, 7 for later modules (legacy-compatible). */
export const uid = (prefix: string, randomLength: 6 | 7): string =>
  prefix +
  '-' +
  nowMs().toString(36) +
  '-' +
  active
    .random()
    .toString(36)
    .slice(2, 2 + randomLength);
