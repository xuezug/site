import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { distFileFor, stubCardIcons } from './support/harness';

declare global {
  interface Window {
    /** LCP start times collected by the init script below. */
    __lcp?: number[];
  }
}

type ResourceSample = {
  pathname: string;
  initiatorType: string;
  encodedBodySize: number;
  transferSize: number;
};

const KB = 1024;

function format(bytes: number): string {
  return bytes >= KB * KB ? `${(bytes / (KB * KB)).toFixed(2)}MB` : `${String(Math.round(bytes / KB))}KB`;
}

/** Serve icons locally and stop the 916-image load from evicting timing entries. */
async function prepare(page: Page): Promise<void> {
  await stubCardIcons(page);
  await page.addInitScript(() => {
    window.__lcp = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__lcp?.push(entry.startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // Older engines: the spec falls back to getEntriesByType below.
    }
    // The default resource-timing buffer holds 250 entries; /tier loads 916
    // images and would push the script/CSS entries out before we read them.
    performance.setResourceTimingBufferSize(5000);
  });
}

async function collectResources(page: Page): Promise<ResourceSample[]> {
  return page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => {
      const timing = entry as PerformanceResourceTiming;
      return {
        pathname: new URL(timing.name).pathname,
        initiatorType: timing.initiatorType,
        encodedBodySize: timing.encodedBodySize,
        transferSize: timing.transferSize,
      };
    }),
  );
}

/**
 * Bytes the browser received. `encodedBodySize` is the spec's primary source;
 * if the engine reports 0 for everything, fall back to the size of the file the
 * preview server sent (same artifact, just without the HTTP layer).
 */
function bytesOf(sample: ResourceSample): number {
  return sample.encodedBodySize > 0 ? sample.encodedBodySize : fs.statSync(distFileFor(sample.pathname)).size;
}

function gzipOf(sample: { pathname: string }): number {
  return gzipSync(fs.readFileSync(distFileFor(sample.pathname))).length;
}

function pick(samples: ResourceSample[], extension: '.js' | '.css'): ResourceSample[] {
  return samples.filter((sample) => sample.pathname.endsWith(extension));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

test.describe('性能预算', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('/tier 首屏：DOMContentLoaded < 5s 且记录到 LCP', async ({ page }) => {
    const startedAt = Date.now();
    await page.goto('/tier');
    await page.getByTestId('pool-card').first().waitFor();
    await page.waitForLoadState('load');
    const wallClock = Date.now() - startedAt;

    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (entry === undefined) {
        return null;
      }
      return {
        domContentLoaded: entry.domContentLoadedEventEnd,
        load: entry.loadEventEnd,
        encodedBodySize: entry.encodedBodySize,
      };
    });

    expect(navigation).not.toBeNull();
    const dcl = navigation?.domContentLoaded ?? Number.POSITIVE_INFINITY;
    expect(dcl).toBeLessThan(5000);

    // LCP is observer-only in Chrome; poll for the first entry (≤3s).
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__lcp ?? []).concat(
              performance
                .getEntriesByType('largest-contentful-paint')
                .map((entry) => entry.startTime),
            ).length,
          ),
        { timeout: 3000, message: '没有收到 largest-contentful-paint 条目' },
      )
      .toBeGreaterThan(0);

    const lcp = await page.evaluate(
      () =>
        (window.__lcp ?? []).concat(
          performance.getEntriesByType('largest-contentful-paint').map((entry) => entry.startTime),
        )[0] ?? -1,
    );
    expect(lcp).toBeGreaterThanOrEqual(0);

    console.log(
      `[perf] /tier  首屏 DCL=${dcl.toFixed(0)}ms  load=${String(navigation?.load.toFixed(0))}ms  ` +
        `LCP=${lcp.toFixed(0)}ms  (测试墙钟 ${String(wallClock)}ms)`,
    );
  });

  test('/tier 传输体积与 /data/cards.json 体积', async ({ page, request }, testInfo) => {
    await page.goto('/tier');
    await page.getByTestId('pool-card').first().waitFor();
    await page.waitForLoadState('load');

    const samples = await collectResources(page);
    const scripts = pick(samples, '.js');
    const styles = pick(samples, '.css');
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      return entry === undefined ? 0 : entry.encodedBodySize;
    });

    expect(scripts.length).toBeGreaterThanOrEqual(5);
    expect(styles.length).toBeGreaterThanOrEqual(1);
    // No `encodedBodySize > 0` precondition: an engine that reports 0 for every
    // entry must reach `bytesOf()`'s file-size fallback instead of failing here.

    const htmlBytes = navigation > 0 ? navigation : fs.statSync(distFileFor('/tier')).size;
    const jsBytes = sum(scripts.map(bytesOf));
    const cssBytes = sum(styles.map(bytesOf));
    const wireTotal = htmlBytes + jsBytes + cssBytes;

    // gzip 传输: the preview server has no compression, so the gzip number is
    // computed from the exact files it served — that is what a CDN would send.
    const gzipTotal =
      gzipOf({ pathname: '/tier' }) + sum([...scripts, ...styles].map((sample) => gzipOf(sample)));

    const budget = 1.2 * KB * KB;
    expect(gzipTotal).toBeLessThan(budget);

    // The standalone data endpoint has its own (looser) budget.
    const cardsResponse = await request.get('/data/cards.json');
    expect(cardsResponse.status()).toBe(200);
    const cardsBody = await cardsResponse.body();
    expect(cardsBody.length).toBeLessThan(300 * KB);

    const line =
      `[perf] /tier  html=${format(htmlBytes)}  js=${format(jsBytes)}(${String(scripts.length)})  ` +
      `css=${format(cssBytes)}(${String(styles.length)})  未压缩合计=${format(wireTotal)}  ` +
      `gzip=${format(gzipTotal)}  |  cards.json raw=${format(cardsBody.length)} gzip=${format(gzipSync(cardsBody).length)}`;
    console.log(line);
    testInfo.annotations.push({ type: 'perf', description: line });
  });

  test('/blog/tier-guide 的 JS 传输 < 600KB', async ({ page }, testInfo) => {
    await page.goto('/blog/tier-guide');
    await page.getByRole('main').getByRole('heading', { level: 1 }).waitFor();
    await page.waitForLoadState('load');

    const scripts = pick(await collectResources(page), '.js');
    expect(scripts.length).toBeGreaterThanOrEqual(3);

    const jsBytes = sum(scripts.map(bytesOf));
    const jsGzip = sum(scripts.map((sample) => gzipOf(sample)));
    expect(jsBytes).toBeLessThan(600 * KB);

    const line = `[perf] /blog/tier-guide  js=${format(jsBytes)}(${String(scripts.length)})  gzip=${format(jsGzip)}`;
    console.log(line);
    testInfo.annotations.push({ type: 'perf', description: line });
  });
});
