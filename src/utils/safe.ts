import { debugWarn } from './logger';

export function attempt<T>(fn: () => T, context?: string): T | undefined {
  try {
    return fn();
  } catch (e) {
    debugWarn(context ?? 'attempt() caught error', e);
    return undefined;
  }
}

export async function attemptAsync<T>(
  fn: () => Promise<T>,
  context?: string,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    debugWarn(context ?? 'attemptAsync() caught error', e);
    return undefined;
  }
}
