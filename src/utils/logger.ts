const PREFIX = '[Glicko]';

let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

export function debugLog(message: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  console.debug(PREFIX, message, ...args);
}

export function debugWarn(message: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  console.warn(PREFIX, message, ...args);
}
