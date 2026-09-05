/**
 * Reads src/data/config.ts from the build scripts.
 *
 * Same reasoning as brand.mjs: these values are written into the shipped HTML,
 * so a second copy here would be a second thing to keep in step. Parsed rather
 * than imported because that is a .ts file and these scripts run under plain node.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(ROOT, 'src/data/config.ts'), 'utf8');

const read = (name) => source.match(new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`))?.[1] ?? '';

export const ANALYTICS_TOKEN = read('ANALYTICS_TOKEN');
export const EMAIL_ENDPOINT = read('EMAIL_ENDPOINT');
