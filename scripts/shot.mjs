/**
 * 截图回环(方案 07 三条命脉之一:agent 的眼睛)。
 * 跑法:npm run shot
 * 产物:shots/latest.png(+ 带时间戳的存档)
 *
 * 浏览器优先复用本机 Chrome(免下载);没有则回退 Playwright 自带 Chromium。
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 5199;
const OUT_DIR = resolve('shots');

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    console.log('[shot] 未找到本机 Chrome,回退 Playwright Chromium');
    return await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
    });
  }
}

const server = await createServer({ server: { port: PORT, strictPort: true } });
await server.listen();
console.log(`[shot] vite dev server: http://localhost:${PORT}`);

let exitCode = 0;
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (err) => {
    console.error('[shot] 页面错误:', err.message);
    exitCode = 1;
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[shot] console.error:', msg.text());
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 双机位:俯瞰验证布局,地面验证玩家视角
  for (const mode of ['aerial', 'ground']) {
    await page.goto(`http://localhost:${PORT}/?shot=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 60_000 });
    // 等阴影/实例化/水面首帧完全稳定
    await page.waitForTimeout(1500);
    const file = resolve(OUT_DIR, `island-${mode}-${stamp}.png`);
    await page.screenshot({ path: file });
    copyFileSync(file, resolve(OUT_DIR, mode === 'aerial' ? 'latest.png' : 'latest-ground.png'));
    console.log(`[shot] 已出图: ${file}`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
