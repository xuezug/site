import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Data regeneration is an extraction-side operation: the Python exporter and
// its CSV inputs live in the `reverse` workspace, not in this repository. The
// generated `src/data/*` is committed, so ordinary development and builds never
// need Python. This wrapper gives a clear message instead of a missing-file
// traceback when the site repo is cloned standalone.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const exporter = path.resolve(repoRoot, '..', 'tools', 'site_export', 'export_cards.py');

if (!existsSync(exporter)) {
  console.error('[data] 未找到 ../tools/site_export/export_cards.py');
  console.error('[data] 数据再生成需要在 reverse 工作区执行；本仓库已包含生成好的 src/data，');
  console.error('[data] 正常开发、构建、部署都不需要运行 npm run data。');
  process.exit(1);
}

const args = process.argv.slice(2);
const exported = spawnSync('python', [exporter, ...args], { stdio: 'inherit', cwd: repoRoot });
if (exported.error) {
  console.error(`[data] 无法启动 python：${exported.error.message}`);
  process.exit(1);
}
if (exported.status !== 0) process.exit(exported.status ?? 1);

const synced = spawnSync(process.execPath, ['scripts/sync-data.mjs'], { stdio: 'inherit', cwd: repoRoot });
process.exit(synced.status ?? 1);
