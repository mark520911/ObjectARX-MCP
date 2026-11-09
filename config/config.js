import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without overwriting existing system environment variables.
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');

  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const cfgPath = path.join(projectRoot, 'config', 'default.json');
const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const env = (key, fallback) => process.env[key] || fallback;

export const config = {
  projectRoot,
  sdkRoot: env('ARX_SDK_ROOT', raw.sdkRoot),
  docsDir: env('ARX_DOCS_DIR', raw.docsDir),
  includeDir: env('ARX_INCLUDE_DIR', raw.includeDir),
  sevenZipPath: env('ARX_7ZIP_PATH', raw.sevenZipPath),
  databasePath: path.resolve(projectRoot, env('ARX_DB_PATH', raw.databasePath)),
  sourceDir: path.resolve(projectRoot, raw.sourceDir),
  convertedDir: path.resolve(projectRoot, raw.convertedDir),
  maxExcerptChars: raw.maxExcerptChars,
  maxResultChars: raw.maxResultChars,
  defaultTopK: raw.defaultTopK
};
