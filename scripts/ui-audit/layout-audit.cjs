/* global require, process, __dirname, console, fetch, document, window, getComputedStyle, innerWidth, innerHeight */
// Công cụ kiểm giao diện (docs/DECISIONS.md #240, .claude/docs/ui-guidelines.md mục 15–16). Cần: `npm i playwright-core` ở thư mục tạm + Chrome; web (5173) và API (3001) đang chạy.
// Cấu hình qua biến môi trường: UI_AUDIT_WEB, UI_AUDIT_API, UI_AUDIT_TENANT, UI_AUDIT_USER, UI_AUDIT_PASS, CHROME_PATH. Chỉ mở trang (GET), không ghi dữ liệu.
// Kiểm bố cục TOÀN APP trên nhiều cỡ màn hình (Chrome thật, vite 5173 + API 3001 + Postgres dev).
// Chạy tuần tự trong MỘT phiên đăng nhập (refresh token xoay vòng, không chạy song song). Không ghi dữ liệu: chỉ mở trang (GET).
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = (process.env.UI_AUDIT_WEB || 'http://localhost:5173');
const API = process.env.UI_AUDIT_API || 'http://localhost:3001/api/v1';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const OUT = path.join(process.env.UI_AUDIT_OUT || process.cwd(), 'ui-audit-out');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  ['1280x720', 1280, 720], ['1366x657', 1366, 657], ['1440x900', 1440, 900], ['1536x730', 1536, 730], ['1920x969', 1920, 969],
  ['2560x1300', 2560, 1300], ['3440x1440', 3440, 1440], ['3840x2160', 3840, 2160], ['1024x768', 1024, 768], ['768x1024', 768, 1024],
];

const STATIC_ROUTES = [
  '/', '/patients', '/patients/new', '/appointments', '/reception', '/reception/new', '/reception/doctor-queue',
  '/billing', '/billing/cashier-shifts', '/cash-book/vouchers', '/cash-book/ledger', '/cash-book/report', '/cash-book/wallets',
  '/inventory/balances', '/inventory/receipts', '/inventory/receipts/new', '/inventory/issues', '/inventory/issues/manual/new', '/inventory/dispense',
  '/inventory/counts', '/inventory/counts/new', '/inventory/transfers', '/inventory/transfers/new', '/inventory/reports/stock-ledger', '/inventory/reports/transfer-shrinkage',
  '/paraclinical/queue', '/paraclinical/orders', '/paraclinical/results', '/paraclinical/lab', '/paraclinical/imaging',
  '/suppliers', '/suppliers/debts', '/suppliers/payments', '/work-schedule/mine', '/work-schedule/staff',
  '/admin/catalog', '/admin/catalog-organization', '/admin/catalog-clinical', '/admin/catalog-paraclinical', '/admin/catalog-pharmacy', '/admin/catalog-warehouse',
  '/admin/prescription-templates', '/admin/price-lists', '/admin/print-templates', '/admin/system-config', '/admin/activity-log',
];

async function apiGet(token, p) {
  try {
    const r = await fetch(API + p, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    return (await r.json()).data;
  } catch { return null; }
}

// Hàm đo chạy TRONG trình duyệt.
function measure() {
  const W = window.innerWidth, H = window.innerHeight;
  const doc = document.documentElement;
  const issues = [];
  const desc = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (txt ? ' "' + txt + '"' : '');
  };
  const visible = (el, r, cs) => r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  const clips = (cs) => ['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX);
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (clips(cs)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1) return true; }
    }
    return false;
  };

  if (doc.scrollWidth > doc.clientWidth + 1) issues.push({ t: 'cuộn-ngang-trang', d: 'scrollWidth ' + doc.scrollWidth + ' > ' + doc.clientWidth });

  const seen = new Set();
  const all = document.body.querySelectorAll('*');
  let offscreen = 0, clippedText = 0;
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, r, cs)) continue;
    // Vượt khỏi mép phải màn hình mà KHÔNG nằm trong vùng cuộn/cắt hợp lệ.
    if (r.right > W + 2 && cs.position !== 'fixed' && !contained(el)) {
      // chỉ báo phần tử "gốc" của nhánh tràn (cha không tràn tương tự) để khỏi lặp.
      const pr = el.parentElement && el.parentElement.getBoundingClientRect();
      if (!pr || pr.right <= W + 2) { if (offscreen < 4) issues.push({ t: 'tràn-phải', d: desc(el) + ' right=' + Math.round(r.right) + '/' + W }); offscreen++; }
    }
    // Chữ bị cắt cứng (overflow ẩn, không có dấu …) — nội dung mất.
    if (clips(cs) && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.scrollWidth > el.clientWidth + 3 && cs.textOverflow !== "ellipsis" && el.clientWidth > 12) {
      const hasText = (el.innerText || '').trim().length > 0;
      const key = el.tagName + el.className;
      if (hasText && !seen.has(key) && el.children.length < 6) { seen.add(key); if (clippedText < 4) issues.push({ t: 'chữ-bị-cắt', d: desc(el) + ' ' + el.scrollWidth + '>' + el.clientWidth }); clippedText++; }
    }
  }
  if (offscreen > 4) issues.push({ t: 'tràn-phải-khác', d: '+' + (offscreen - 4) + ' phần tử' });

  const main = document.querySelector('main');
  if (main) {
    const mr = main.getBoundingClientRect();
    if (W >= 1024 && mr.width < 560) issues.push({ t: 'nội-dung-bó-hẹp', d: 'main rộng ' + Math.round(mr.width) + 'px' });
  }
  const text = (document.body.innerText || '').trim();
  if (text.length < 40) issues.push({ t: 'trang-trắng', d: 'chữ hiển thị ' + text.length + ' ký tự' });
  if (/Something went wrong|Unexpected Application Error/i.test(text)) issues.push({ t: 'lỗi-render', d: text.slice(0, 80) });
  return issues;
}

(async () => {
  const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 969 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push('console: ' + m.text().slice(0, 120)); });

  await page.goto(WEB + '/login');
  await page.fill('#username', (process.env.UI_AUDIT_USER || 'dev.admin'));
  await page.fill('#password', (process.env.UI_AUDIT_PASS || 'Dev@12345'));
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  // Token API riêng để lấy ID thật cho các trang có tham số.
  const lg = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: (process.env.UI_AUDIT_USER || 'dev.admin'), password: (process.env.UI_AUDIT_PASS || 'Dev@12345') }) })).json();
  const token = lg.data.accessToken;
  const routes = STATIC_ROUTES.map((r) => [r, r]);
  const patients = (await apiGet(token, '/patients?limit=100&sort=created_asc'))?.items ?? [];
  let encId = null, patId = null;
  for (const p of patients) {
    const h = await apiGet(token, '/encounters/by-patient/' + p.id + '/history?limit=3');
    if (h?.items?.length) { patId = p.id; encId = h.items[0].encounterId; break; }
  }
  if (patId) routes.push(['/patients/:id', '/patients/' + patId]);
  if (encId) { routes.push(['/encounters/:id', '/encounters/' + encId]); routes.push(['/billing/:encounterId', '/billing/' + encId]); }
  const pick = async (listPath, tpl, label) => { const d = await apiGet(token, listPath); const id = d?.items?.[0]?.id; if (id) routes.push([label, tpl.replace(':id', id)]); };
  await pick('/inventory/receipts?limit=1', '/inventory/receipts/:id', '/inventory/receipts/:id');
  await pick('/inventory/counts?limit=1', '/inventory/counts/:id', '/inventory/counts/:id');
  await pick('/inventory/transfers?limit=1', '/inventory/transfers/:id', '/inventory/transfers/:id');
  await pick('/suppliers?limit=1', '/suppliers/:id', '/suppliers/:id');
  await pick('/price-lists?limit=1', '/admin/price-lists/:id', '/admin/price-lists/:priceListId');

  console.log('Số trang kiểm:', routes.length, '| cỡ màn hình:', VIEWPORTS.length);
  const report = {};
  let n = 0;
  for (const [label, url] of (process.env.ONLY ? routes.filter(([l]) => process.env.ONLY.split(',').includes(l.slice(1))) : routes)) {
    n++;
    report[label] = {};
    errs.length = 0;
    await page.setViewportSize({ width: 1920, height: 969 });
    try { await page.goto(WEB + url, { waitUntil: 'networkidle', timeout: 25000 }); } catch { /* một số trang giữ kết nối; vẫn đo */ }
    await page.waitForTimeout(500);
    if (new URL(page.url()).pathname.startsWith('/login')) { report[label]['_'] = [{ t: 'bị-đá-về-đăng-nhập', d: page.url() }]; console.log('✖', label, 'bị đăng xuất'); continue; }
    let shotTaken = false;
    for (const [vn, w, h] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      const issues = await page.evaluate(measure);
      if (issues.length) {
        report[label][vn] = issues;
        if (!shotTaken && (w <= 1366 || w >= 2560)) { shotTaken = true; await page.screenshot({ path: path.join(OUT, label.replace(/[\/:]/g, '_') + '__' + vn + '.png') }); }
      }
    }
    if (errs.length) report[label]['_js'] = [...new Set(errs)].map((e) => ({ t: 'lỗi-js', d: e }));
    const bad = Object.keys(report[label]).length;
    console.log((bad ? '⚠' : '✓'), String(n).padStart(2), label, bad ? '(' + bad + ' cỡ có vấn đề)' : '');
  }
  fs.writeFileSync(path.join(OUT, process.env.ONLY ? 'report-partial.json' : 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
  console.log('XONG');
})().catch((e) => { console.error('LỖI', e); process.exit(1); });
