/**
 * 部署 `site/dist` 到 Cloudflare Pages。
 *
 * 为什么不用 `wrangler pages deploy dist` 直接跑：`dist/` 少一个产物是很容易漏
 * 掉的（例如 `npm run build` 中途失败、`postbuild` 没摊平、`sync-data` 没复制
 * `/data/*`），而 wrangler 只会上传它看到的东西，站点会「部署成功但缺页」。
 * 这里先逐个校验产物，再用 wrangler 上传。
 *
 * 用法：
 *   npm run deploy
 *   npm run deploy -- --dry-run          # 只打印命令与产物大小，不调用 wrangler
 *   npm run deploy -- --branch preview   # 覆盖分支名（默认 main）
 *
 * `CF_PAGES_PROJECT` 取自环境变量，其次 `.env` / `.env.local` / `.env.production`。
 */

import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

/** 缺一个就不部署：这些文件被 sitemap / Agent / 404 行为直接依赖。 */
const REQUIRED_ARTIFACTS = [
  { file: 'index.html', label: '首页（预渲染）' },
  { file: '404.html', label: '品牌化 404' },
  { file: 'data/cards.json', label: '卡片数据端点' },
  { file: 'llms.txt', label: 'Agent 索引' },
  { file: 'sitemap.xml', label: '站点地图' },
];

/** 缓存与安全头；缺了站点仍能访问，但会丢掉 immutable 缓存与防护头。 */
const ADVISORY_ARTIFACTS = [{ file: '_headers', label: 'Pages 响应头' }];

const DEFAULT_BRANCH = 'main';

function fail(message) {
  throw new Error(`[deploy] ${message}`);
}

function parseArgs(argv) {
  const options = { dryRun: false, help: false, branch: DEFAULT_BRANCH };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--branch' || argument.startsWith('--branch=')) {
      const value = argument === '--branch' ? argv[(index += 1)] : argument.slice('--branch='.length);
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        fail('--branch 需要一个非空的分支名，例如 `--branch main`。');
      }
      options.branch = value.trim();
    } else {
      fail(`未知参数 "${argument}"；可用参数：--dry-run、--branch <name>、--help。`);
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      '用法：node scripts/deploy.mjs [--dry-run] [--branch <name>]',
      '',
      '  --dry-run        校验产物并打印将执行的命令，不调用 wrangler',
      `  --branch <name>  Cloudflare Pages 的分支名（默认 ${DEFAULT_BRANCH}）`,
      '  -h, --help       显示本说明',
      '',
      '环境变量：CF_PAGES_PROJECT（必填，可写在 .env / .env.local 中）。',
    ].join('\n'),
  );
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${String(bytes)} B`;
}

/** 返回已校验产物的 `{ file, label, size }`，缺失或为空直接失败。 */
async function collectArtifacts() {
  const found = [];
  let total = 0;

  for (const artifact of REQUIRED_ARTIFACTS) {
    const filePath = path.resolve(distDir, artifact.file);
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      fail(`dist/${artifact.file} 不存在；先运行 \`npm run build\`。`);
    }
    if (!stats.isFile()) {
      fail(`dist/${artifact.file} 不是文件。`);
    }
    if (stats.size === 0) {
      fail(`dist/${artifact.file} 是空文件（${artifact.label}）。`);
    }
    total += stats.size;
    found.push({ ...artifact, size: stats.size });
  }

  return { artifacts: found, total };
}

async function reportAdvisoryArtifacts() {
  for (const artifact of ADVISORY_ARTIFACTS) {
    const stats = await stat(path.resolve(distDir, artifact.file)).catch(() => null);
    if (stats === null || !stats.isFile() || stats.size === 0) {
      console.warn(
        `[deploy] 警告：dist/${artifact.file} 缺失（${artifact.label}）。` +
          ' 站点能访问，但缓存头与安全头不会生效；确认 site/public/ 下有该文件并重新构建。',
      );
    }
  }
}

/** Pages 项目名与分支名只允许这些字符，否则直接拒绝拼进命令行。 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checkSafeName(value, what) {
  if (!SAFE_NAME.test(value)) {
    fail(`${what} "${value}" 含有不支持的字符；只允许字母、数字、点、下划线和连字符。`);
  }
  return value;
}

/** 环境变量优先，其次是 `.env*`；两者都为空则报错。 */
function resolveProjectName() {
  const fromEnv = (process.env.CF_PAGES_PROJECT ?? '').trim();
  if (fromEnv !== '') {
    return checkSafeName(fromEnv, 'CF_PAGES_PROJECT');
  }

  const fileEnv = loadEnv('production', rootDir, '');
  const fromFile = (fileEnv.CF_PAGES_PROJECT ?? '').trim();
  if (fromFile !== '') {
    return checkSafeName(fromFile, 'CF_PAGES_PROJECT');
  }

  fail(
    '缺少 CF_PAGES_PROJECT。请在环境变量或 site/.env.local 中设置 Cloudflare Pages ' +
      '项目名（例如 CF_PAGES_PROJECT=bl-site），或先用 ' +
      '`npx wrangler pages project create <name>` 创建项目。',
  );
}

/** `npx wrangler pages deploy dist …`，用于展示；执行时在 Windows 换成 npx.cmd。 */
function deployParts(project, branch) {
  return ['npx', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', branch];
}

function printDryRun({ project, branch, artifacts, total }) {
  console.log('[deploy] 试运行：只校验产物并打印命令，不调用 wrangler。');
  console.log(`[deploy] 项目：${project}，分支：${branch}`);
  console.log('[deploy] 产物：');
  for (const artifact of artifacts) {
    console.log(
      `  - dist/${artifact.file}  ${formatBytes(artifact.size)}  (${artifact.label})`,
    );
  }
  console.log(`[deploy] 已校验 ${String(artifacts.length)} 个必需产物，合计 ${formatBytes(total)}。`);
  console.log(`[deploy] 将执行：${deployParts(project, branch).join(' ')}`);
  console.log('[deploy] 目录：site/（产物目录 dist/）');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  const { artifacts, total } = await collectArtifacts();
  await reportAdvisoryArtifacts();

  const project = resolveProjectName();
  const branch = checkSafeName(options.branch, '分支名');

  if (options.dryRun) {
    printDryRun({ project, branch, artifacts, total });
    return 0;
  }

  console.log(
    `[deploy] 已校验 ${String(artifacts.length)} 个产物（${formatBytes(total)}），` +
      `开始上传到 Pages 项目 ${project}（分支 ${branch}）…`,
  );

  const parts = deployParts(project, branch);
  const isWindows = process.platform === 'win32';
  // Windows 上 npx.cmd 是批处理文件，必须经 cmd.exe 才能解析；用一个命令行字符串
  // 而不是 `shell: true` + args（后者会触发 Node 的 DEP0190 警告）。
  const result = isWindows
    ? spawnSync([`npx.cmd`, ...parts.slice(1)].join(' '), {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true,
      })
    : spawnSync(parts[0], parts.slice(1), { cwd: rootDir, stdio: 'inherit' });

  if (result.error) {
    fail(`无法启动 wrangler：${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`wrangler 退出码 ${String(result.status ?? 'unknown')}，部署未完成。`);
  }

  console.log('[deploy] 完成。');
  return 0;
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
