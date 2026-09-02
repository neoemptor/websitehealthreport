import * as fs from 'fs';
import * as path from 'path';

/**
 * A packaged Electron app has no terminal, so console output is invisible.
 * Everything of interest goes to a file under userData.
 */
export function createLogger(rootDir: string) {
  const dir = path.join(rootDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });

  const write = (level: string, message: string, detail?: unknown) => {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      detail: detail instanceof Error ? detail.message : detail
    });
    stream.write(`${line}\n`);
  };

  return {
    info: (message: string, detail?: unknown) => write('info', message, detail),
    error: (message: string, detail?: unknown) => write('error', message, detail)
  };
}
