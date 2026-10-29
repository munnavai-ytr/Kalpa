import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'node_modules', '@tailwindcss', 'browser', 'dist', 'index.global.js');
const destDir = path.join(root, 'public', 'vendor');
const dest = path.join(destDir, 'tailwind-browser-4.js');

try {
  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
} catch {
  // Never fail install/build if optional vendor copy cannot run
}
