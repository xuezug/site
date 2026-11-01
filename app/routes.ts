import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('tier', 'routes/tier.tsx'),
  route('blog', 'routes/blog-list.tsx'),
  route('blog/:slug', 'routes/blog-post.tsx'),
  route('blog/tag/:tag', 'routes/blog-tag.tsx'),
  route('404', 'routes/not-found.tsx'),
  // Unknown paths must keep the branded 404 after hydration: without a splat
  // route the client router matches nothing and replaces the prerendered
  // `404.html` with its own "404 Not Found" screen.
  route('*', 'routes/not-found.tsx', { id: 'catch-all' }),
] satisfies RouteConfig;
