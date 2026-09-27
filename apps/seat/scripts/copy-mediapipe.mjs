import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(fileURLToPath(import.meta.resolve('@mediapipe/tasks-vision')));
const dest = fileURLToPath(new URL('../src/renderer/public/mediapipe/wasm/', import.meta.url));
mkdirSync(dest, { recursive: true });
cpSync(join(pkg, 'wasm'), dest, { recursive: true });
console.log(`mediapipe wasm → ${dest}`);
