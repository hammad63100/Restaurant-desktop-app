/**
 * Copies non-TypeScript assets that the compiled main process needs at runtime.
 * SQL migrations stay as .sql files so they can be read and reviewed easily.
 */
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'electron', 'db', 'migrations');
const target = path.join(root, 'dist-electron', 'electron', 'db', 'migrations');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

console.log(`[assets] migrations copied to ${path.relative(root, target)}`);
