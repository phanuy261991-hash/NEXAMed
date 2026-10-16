/* global require, process, __dirname, console, fetch, document, window, getComputedStyle, innerWidth, innerHeight */
// Công cụ kiểm giao diện (docs/DECISIONS.md #240, .claude/docs/ui-guidelines.md mục 15–16). Cần: `npm i playwright-core` ở thư mục tạm + Chrome; web (5173) và API (3001) đang chạy.
// Cấu hình qua biến môi trường: UI_AUDIT_WEB, UI_AUDIT_API, UI_AUDIT_TENANT, UI_AUDIT_USER, UI_AUDIT_PASS, CHROME_PATH. Chỉ mở trang (GET), không ghi dữ liệu.
// Đo độ đậm chữ THẬT (getComputedStyle) theo vai trò trên các trang chính: tiêu đề trang, đầu cột, ô bảng, nhãn, badge, nút.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const ROUTES = [
  '/patients', '/appointments', '/reception', '/reception/doctor-queue', '/billing', '/billing/cashier-shifts', '/cash-book/vouchers', '/cash-book/ledger',
  '/inventory/balances', '/inventory/receipts', '/inventory/issues', '/inventory/counts', '/inventory/transfers', '/suppliers', '/suppliers/debts',
  '/paraclinical/queue', '/paraclinical/orders', '/work-schedule/staff', '/admin/catalog', '/admin/catalog-organization', '/admin/catalog-pharmacy',
  '/admin/catalog-warehouse', '/admin/price-lists', '/admin/activity-log', '/admin/system-config',
];

function collect() {
  const roles = { 'tiêu-đề-trang(h1/h2)': 'h1,h2', 'đầu-cột': 'th,[role=columnheader]', 'ô-bảng': 'td,[role=cell]', 'nhãn(label)': 'label', 'nút(button)': 'button' };
  const out = {};
  for (const [name, sel] of Object.entries(roles)) {
    const hist = {};
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (!(el.innerText || '').trim()) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const w = cs.fontWeight;
      hist[w] = (hist[w] || 0) + 1;
    });
    out[name] = hist;
  }
  // Chữ con bên trong ô bảng (tên đậm ở cột chính thường là <span>/<div> bên trong ô)
  const inner = {};
  document.querySelectorAll('td *, [role=cell] *').forEach((el) => {
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (!t || t === '—') return;
    const r = el.getBoundingClientRect();
    if (r.width < 2) return;
    const w = getComputedStyle(el).fontWeight;
    inner[w] = (inner[w] || 0) + 1;
  });
  out['chữ-trong-ô-bảng'] = inner;
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 969 } });
  await page.goto((process.env.UI_AUDIT_WEB || 'http://localhost:5173') + '/login');
  await page.fill('#username', (process.env.UI_AUDIT_USER || 'dev.admin')); await page.fill('#password', (process.env.UI_AUDIT_PASS || 'Dev@12345')); await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const all = {};
  for (const r of ROUTES) {
    try { await page.goto((process.env.UI_AUDIT_WEB || 'http://localhost:5173') + r, { waitUntil: 'networkidle', timeout: 20000 }); } catch { /* vẫn đo */ }
    await page.waitForTimeout(500);
    all[r] = await page.evaluate(collect);
  }
  fs.writeFileSync(path.join(process.env.UI_AUDIT_OUT || process.cwd(), 'weights.json'), JSON.stringify(all, null, 1));
  // Tổng hợp: theo vai trò, phân bố trên toàn app + trang nào có chữ trong ô bảng ≥ 700.
  const tot = {};
  for (const [route, roles] of Object.entries(all)) for (const [role, hist] of Object.entries(roles)) for (const [w, n] of Object.entries(hist)) { (tot[role] ||= {})[w] = (tot[role][w] || 0) + n; }
  console.log(JSON.stringify(tot, null, 1));
  console.log('\nTrang có chữ trong ô bảng đậm ≥700:');
  for (const [route, roles] of Object.entries(all)) { const h = roles['chữ-trong-ô-bảng']; const heavy = Object.entries(h).filter(([w]) => +w >= 700).reduce((a, [, n]) => a + n, 0); const sum = Object.values(h).reduce((a, n) => a + n, 0); if (sum) console.log(' ', route.padEnd(34), 'đậm ≥700:', heavy + '/' + sum, JSON.stringify(h)); }
  await browser.close();
})();
