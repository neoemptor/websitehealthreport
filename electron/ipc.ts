import type { BrowserWindow } from 'electron';

export type Logger = { info(m: string, d?: unknown): void; error(m: string, d?: unknown): void };

/** Placeholder. Task 12 replaces this with the real IPC surface. */
export function registerIpc(_deps: {
  userDataDir: string;
  window: BrowserWindow;
  logger: Logger;
}): void {
  // Intentionally empty until Task 12.
}
