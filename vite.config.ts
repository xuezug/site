import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { agentArtifacts } from './plugins/agent-artifacts';
import { blogContent } from './plugins/blog-content';
import { resolveSiteUrl } from './site-url.resolve';

export default defineConfig(({ mode }) => {
  const { siteUrl, source } = resolveSiteUrl(mode, process.env);
  // `SITE_URL` is not VITE_-prefixed, so Vite never forwards it; the asset host
  // is, but the config itself needs it for the absolute icon URLs in llms-full.
  const env = loadEnv(mode, process.cwd(), '');

  if (source === 'fallback') {
    console.warn(
      `[vite] SITE_URL is not set in .env, .env.local, or the environment; ` +
        `falling back to ${siteUrl}.`,
    );
  }

  return {
    plugins: [
      blogContent({ siteUrl }),
      agentArtifacts({ siteUrl, assetBase: env.VITE_ASSET_BASE_URL }),
      tailwindcss(),
      reactRouter(),
    ],
    define: {
      __SITE_URL__: JSON.stringify(siteUrl),
    },
  };
});
