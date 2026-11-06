/* global require, process, console, document, getComputedStyle */
// QUÉT lỗi "khung bị bóp, nội dung bị cắt" (phát hiện 06/11/2026 ở Trung tâm báo cáo: khung bảng có `overflow-hidden` nằm trong cột flex cao cố định bị co lại, dòng cuối bị cắt, trang không cuộn).
// Cách phát hiện: duyệt mọi route không tham số trong `apps/web/src/app/router.tsx`, ở hai cỡ màn hình; tìm phần tử có `overflow-y: hidden/clip` mà nội dung cao hơn khung (`scrollHeight > clientHeight`).
// Phần tử là con của cột flex được đánh dấu `flexColChild` — đúng kiểu lỗi trên (thiếu `flex-shrink-0`). Dòng chữ cắt bằng dấu "…" (`truncate`, `line-clamp`) là hợp lệ, được lọc theo `text-overflow`/`-webkit-line-clamp`.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://localhost:5173 node scripts/ui-audit/clipped-content-audit.cjs   (API + web đang chạy)
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const ROUTER = path.join(__dirname, '../../apps/web/src/app/router.tsx');
const SIZES = [
  [1440, 800],
  [1280, 720],
];

function listRoutes() {
  const src = fs.readFileSync(ROUTER, 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/path:\s*'([^']*)'/g)) {
    const p = m[1];
    if (p === '' || p === '*' || p.includes(':') || p.includes('*') || p.startsWith('login') || p.startsWith('platform')) continue;
    found.add('/' + p.replace(/^\//, ''));
  }
  return [...found].sort();
}

async function login(page) {
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
  await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

function detect() {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.overflowY !== 'hidden' && cs.overflowY !== 'clip') continue;
    if (el.clientHeight < 20 || el.scrollHeight <= el.clientHeight + 3) continue;
    if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '') continue;
    if (el.closest('[aria-hidden="true"], .sr-only, svg')) continue;
    const par = el.parentElement;
    const pcs = par ? getComputedStyle(par) : null;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 90),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      flexColChild: !!pcs && pcs.display.includes('flex') && pcs.flexDirection.startsWith('column'),
      parentCls: par ? String(par.className).slice(0, 70) : '',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] } });
  const page = await ctx.newPage();
  await login(page);
  const routes = listRoutes();
  console.log(`Quét ${routes.length} route × ${SIZES.length} cỡ màn hình`);
  const findings = [];
  for (const route of routes) {
    for (const [w, h] of SIZES) {
      try {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(WEB + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        for (const f of await page.evaluate(detect)) findings.push({ route, size: `${w}×${h}`, ...f });
      } catch (e) {
        console.log(`BỎ QUA ${route} ${w}×${h}: ${String(e.message).slice(0, 80)}`);
      }
    }
  }
  const unique = new Map();
  for (const f of findings) {
    const key = `${f.route}|${f.cls}|${f.parentCls}`;
    if (!unique.has(key)) unique.set(key, { ...f, sizes: [f.size] });
    else unique.get(key).sizes.push(f.size);
  }
  const rows = [...unique.values()].sort((a, b) => Number(b.flexColChild) - Number(a.flexColChild));
  for (const f of rows) {
    console.log(`${f.flexColChild ? 'NGHI VẤN' : 'xem lại '} ${f.route} [${f.sizes.join(', ')}] <${f.tag}> cao ${f.clientHeight}/${f.scrollHeight}  class="${f.cls}"  cha="${f.parentCls}"  «${f.text}»`);
  }
  console.log(`\n${rows.filter((r) => r.flexColChild).length} nghi vấn (con của cột flex), ${rows.length} tổng`);
  await browser.close();
  process.exit(0);
})();
