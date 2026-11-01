/// <reference types="vite/client" />

declare const __SITE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time blog payload; see `plugins/blog-content.ts`. */
declare module 'virtual:blog-posts' {
  const posts: import('./lib/blog/content').Post[];
  export default posts;
}
