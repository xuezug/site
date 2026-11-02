import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import posts from 'virtual:blog-posts';
import { PostList } from '../../app/components/blog/PostList';
import { Toc } from '../../app/components/blog/Toc';
import {
  adjacentPosts,
  collectTags,
  findTag,
  postTagSlugs,
  postsByTag,
  tagSlug,
  type PostHeading,
} from '../../app/lib/blog/content';
import { resolveOgMetadata } from '../../app/lib/seo/head';
import BlogPost, { handle as postHandle, meta as postMeta } from '../../app/routes/blog-post';
import BlogTag, { meta as tagMeta } from '../../app/routes/blog-tag';
import {
  BLOG_VIRTUAL_MODULE_ID,
  blogContent,
  estimateReadingMinutes,
  loadPosts,
  loadPostsWithAssets,
} from '../../plugins/blog-content';

const SITE_URL = 'https://bl.cracklewis.site';

const FRONTMATTER = ['title: 测试文章', 'date: 2026-11-01', 'summary: 一句话摘要。'].join('\n');

let contentDir: string;

beforeEach(() => {
  contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
});

afterEach(() => {
  cleanup();
  rmSync(contentDir, { recursive: true, force: true });
});

function writePost(fileName: string, frontmatter: string, body: string): void {
  writeFileSync(
    path.join(contentDir, fileName),
    `---\n${frontmatter}\n---\n\n${body}\n`,
    'utf8',
  );
}

describe('loadPosts frontmatter', () => {
  it('rejects a missing title, a bad date and non-string tags', async () => {
    writePost('missing-title.md', 'date: 2026-11-01\nsummary: 摘要', '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/frontmatter "title"/);

    rmSync(contentDir, { recursive: true, force: true });
    contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
    writePost('bad-date.md', 'title: 文章\ndate: 2026-02-30\nsummary: 摘要', '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/real calendar date/);

    rmSync(contentDir, { recursive: true, force: true });
    contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
    writePost('bad-tags.md', `${FRONTMATTER}\ntags: 数据`, '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/tags.*array/);
  });

  it('derives the slug from the file name, dropping the oc-YYMMDD- prefix', async () => {
    writePost('oc-261101-hello-world.md', FRONTMATTER, '## 概述\n\n正文');
    const [post] = await loadPosts({ contentDir });

    expect(post?.slug).toBe('hello-world');
    expect(post?.title).toBe('测试文章');
    expect(post?.date).toBe('2026-11-01');
    expect(post?.draft).toBe(false);
    expect(post?.tags).toEqual([]);
  });

  it('prefers an explicit slug and rejects non-ASCII file names', async () => {
    writePost('文件名.md', `${FRONTMATTER}\nslug: explicit-slug`, '正文');
    await expect(loadPosts({ contentDir })).resolves.toMatchObject([{ slug: 'explicit-slug' }]);

    rmSync(contentDir, { recursive: true, force: true });
    contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
    writePost('文件名.md', FRONTMATTER, '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/ASCII slug/);
  });

  it('fails on duplicate slugs across files', async () => {
    writePost('first.md', `${FRONTMATTER}\nslug: same`, '正文');
    writePost('second.md', `${FRONTMATTER}\nslug: same`, '正文');

    await expect(loadPosts({ contentDir })).rejects.toThrow(/duplicate slug "same"/);
  });

  it('rejects tags that would break the tag URL or prerender path', async () => {
    writePost('bad-tag.md', `${FRONTMATTER}\ntags:\n  - 节奏/榜`, '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/"节奏\/榜"/);

    rmSync(contentDir, { recursive: true, force: true });
    contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
    writePost('bad-tag-2.md', `${FRONTMATTER}\ntags:\n  - "100%"`, '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/"100%"/);
  });

  it('rejects a non-boolean draft flag', async () => {
    writePost('draft-string.md', `${FRONTMATTER}\ndraft: "yes"`, '正文');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/draft.*boolean/);
  });

  it('hides drafts unless includeDrafts is set', async () => {
    writePost('published.md', FRONTMATTER, '## 小节\n\n正文');
    writePost('draft.md', `${FRONTMATTER}\ndraft: true`, '## 小节\n\n草稿正文');

    const publishedOnly = await loadPosts({ contentDir });
    expect(publishedOnly.map((post) => post.slug)).toEqual(['published']);

    const withDrafts = await loadPosts({ contentDir, includeDrafts: true });
    expect(withDrafts.map((post) => post.slug).sort()).toEqual(['draft', 'published']);
    expect(withDrafts.find((post) => post.slug === 'draft')?.draft).toBe(true);
  });
});

function writeFolderPost(
  folderName: string,
  body: string,
  options: {
    frontmatter?: string;
    assets?: Record<string, string>;
  } = {},
): void {
  const folder = path.join(contentDir, folderName);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, 'index.md'),
    `---\n${options.frontmatter ?? FRONTMATTER}\n---\n\n${body}\n`,
    'utf8',
  );

  for (const [name, content] of Object.entries(options.assets ?? {})) {
    const target = path.join(folder, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

describe('per-post folders and local images', () => {
  it('derives the slug from the folder and rewrites/copies relative images', async () => {
    writeFolderPost('hello-world', '![封面](./cover.png)', {
      assets: { 'cover.png': 'fake-png' },
    });

    const { posts, assets } = await loadPostsWithAssets({ contentDir, siteUrl: SITE_URL });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.slug).toBe('hello-world');
    expect(posts[0]?.html).toContain('src="/blog/hello-world/cover.png"');
    expect(posts[0]?.source).toContain(
      `![封面](${SITE_URL}/blog/hello-world/cover.png)`,
    );

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      relativePath: 'cover.png',
      outputPath: 'blog/hello-world/cover.png',
      url: '/blog/hello-world/cover.png',
    });
    expect(assets[0]?.sourcePath).toBe(path.join(contentDir, 'hello-world', 'cover.png'));
  });

  it('supports nested paths with spaces and CJK file names', async () => {
    writeFolderPost('diagram', '![流程图](<images/流程 图.png>)', {
      assets: { 'images/流程 图.png': 'fake-png' },
    });

    const { posts, assets } = await loadPostsWithAssets({ contentDir, siteUrl: SITE_URL });
    expect(posts[0]?.html).toContain(
      'src="/blog/diagram/images/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.png"',
    );
    expect(posts[0]?.source).toContain(
      `${SITE_URL}/blog/diagram/images/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.png`,
    );
    expect(assets[0]?.outputPath).toBe('blog/diagram/images/流程 图.png');
  });

  it('rewrites reference-style images and leaves external/root URLs alone', async () => {
    writeFolderPost(
      'references',
      [
        '![封面][cover]',
        '',
        '![外站](https://example.com/a.png)',
        '',
        '![站内](/data/b.png)',
        '',
        '[cover]: ./cover.png "标题"',
      ].join('\n'),
      { assets: { 'cover.png': 'fake-png' } },
    );

    const { posts } = await loadPostsWithAssets({ contentDir, siteUrl: SITE_URL });
    const html = posts[0]?.html ?? '';
    const source = posts[0]?.source ?? '';

    expect(html).toContain('src="/blog/references/cover.png"');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('src="/data/b.png"');
    expect(source).toContain(`[cover]: ${SITE_URL}/blog/references/cover.png "标题"`);
    expect(source).toContain('![外站](https://example.com/a.png)');
    expect(source).toContain('![站内](/data/b.png)');
  });

  it('fails on missing images and paths that escape the post folder', async () => {
    writeFolderPost('missing', '![x](./nope.png)');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/not found/);

    rmSync(contentDir, { recursive: true, force: true });
    contentDir = mkdtempSync(path.join(tmpdir(), 'bl-blog-'));
    writeFolderPost('escape', '![x](../outside.png)');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/outside the post folder/);
  });

  it('rejects relative images in legacy flat posts', async () => {
    writePost('flat.md', FRONTMATTER, '![x](./cover.png)');
    await expect(loadPosts({ contentDir })).rejects.toThrow(/own folder/);
  });

  it('accepts a non-ASCII folder when frontmatter supplies the slug', async () => {
    writeFolderPost('中文目录', '正文', { frontmatter: `${FRONTMATTER}\nslug: ascii-slug` });
    await expect(loadPosts({ contentDir })).resolves.toMatchObject([{ slug: 'ascii-slug' }]);
  });

  it('does not copy assets for drafts in production', async () => {
    writeFolderPost('draft-post', '![x](./cover.png)', {
      frontmatter: `${FRONTMATTER}\ndraft: true`,
      assets: { 'cover.png': 'fake-png' },
    });

    const published = await loadPostsWithAssets({ contentDir });
    expect(published.posts).toHaveLength(0);
    expect(published.assets).toHaveLength(0);

    const development = await loadPostsWithAssets({ contentDir, includeDrafts: true });
    expect(development.posts).toHaveLength(1);
    expect(development.assets).toHaveLength(1);
  });
});

describe('reading time', () => {
  it('counts Chinese characters at 400 per minute, rounding up', () => {
    expect(estimateReadingMinutes('中'.repeat(400))).toBe(1);
    expect(estimateReadingMinutes('中'.repeat(401))).toBe(2);
    expect(estimateReadingMinutes('中'.repeat(800))).toBe(2);
    expect(estimateReadingMinutes('')).toBe(1);
  });

  it('counts English words at 200 per minute', () => {
    expect(estimateReadingMinutes('word '.repeat(200))).toBe(1);
    expect(estimateReadingMinutes('word '.repeat(201))).toBe(2);
  });

  it('adds both rates before rounding', () => {
    // 200 CJK (0.5 min) + 100 words (0.5 min) = exactly one minute.
    expect(estimateReadingMinutes(`${'中'.repeat(200)} ${'word '.repeat(100)}`)).toBe(1);
  });
});

describe('markdown pipeline', () => {
  it('adds heading ids, anchor links and collects h2/h3 headings', async () => {
    writePost(
      'headings.md',
      FRONTMATTER,
      ['## 第一小节', '', '正文', '', '### 嵌套小节', '', '更多正文', '', '## 第二小节'].join('\n'),
    );
    const [post] = await loadPosts({ contentDir });

    expect(post?.headings).toEqual([
      { id: '第一小节', text: '第一小节', level: 2 },
      { id: '嵌套小节', text: '嵌套小节', level: 3 },
      { id: '第二小节', text: '第二小节', level: 2 },
    ]);
    expect(post?.html).toContain('id="第一小节"');
    expect(post?.html).toContain('class="bl-heading-anchor"');
    expect(post?.html).toMatch(/href="#[^"]+"/);
  });

  it('opens external links in a new tab and leaves internal links alone', async () => {
    writePost(
      'links.md',
      FRONTMATTER,
      '[外站](https://example.com/page) 与 [站内](/tier)。',
    );
    const [post] = await loadPosts({ contentDir, siteUrl: SITE_URL });
    const html = post?.html ?? '';

    expect(html).toMatch(
      /<a href="https:\/\/example\.com\/page"[^>]*target="_blank"[^>]*rel="noreferrer"/,
    );
    expect(html).toMatch(/<a href="\/tier"[^>]*>站内<\/a>/);
    expect(html).not.toMatch(/<a href="\/tier"[^>]*target=/);
  });

  it('drops raw HTML and unsafe link protocols', async () => {
    writePost(
      'unsafe.md',
      FRONTMATTER,
      ['<script>alert(1)</script>', '', '[bad](javascript:alert(1))'].join('\n'),
    );
    const [post] = await loadPosts({ contentDir });
    const html = post?.html ?? '';

    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  it('highlights fenced code with Shiki classes and no inline background', async () => {
    writePost(
      'code.md',
      FRONTMATTER,
      ['```json', '{ "serial": 1020 }', '```'].join('\n'),
    );
    const [post] = await loadPosts({ contentDir });
    const html = post?.html ?? '';

    expect(html).toContain('data-rehype-pretty-code-figure');
    expect(html).toContain('data-language="json"');
    expect(html).toContain('data-theme="github-dark"');
    expect(html).toContain('color:#');
    expect(html).not.toContain('background-color');
  });
});

describe('tags', () => {
  it('aggregates tags with counts and matches posts to a tag', async () => {
    writePost(
      'a.md',
      `${FRONTMATTER}\nslug: alpha\ntags:\n  - 数据\n  - 说明`,
      '正文',
    );
    writePost(
      'b.md',
      'title: 另一篇\ndate: 2026-10-01\nsummary: 摘要\nslug: beta\ntags:\n  - 数据',
      '正文',
    );
    writePost('c.md', 'title: 第三篇\ndate: 2026-09-01\nsummary: 摘要\nslug: gamma', '正文');
    const all = await loadPosts({ contentDir });

    expect(collectTags(all)).toEqual([
      { tag: '数据', slug: encodeURIComponent('数据'), count: 2 },
      { tag: '说明', slug: encodeURIComponent('说明'), count: 1 },
    ]);
    expect(tagSlug('数据')).toBe(encodeURIComponent('数据'));

    const alpha = all.find((post) => post.slug === 'alpha');
    expect(alpha === undefined ? [] : postTagSlugs(alpha)).toEqual(
      ['数据', '说明'].map((tag) => encodeURIComponent(tag)),
    );

    expect(postsByTag(all, '数据').map((post) => post.slug)).toEqual(['alpha', 'beta']);
    expect(findTag(all, encodeURIComponent('数据'))?.tag).toBe('数据');
    expect(findTag(all, '数据')?.tag).toBe('数据');
    expect(findTag(all, '不存在')).toBeNull();
  });

  it('orders adjacent posts newest first', async () => {
    writePost('a.md', `${FRONTMATTER}\nslug: alpha`, '正文');
    writePost('b.md', 'title: 另一篇\ndate: 2026-10-01\nsummary: 摘要\nslug: beta', '正文');
    writePost('c.md', 'title: 第三篇\ndate: 2026-09-01\nsummary: 摘要\nslug: gamma', '正文');
    const all = await loadPosts({ contentDir });

    expect(adjacentPosts(all, 'beta')).toMatchObject({
      newer: { slug: 'alpha' },
      older: { slug: 'gamma' },
    });
    expect(adjacentPosts(all, 'alpha').newer).toBeNull();
    expect(adjacentPosts(all, 'gamma').older).toBeNull();
  });
});

describe('virtual:blog-posts payload', () => {
  it('contains both sample posts with rendered HTML', () => {
    // Test mode keeps drafts, so assert the samples are present rather than
    // hard-coding the total number of content files.
    expect(posts.map((post) => post.slug)).toEqual(
      expect.arrayContaining(['card-data', 'tier-guide']),
    );

    const guide = posts.find((post) => post.slug === 'tier-guide');
    expect(guide?.title).toBe('节奏榜使用说明');
    expect(guide?.tags).toEqual(['节奏榜', '使用说明']);
    expect(guide?.headings.filter((heading) => heading.level === 2).length).toBeGreaterThanOrEqual(3);
    expect(guide?.html).toContain('id="打开节奏榜"');

    const cardData = posts.find((post) => post.slug === 'card-data');
    expect(cardData?.title).toBe('卡片数据字段说明');
    expect(cardData?.html).toContain('data-language="json"');
    expect(cardData?.source.startsWith('---')).toBe(true);
  });
});

function renderAt(element: ReturnType<typeof createElement>, entry: string, routePath: string) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: routePath, element }),
      ),
    ),
  );
}

describe('Open Graph metadata', () => {
  const FALLBACK = {
    title: '血族资源站',
    description: '站点简介',
    type: 'website' as const,
  };

  it('falls back to the site defaults when no route declares a handle', () => {
    expect(resolveOgMetadata([], FALLBACK)).toEqual(FALLBACK);
    expect(resolveOgMetadata([{ params: {}, handle: undefined }], FALLBACK)).toEqual(FALLBACK);
  });

  it('uses the deepest matching handle instead of stacking page and site tags', () => {
    const matches = [
      { params: {}, handle: { og: { title: '博客', description: '列表', type: 'website' } } },
      {
        params: { slug: 'tier-guide' },
        handle: {
          og: (params: Record<string, string | undefined>) => ({
            title: `文章：${params.slug ?? ''}`,
            description: '文章摘要',
            type: 'article' as const,
          }),
        },
      },
    ];

    expect(resolveOgMetadata(matches, FALLBACK)).toEqual({
      title: '文章：tier-guide',
      description: '文章摘要',
      type: 'article',
    });
  });

  it('resolves the article handle to the real post title and summary', () => {
    const og = postHandle.og;
    expect(typeof og).toBe('function');
    if (typeof og !== 'function') {
      return;
    }

    const guide = posts.find((post) => post.slug === 'tier-guide');
    expect(og({ slug: 'tier-guide' })).toEqual({
      title: '节奏榜使用说明',
      description: guide?.summary,
      type: 'article',
    });
  });
});

describe('blogContent plugin', () => {
  async function loadVirtualPayload(
    plugin: ReturnType<typeof blogContent>,
    mode: string,
  ): Promise<string> {
    type ConfigResolvedHook = (config: { mode: string }) => void;
    type LoadHook = (id: string) => Promise<string | null | undefined>;

    const configResolved = plugin.configResolved as unknown as ConfigResolvedHook | undefined;
    configResolved?.({ mode });

    const rawLoad = plugin.load;
    const load =
      typeof rawLoad === 'function'
        ? (rawLoad as unknown as LoadHook)
        : (rawLoad as unknown as { handler: LoadHook }).handler;

    const moduleCode = await load(`\0${BLOG_VIRTUAL_MODULE_ID}`);
    if (typeof moduleCode !== 'string') {
      throw new Error('virtual:blog-posts did not return a module');
    }
    return moduleCode;
  }

  it('filters drafts when configResolved sees production mode', async () => {
    writePost('published.md', `${FRONTMATTER}\nslug: published`, '正文');
    writePost('draft.md', `${FRONTMATTER}\ndraft: true\nslug: draft`, '正文');

    const development = await loadVirtualPayload(blogContent({ contentDir }), 'development');
    expect(development).toContain('"slug":"published"');
    expect(development).toContain('"slug":"draft"');

    const production = await loadVirtualPayload(blogContent({ contentDir }), 'production');
    expect(production).toContain('"slug":"published"');
    expect(production).not.toContain('"slug":"draft"');
  });

  it('emits referenced images into the client bundle', async () => {
    writeFolderPost('plugin-post', '![x](./cover.png)', {
      assets: { 'cover.png': 'fake-png' },
    });

    const plugin = blogContent({ contentDir, siteUrl: SITE_URL });
    await loadVirtualPayload(plugin, 'production');

    type Emitted = { type: string; fileName: string; source: unknown };
    type GenerateHook = (this: {
      environment: { name: string };
      emitFile: (file: Emitted) => void;
    }) => Promise<void>;

    const raw = plugin.generateBundle;
    const generateBundle = (
      typeof raw === 'function' ? raw : (raw as { handler: unknown }).handler
    ) as GenerateHook;

    const emitted: Emitted[] = [];
    await generateBundle.call({
      environment: { name: 'client' },
      emitFile: (file) => {
        emitted.push(file);
      },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'asset',
      fileName: 'blog/plugin-post/cover.png',
    });
    expect(Buffer.isBuffer(emitted[0]?.source)).toBe(true);
    expect(String(emitted[0]?.source)).toBe('fake-png');
  });
});

describe('PostList', () => {
  it('renders newest first with tag links', async () => {
    writePost(
      'older.md',
      'title: 较旧的文章\ndate: 2026-10-01\nsummary: 旧摘要\nslug: older\ntags:\n  - 数据',
      '正文',
    );
    writePost(
      'newer.md',
      'title: 较新的文章\ndate: 2026-11-02\nsummary: 新摘要\nslug: newer\ntags:\n  - 节奏榜',
      '正文',
    );
    const all = await loadPosts({ contentDir });

    render(
      createElement(
        MemoryRouter,
        null,
        createElement(PostList, { posts: all }),
      ),
    );

    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(within(articles[0] as HTMLElement).getByText('较新的文章')).toBeInTheDocument();
    expect(within(articles[1] as HTMLElement).getByText('较旧的文章')).toBeInTheDocument();

    const tagLink = screen.getByRole('link', { name: '节奏榜' });
    expect(tagLink.getAttribute('href')).toBe(`/blog/tag/${encodeURIComponent('节奏榜')}`);
    expect(within(articles[0] as HTMLElement).getByText('约 1 分钟')).toBeInTheDocument();
    expect(within(articles[0] as HTMLElement).getByText('2026-11-02')).toBeInTheDocument();
  });

  it('shows the empty state when every post is a draft', async () => {
    writePost('draft.md', `${FRONTMATTER}\ndraft: true`, '正文');
    const all = await loadPosts({ contentDir });

    render(
      createElement(
        MemoryRouter,
        null,
        createElement(PostList, { posts: all }),
      ),
    );

    expect(screen.getByText('暂无文章')).toBeInTheDocument();
  });
});

describe('Toc', () => {
  const headings = (levels: readonly (2 | 3)[]): PostHeading[] =>
    levels.map((level, index) => ({
      id: `section-${index}`,
      text: `小节 ${index}`,
      level,
    }));

  it('renders only with at least three h2 headings', () => {
    const { rerender } = render(createElement(Toc, { headings: headings([2, 2]) }));
    expect(screen.queryByRole('navigation', { name: '文章目录' })).toBeNull();

    rerender(createElement(Toc, { headings: headings([2, 3, 2, 2]) }));
    const nav = screen.getByRole('navigation', { name: '文章目录' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: '小节 0' }).getAttribute('href')).toBe('#section-0');
  });
});

describe('blog routes', () => {
  function hasNoindex(descriptors: ReturnType<typeof postMeta>): boolean {
    return descriptors.some((descriptor) => {
      if (typeof descriptor !== 'object' || descriptor === null) {
        return false;
      }
      const record = descriptor as Record<string, unknown>;
      return record.name === 'robots' && record.content === 'noindex';
    });
  }

  it('marks unknown articles and tags noindex, known pages indexable', () => {
    expect(hasNoindex(postMeta({ params: { slug: 'nope' } } as never))).toBe(true);
    expect(hasNoindex(postMeta({ params: { slug: 'tier-guide' } } as never))).toBe(false);

    expect(hasNoindex(tagMeta({ params: { tag: '不存在' } } as never))).toBe(true);
    expect(
      hasNoindex(tagMeta({ params: { tag: encodeURIComponent('数据') } } as never)),
    ).toBe(false);
  });

  it('shows posts for a known tag, newest first', () => {
    renderAt(createElement(BlogTag), '/blog/tag/数据', '/blog/tag/:tag');

    expect(screen.getByRole('heading', { level: 1, name: '标签：数据' })).toBeInTheDocument();
    const articles = screen.getAllByRole('article');
    expect(within(articles[0] as HTMLElement).getByText('卡片数据字段说明')).toBeInTheDocument();
  });

  it('renders the tag page for an encoded URL', () => {
    renderAt(createElement(BlogTag), '/blog/tag/%E6%95%B0%E6%8D%AE', '/blog/tag/:tag');

    expect(screen.getByRole('heading', { level: 1, name: '标签：数据' })).toBeInTheDocument();
    expect(screen.getByText('卡片数据字段说明')).toBeInTheDocument();
  });

  it('renders the unknown-tag copy', () => {
    renderAt(createElement(BlogTag), '/blog/tag/不存在的标签', '/blog/tag/:tag');

    expect(
      screen.getByRole('heading', { level: 1, name: '标签：不存在的标签' }),
    ).toBeInTheDocument();
    expect(screen.getByText('没有该标签的文章。')).toBeInTheDocument();
  });

  it('renders the article body, TOC, JSON-LD and previous/next links', () => {
    const { container } = renderAt(createElement(BlogPost), '/blog/tier-guide', '/blog/:slug');

    expect(screen.getByRole('heading', { level: 1, name: '节奏榜使用说明' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '文章目录' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /上一篇：卡片数据字段说明/ }).getAttribute('href'),
    ).toBe('/blog/card-data');

    const jsonLd = container.querySelector('script[type="application/ld+json"]');
    expect(jsonLd).not.toBeNull();
    const parsed: unknown = JSON.parse(jsonLd?.innerHTML ?? '{}');
    expect(parsed).toMatchObject({
      '@type': 'BlogPosting',
      headline: '节奏榜使用说明',
      datePublished: '2026-11-01',
      mainEntityOfPage: `${SITE_URL}/blog/tier-guide`,
      inLanguage: 'zh-CN',
    });
  });

  it('links to the older post from the newest article', () => {
    renderAt(createElement(BlogPost), '/blog/card-data', '/blog/:slug');

    expect(
      screen.getByRole('link', { name: /下一篇：节奏榜使用说明/ }).getAttribute('href'),
    ).toBe('/blog/tier-guide');
  });

  it('renders the missing-article state for an unknown slug', () => {
    renderAt(createElement(BlogPost), '/blog/nope', '/blog/:slug');

    expect(screen.getByRole('heading', { level: 1, name: '文章不存在' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回博客列表' }).getAttribute('href')).toBe('/blog');
  });
});
