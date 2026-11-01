import { defineConfig } from 'vitest/config';
import { blogContent } from './plugins/blog-content';
import { resolveSiteUrl } from './site-url.resolve';

export default defineConfig(({ mode }) => {
  // Same resolution as vite.config.ts so tests exercise the real injected value.
  const { siteUrl } = resolveSiteUrl(mode, process.env);

  return {
    // Resolves `virtual:blog-posts` for route component tests using the real
    // `content/blog` files (test mode keeps drafts visible).
    plugins: [blogContent({ siteUrl })],
    define: {
      __SITE_URL__: JSON.stringify(siteUrl),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  };
});
