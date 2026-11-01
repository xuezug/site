import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'src', 'data');
const targetDir = path.join(rootDir, 'public', 'data');

async function isDirectory(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  if (!(await isDirectory(sourceDir))) {
    console.log('[sync-data] site/src/data/ not found; skipping data sync.');
    return;
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(json|csv)$/i.test(entry.name))
    .map((entry) => entry.name);

  if (files.length === 0) {
    console.log('[sync-data] no .json/.csv files in site/src/data/; skipping data sync.');
    return;
  }

  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }

  console.log(`[sync-data] copied ${files.length} file(s) to public/data/.`);
}

await main();
