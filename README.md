# bl-site

《血族》资源站：卡牌图鉴、Tier Maker 节奏榜与版本笔记。React Router 7 静态站点
（`ssr: false` + 构建期预渲染），构建产物是纯静态文件，部署在 Cloudflare Pages，
卡片图标放在 R2 的 `bl-resource` 桶上。

## 目录

```text
site/
+ app/
  + routes/            页面：home、tier、blog-list、blog-post、blog-tag、not-found
  + components/        layout / tier / blog / ui
  + lib/               tier 模型与持久化、cards 筛选、blog 解析、seo 构造
  + data/              导出产物（cards.json / taxonomy.json / meta.json），入库
+ content/blog/*.md    Markdown 文章（frontmatter 带 slug）
+ plugins/            构建期插件：blog 内容、Agent 产物、卡片数据
+ public/             静态资源；`_headers` 是 Pages 的响应头配置
+ scripts/            sync-data、postbuild、preview、assert-build、deploy
+ tests/unit/         Vitest 单元/组件测试
+ tests/e2e/          Playwright 端到端（spec + `fixtures/` + `support/harness.ts`）
```

数据导出工具属于逆向工作区（`reverse/tools/site_export/`，Python，见其 README），不在本仓库内。
本仓库已包含生成好的 `src/data/*`；普通开发、构建、部署不需要 Python，也不需要重新导出。
`npm run data` 只在同级存在 `reverse/tools/site_export/` 时可用，否则会给出提示并退出。

## 本地开发

需要 Node 24（`node --version` ≥ 24.0）与 npm；`python` 只有重新导出数据时才需要。

```bash
npm ci
npm run dev        # http://localhost:5173
npm run preview    # 以 Cloudflare Pages 的方式提供 dist/（默认 4173，PORT 可覆盖）
```

`prebuild` / `predev` 会把 `src/data/*` 复制到 `public/data/`，所以首次开发前不需要
手工准备 `/data/*`。

### 为什么 preview 用自定义静态服务器

构建产物是「每个路由一个目录」：`dist/index.html`、`dist/tier/index.html`、
`dist/blog/index.html`、`dist/404.html`。Cloudflare Pages 按目录索引解析
`/tier` → `dist/tier/index.html`，未知路径返回 `404.html`（状态 404，没有 SPA 回退）。

`vite preview` 在 `appType: 'spa'` 下会把 `dist/index.html` 回退给 `/tier`、
`/blog`。那两份文档里是首页的 `<main>`，客户端 hydrate 真实路由时 DOM 与预渲染结果
不一致，看起来就像站点自己的 hydration 报错（React #418）。为了本地预览与线上一致，
`npm run preview` 改用 `scripts/preview.mjs`：纯 Node 静态服务器，按目录索引、未知
路径返回 `404.html`，并拒绝路径穿越。

## 数据

```bash
npm run data       # 重新导出 src/data/*，再从 src/data 复制到 public/data
```

只有源数据（`skins.csv`、图标清单）变化时才需要跑；需要 Python 3.13。命令会调用
`../tools/site_export/export_cards.py`（标准库，无第三方依赖），详见该目录的 README。

- `src/data/` 是**入库**的导出产物，前端与构建期插件都读它。
- `public/data/` 是 `scripts/sync-data.mjs` 从 `src/data/` 复制出来的副本，不入库；
  `dist/data/*` 端点就来自这里。`public/data/tier.schema.json` 与
  `public/data/tier-default.json` 是例外：手写、随源码入库，不被同步覆盖。
- 构建不需要 Python：`predev` / `prebuild` 只做复制。

## 质量门禁

```bash
npm run check      # build + typecheck + lint + test + check:build（当前门禁）
```

`check:build`（`scripts/assert-build.mjs`）校验 `dist/` 的产物契约：OG URL 与
`SITE_URL` 一致、`404.html` 已预渲染、916 张卡的 `/data/cards.json`、`llms.txt` /
`llms-full.txt` / `sitemap.xml` / `robots.txt`、文章 Markdown 与 JSON-LD、
`/tier` 的 916 个 `<img>`。

### 端到端（Playwright）

```bash
npm run build && npm run e2e      # 本地：先构建，再跑 28 个用例
npm run e2e:ci                    # 构建 + 测试（CI 用）
```

`playwright.config.ts` 指向 `scripts/preview.mjs`（`http://127.0.0.1:4173`），因此测的
就是 Cloudflare Pages 会看到的那份 `dist/`（目录索引、404 状态、无 SPA 兜底）。
`webServer` 会自己启动预览服务器：本地已有 4173 在跑时直接复用，`CI` 环境下总是新起一个。

- 浏览器用**系统 Chrome**（`channel: 'chrome'`），不需要 `npx playwright install`。
- 完全离线：`tests/e2e/support/harness.ts` 把每个 `**/card_icons/*.png` 都拦截成
  `fixtures/tiny.png`（或按用例返回 500，验证 PNG 导出的降级），永远不会请求 R2。
- 用例分布：`tier`（池、筛选、拖拽、重置/快照、键盘菜单）、`tier-io`（JSON 往返、
  非法导入、PNG 导出与断图降级）、`blog`（列表/详情/标签、禁用 JS、Markdown 链接）、
  `agent`（`/data/*`、`llms*.txt`、`sitemap`、JSON-LD、404 与 noindex）、`mobile`
  （375×667 无横向滚动、抽屉、`Input.dispatchTouchEvent` 的真实触摸滑动/长按拖拽）、
  `perf`（DCL/LCP、传输体积预算）。
- 真实指针拖拽（`mouse.move/down/move/up`）需要源卡片与目标档位同屏：`/tier` 的角色池
  在首屏以下约 1090px，所以拖拽用例单独用 1440×1400 视口；其余用例保持 1280×900。
- 失败时 `test-results/` 里有截图与 trace（`npx playwright show-trace <trace.zip>`）。

## 部署（Cloudflare Workers 静态资源）

仓库根目录的 `wrangler.jsonc` 已配置成 **assets-only Worker**（没有 Worker 脚本）：

```jsonc
{
  "name": "bl-site",
  "compatibility_date": "2026-11-02",
  "assets": {
    "directory": "./dist",
    "html_handling": "drop-trailing-slash",
    "not_found_handling": "404-page"
  }
}
```

- `html_handling: drop-trailing-slash`：`/tier/` 会 308 到 `/tier`，与 canonical / sitemap 一致。
- `not_found_handling: 404-page`：未知路径返回 `dist/404.html`，状态码 404，不用 SPA 兜底。

**不要删除 `wrangler.jsonc`。** 没有它时，`wrangler deploy` 会按 “React Router” 预设自动配置成 SSR 模板
（`main: workers/app.ts`、输出 `build/client`，并再跑一次构建），而本站是 `ssr: false` 的预渲染静态站，
会在 `[react-router] Server build file not found in manifest` 处失败。

### 本地预览

```bash
npm run worker:dev      # wrangler dev → http://localhost:8787
npm run preview         # 纯静态服务器 → http://localhost:4173（e2e 用）
```

`worker:dev` 跑的是 Workers 运行时，会应用 `_headers`；`preview` 只是把 `dist/` 当普通静态目录服务，用于离线 e2e。

### 构建与部署

```bash
npm ci
npm run build           # → dist/
npm run deploy          # = wrangler deploy（首次需 wrangler login 或 CLOUDFLARE_API_TOKEN）
```

Workers Builds（Cloudflare 控制台连接 GitHub 仓库）填：

| 设置 | 值 |
| --- | --- |
| Root directory | `/`（仓库根就是站点根） |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| 环境变量 | `SITE_URL=https://<域名>`（构建期注入）；可选 `VITE_ASSET_BASE_URL`、`BUILD_DATE` |

`SITE_URL` 必须在构建期可见；Workers Builds 里配置的变量对构建命令可用。部署完成后可用
`node scripts/verify-deploy.mjs --base https://<域名>` 逐项检查。

### Cloudflare Pages（备选）

如果仍用 Pages：Build output directory 填 `dist`，**HTML handling 选 Drop trailing slash**，
然后用 `CF_PAGES_PROJECT=<项目名> npm run deploy:pages`（`scripts/deploy.mjs` 会先校验产物）。


### 环境变量

构建期（Workers Builds / Pages 项目设置 → Variables，或本地 `.env.local`）：

| 变量 | 必填 | 作用 |
| --- | --- | --- |
| `SITE_URL` | 是 | 站点正式域名。canonical、`og:url`、sitemap、robots、llms 都用它；尾部斜杠会被自动去掉 |
| `VITE_ASSET_BASE_URL` | 否 | 图标域名，默认 `https://bl-resource.cracklewis.site` |
| `BUILD_DATE` | 否 | 固定 sitemap 静态页的 `lastmod`（`YYYY-MM-DD`），用于可复现构建 |
| `SOURCE_DATE_EPOCH` | 否 | 同上，标准可复现构建变量（Unix 秒）；`BUILD_DATE` 优先 |
| `CF_PAGES_PROJECT` | 否 | 只有 `npm run deploy:pages`（Pages 备选方案）读它 |

`SITE_URL` 在 `site-url.ts` 里归一化（`https://a.com/` → `https://a.com`），
`assert-build` 依赖这个行为：预渲染出的 `og:url` 必须与它逐字相同。

### 响应头

响应头由 `public/_headers`（构建后落在 `dist/_headers`）声明，Workers 静态资源与 Pages 都支持：

- 全站 `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、
  最小化 `Permissions-Policy`、`X-Frame-Options: DENY`（由 `/*` 供给）；
- `/assets/*` 一年 `immutable`；`/data/*` 5 分钟。

HTML **不单独声明缓存**，沿用 Workers/Pages 静态资源的默认值 `public, max-age=0, must-revalidate`
（每次导航都回源校验，配合 ETag 返回 304）。原因：`_headers` 按请求 URL 匹配，而两者都会把
`*/index.html` 的请求重定向到无扩展名的路由，真实导航请求是 `/`、`/tier`、`/blog/<slug>`，
没有一条以 `.html` 结尾，`/*.html` 规则永远不会命中；也不要用 `/*/index.html` 兜底。

暂不设 CSP：React Router 的内联 hydration 脚本需要 `unsafe-inline`，等换成
hash / nonce 方案再加。

### 部署后验证

部署完成（或本地 `npm run worker:dev` / `npm run preview`）后，用同一个脚本按线上实际行为逐项检查：

```bash
cd site
node scripts/verify-deploy.mjs --base https://bl.cracklewis.site
# 本地预览（先另开一个终端跑 npm run preview）
node scripts/verify-deploy.mjs --base http://127.0.0.1:4173
```

`--base` 省略时读取 `SITE_URL`（未设置则回退到
`https://bl.cracklewis.site`）。检查项：

- `/`、`/tier`、`/blog`、`/blog/tier-guide`、`/404`、标签页（编码与解码两种
  写法）、`/data/cards.json`、`/llms.txt`、`/sitemap.xml`、`/blog/tier-guide.md`
  返回 200；`/nope` 返回 404 且正文含「页面不存在」的 `<h1>`。
- 页面有 canonical；`/404` 与未知路径没有 canonical 且有 `robots=noindex`。
- 用 `Origin` 请求头取一张真实图标（来自 `/data/cards.json`），有
  `access-control-allow-origin` 才打印通过；缺失只警告（PNG 导出会降级），
  不影响退出码。

任何硬性检查失败时退出码为 1，可直接接在 `npm run deploy` 之后。

### 品牌资源（favicon / og:image）

`public/favicon.svg`、`public/favicon.ico`（32×32）与 `public/og-default.png`
（1200×630）不是手绘二进制，而是由脚本生成：

```bash
cd site
python scripts/make-icons.py      # 需要 Pillow 12+ 与一个中文字体
```

同一 Pillow 版本下重复运行输出逐字节一致，所以可以随时重新生成。

## R2 资源

- 公共域名：`https://bl-resource.cracklewis.site`，对应 R2 桶 `bl-resource`。
- 图片路径约定：`card_icons/{serial}_{looks}.png`，与 `/data/cards.json` 的
  `iconPath` 一致；前端拼成 `${VITE_ASSET_BASE_URL}/${iconPath}`。同一 `looks` 被多张
  卡复用时，按 `serial` 各自成文件，不合并。
- 凭据只放在仓库根（未入库）的 `r2-bl-res.json`，脚本读取但从不打印 key / secret。

### CORS

PNG 导出要把跨域图片画进 canvas，所以桶必须回 `Access-Control-Allow-Origin`；
预检会带 `Accept`，故 `AllowedHeaders` 用 `*`。

```bash
# 预览将要写入的规则（不导入 boto3、不发请求）
python tools/site_export/set_r2_cors.py --dry-run

# 真实写入（需要 boto3：python -m pip install boto3）
python tools/site_export/set_r2_cors.py

# 临时加一个预览域名
python tools/site_export/set_r2_cors.py \
  --origins https://bl.cracklewis.site,http://localhost:5173,https://preview.bl.pages.dev
```

规则来自 `tools/site_export/cors.json`（`GET` / `HEAD`、`AllowedHeaders: *`、
`MaxAgeSeconds: 86400`），`--origins` 覆盖其中的 `AllowedOrigins`；`--config` 可换凭据
文件，`--bucket` 可换桶名。

## 已知限制

- 榜单只存在浏览器 `localStorage`，换设备不同步；没有账号、没有后端。
- PNG 导出依赖上面的 R2 CORS：未配置时画布被污染，导出降级为占位图并提示，其余功能不受影响。
- 数据随游戏版本变化要手工跑 `npm run data`；没有定时抓取。
- 站点是纯静态的，`/data/*` 的更新需要重新构建部署（缓存 5 分钟）。

## Agent 端点

| 端点 | 内容 |
| --- | --- |
| `/data/cards.json` | 916 条卡片记录（数组，按 `serial`） |
| `/data/cards.csv` | 同一份数据的 CSV（UTF-8 带 BOM） |
| `/data/taxonomy.json` | 属性 / 阵营 / 职业 / 性别 / 星级的 id 与中文标签 |
| `/data/meta.json` | 条数、生成时间、来源 |
| `/data/tier.schema.json` | 榜单文件的 JSON Schema |
| `/data/tier-default.json` | 默认六档空榜单 |
| `/llms.txt` | 站点索引：端点、页面、文章清单 |
| `/llms-full.txt` | 单文件全文：卡片全表 + 分类 + 文章原文 |
| `/sitemap.xml` | 全部可索引路由（无 `/404`、无 SPA 回退） |
| `/blog/<slug>.md` | 文章的原始 Markdown |
| `/blog/index.json` | 文章元数据数组 |
