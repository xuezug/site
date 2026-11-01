import { copyFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const clientDir = path.join(distDir, 'client');

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(clientDir))) {
    throw new Error('[postbuild] dist/client/ not found; did `react-router build` run?');
  }

  // React Router always nests the client output in <buildDirectory>/client.
  // Flatten it into dist/ so Cloudflare Pages serves dist/index.html directly.
  for (const entry of await readdir(clientDir)) {
    const target = path.join(distDir, entry);
    await rm(target, { recursive: true, force: true });
    await rename(path.join(clientDir, entry), target);
  }
  await rm(clientDir, { recursive: true, force: true });
  await rm(path.join(distDir, 'server'), { recursive: true, force: true });

  if (!(await exists(path.join(distDir, 'index.html')))) {
    throw new Error('[postbuild] dist/index.html is missing after flattening.');
  }

  // Prerendering "/404" emits dist/404/index.html, but Cloudflare Pages only
  // uses a top-level dist/404.html for unknown paths.
  const nestedNotFound = path.join(distDir, '404', 'index.html');
  if (await exists(nestedNotFound)) {
    await copyFile(nestedNotFound, path.join(distDir, '404.html'));
    console.log('[postbuild] copied dist/404/index.html -> dist/404.html');
  }

  // React Router's SPA-mode fallback shell is never served: unknown paths must
  // get the real 404 document. Drop it so it cannot be deployed by accident.
  const spaFallback = path.join(distDir, '__spa-fallback.html');
  if (await exists(spaFallback)) {
    await rm(spaFallback, { force: true });
    console.log('[postbuild] removed dist/__spa-fallback.html');
  }

  console.log('[postbuild] build output flattened into dist/.');
}

await main();
