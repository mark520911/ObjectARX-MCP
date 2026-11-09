import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../../config/config.js';

const chmFiles = fs.existsSync(config.docsDir)
  ? fs.readdirSync(config.docsDir).filter(f => f.toLowerCase().endsWith('.chm')) : [];
if (!chmFiles.length) {
  console.error(`No CHM files found in: ${config.docsDir}`);
  console.error('Edit config/default.json or set ARX_DOCS_DIR.');
  process.exit(1);
}
fs.mkdirSync(config.sourceDir, { recursive: true });
const candidates = [config.sevenZipPath, '7z'];
let sevenZip = candidates.find(p => p === '7z' || fs.existsSync(p));
if (!sevenZip) {
  console.error('7-Zip not found. Install 7-Zip or set sevenZipPath in config/default.json.');
  process.exit(1);
}
for (const file of chmFiles) {
  const name = path.basename(file, path.extname(file));
  const out = path.join(config.sourceDir, name);
  fs.mkdirSync(out, { recursive: true });
  console.log(`[CHM] ${file} -> ${out}`);
  const r = spawnSync(sevenZip, ['x', '-y', path.join(config.docsDir, file), `-o${out}`], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) console.warn(`[WARN] extraction returned ${r.status}: ${file}`);
}
console.log(`Extraction finished. Sources: ${config.sourceDir}`);
