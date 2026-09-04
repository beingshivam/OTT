import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads .env into process.env if the file exists.
 *
 * Without this, the documented `cp .env.example .env` did nothing and the token
 * had to be passed inline — which breaks on Windows, where `VAR=value cmd` is
 * bash syntax that cmd.exe rejects outright, and where `set VAR="x"` silently
 * keeps the quotes as part of the value. A file sidesteps every one of those.
 *
 * Node's own loadEnvFile is used where available; the manual parse keeps this
 * working on older runtimes.
 */
export function loadEnv() {
  const path = resolve(ROOT, '.env');

  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      // No .env, or unreadable — env vars set another way still apply.
      return;
    }
  }

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue; // A real env var always wins.
    // Strip one layer of matching quotes, which is what people paste.
    process.env[key] = value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
}
