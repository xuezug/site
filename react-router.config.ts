import type { Config } from '@react-router/dev/config';
import { collectTags } from './app/lib/blog/content';
import { loadPosts } from './plugins/blog-content';

export default {
  // Pure client-side app: every route is emitted as static HTML at build time.
  ssr: false,
  // `prerender` also enumerates every published post and tag page. Drafts are
  // excluded by `loadPosts` (production), matching the payload the client gets.
  async prerender() {
    const posts = await loadPosts();
    const paths = ['/', '/tier', '/blog', '/404'];

    for (const post of posts) {
      paths.push(`/blog/${post.slug}`);
    }
    for (const tag of collectTags(posts)) {
      // Must be the decoded tag: React Router compares the *decoded* request
      // path against this list and falls back to the SPA shell on a miss. The
      // output directory is decoded too (e.g. `dist/blog/tag/数据/`); Cloudflare
      // Pages resolves the percent-encoded request URL to that directory.
      paths.push(`/blog/tag/${tag.tag}`);
    }

    return paths;
  },
  // Emit to dist/ so `wrangler pages deploy dist` works as-is.
  buildDirectory: 'dist',
} satisfies Config;
