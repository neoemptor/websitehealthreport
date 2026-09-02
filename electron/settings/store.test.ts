import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore, DEFAULT_SETTINGS } from './store';

let dir: string;
let store: SettingsStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-settings-'));
  store = new SettingsStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults when no file exists', async () => {
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips written settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, enabledAnalyzers: ['keywords' as const] };
    await store.write(settings);
    expect(await store.read()).toEqual(settings);
  });

  it('falls back to defaults when the file is corrupt', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), '{ broken', 'utf-8');
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });
});
