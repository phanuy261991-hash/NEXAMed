/* global require, process, console, __dirname */
// QUÉT MỌI route tĩnh khai báo trong apps/web/src/app/router.tsx, giả lập "phần mềm vừa cập nhật → không tải được mã của trang (lazy)" bằng cách chặn đúng các mô-đun trang lazy,
// rồi kiểm từng route hiện đúng màn "Phần mềm vừa được cập nhật" TRONG khung ứng dụng (thanh bên còn nguyên) và không lọt chữ lỗi thô. Kỳ vọng: 47/47 (số route đổi theo router).
// Chặn ĐÚNG các trang lazy (lấy từ router.tsx) — chặn nhầm cả trang tải sẵn (Login/Dashboard) sẽ làm cả ứng dụng không khởi động (màn hình trắng) và cho kết quả 0/N sai.
// Biến môi trường như error-states.cjs. Chạy: node scripts/ui-audit/error-sweep.cjs   (cần `pnpm dev`).
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';

// Lấy mọi đường dẫn tĩnh (không có tham số) khai báo trong router
const src = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/router.tsx'), 'utf8');
const paths = [...src.matchAll(/path: '([^':*]+)'/g)].map((m) => m[1]).filter((p) => !['/login', '/change-password', '/choose-branch', '/'].includes(p));
const routes = [...new Set(paths.map((p) => (p.startsWith('/') ? p : '/' + p)))];
const lazyModules = [...src.matchAll(/import\('\.\.\/features\/([^']+)'\)/g)].map((m) => m[1]);
console.log('Số route tĩnh cần quét:', routes.length, '| số mô-đun trang lazy:', new Set(lazyModules).size);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
  await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  // Chặn MỌI mô-đun trang (lazy) — mô phỏng "phần mềm vừa cập nhật, tên tệp cũ không còn"
  const lazySet = new Set(lazyModules);
  await page.route(/\/src\/features\/[^?]+\.tsx(\?.*)?$/, (route) => {
    const m = route.request().url().match(/\/src\/features\/([^?]+)\.tsx/);
    return m && lazySet.has(m[1]) ? route.abort() : route.continue();
  });

  const FORBIDDEN = /TypeError|Failed to fetch|dynamically imported|Unexpected Application Error|undefined|NOT_FOUND|\.tsx|stack/i;
  let ok = 0;
  const notOutdated = [];
  const leaks = [];
  const noShell = [];
  for (const r of routes) {
    await page.goto(WEB + r, { waitUntil: 'domcontentloaded' });
    let title = null;
    try {
      await page.waitForSelector('#app-error-title', { timeout: 6000 });
      title = (await page.textContent('#app-error-title'))?.trim();
    } catch {
      /* không có màn lỗi (trang tải eager, bị chặn quyền, hoặc chuyển hướng) */
    }
    if (title === 'Phần mềm vừa được cập nhật') {
      ok++;
      const text = await page.evaluate(() => document.body.innerText);
      if (FORBIDDEN.test(text)) leaks.push(r);
      if ((await page.locator('nav').count()) === 0) noShell.push(r);
    } else {
      notOutdated.push(`${r} -> ${title ?? 'không có màn lỗi, URL=' + new URL(page.url()).pathname}`);
    }
  }
  console.log(`\nQuét ${routes.length} route: ${ok} hiện đúng màn "Phần mềm vừa được cập nhật"`);
  console.log(`Lọt chữ lỗi thô: ${leaks.length}${leaks.length ? ' → ' + leaks.join(', ') : ''}`);
  console.log(`Mất thanh bên: ${noShell.length}${noShell.length ? ' → ' + noShell.join(', ') : ''}`);
  console.log(`Không hiện màn lỗi: ${notOutdated.length}`);
  for (const l of notOutdated) console.log('  ' + l);
  await browser.close();
})().catch((e) => { console.error('Lỗi chạy:', e.message); process.exit(1); });
