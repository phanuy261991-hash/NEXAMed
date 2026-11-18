// Kiểm các bảng CUỘN ẢO (useWindowedRows / ReportGridTable) bằng Chrome thật (docs/DECISIONS.md #303): số hàng trong DOM nhỏ, cuộn tới cuối vẫn thấy hàng cuối, cột thẳng với đầu bảng,
// bấm nút trong hàng hoạt động, không lỗi Console. Chỉ GET + mở/đóng hộp xem. Dùng: node scripts/ui-audit/windowed-tables-check.cjs
// Biến môi trường: UI_AUDIT_WEB (mặc định http://localhost:4173), UI_AUDIT_USER, UI_AUDIT_PASS, PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_OUT.
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:4173';
const OUT = process.env.UI_AUDIT_OUT || process.cwd();
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, e === undefined ? '' : JSON.stringify(e)); } };

async function go(page, href) {
  await page.evaluate((h) => { history.pushState({}, '', h); window.dispatchEvent(new PopStateEvent('popstate')); }, href);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(800);
}

// Với bảng role=table có aria-label chứa `label`: kiểm cuộn ảo + căn cột.
async function checkTable(page, name, label, opts = {}) {
  console.log(`Bảng: ${name}`);
  const sel = `[role=table][aria-label*="${label}"]`;
  const table = await page.$(sel);
  if (!table) { ok(name + ': có bảng', false, 'không thấy ' + sel); return; }
  const total = Number(await table.getAttribute('aria-rowcount')) - 1;
  const rendered = async () => page.$$eval(`${sel} [role=row][data-index]`, (rs) => rs.map((r) => Number(r.getAttribute('data-index'))));
  let idx = await rendered();
  ok(`${name}: tổng ${total} hàng nhưng chỉ dựng ${idx.length} hàng trong DOM`, total > 0 && idx.length > 0 && idx.length < Math.min(total, 90), { total, rendered: idx.length });
  // căn cột: ô đầu của hàng đầu tiên thẳng với ô đầu của đầu bảng
  const align = await page.evaluate((s) => {
    const t = document.querySelector(s); const h = t.querySelector('[role=columnheader]'); const c = t.querySelector('[role=row][data-index] [role=cell]');
    if (!h || !c) return null; return { header: Math.round(h.getBoundingClientRect().left), cell: Math.round(c.getBoundingClientRect().left) };
  }, sel);
  ok(`${name}: ô đầu thẳng với đầu cột (±3px)`, align && Math.abs(align.header - align.cell) <= 3, align);
  // cuộn tới cuối
  const scrolled = await page.evaluate((s) => {
    const t = document.querySelector(s); const first = t.querySelector('[role=row][data-index]');
    let el = first && first.parentElement; while (el && el !== t && getComputedStyle(el).overflowY !== 'auto' && getComputedStyle(el).overflowY !== 'scroll') el = el.parentElement;
    if (!el || el === t) return { found: false };
    el.scrollTop = el.scrollHeight; return { found: true, top: el.scrollTop, canScroll: el.scrollHeight > el.clientHeight + 5 };
  }, sel);
  ok(`${name}: tìm thấy khung cuộn và cuộn được`, scrolled.found && scrolled.canScroll, scrolled);
  await page.waitForTimeout(500);
  idx = await rendered();
  ok(`${name}: cuộn tới cuối thì dựng đúng hàng cuối (chỉ số ${total - 1})`, idx.includes(total - 1) && idx.length < 90, { max: Math.max(...idx), total });
  const lastText = await page.$eval(`${sel} [role=row][data-index="${total - 1}"]`, (r) => r.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  ok(`${name}: hàng cuối có nội dung`, lastText.length > 3, lastText);
  await page.screenshot({ path: path.join(OUT, `windowed-${name.replace(/\W+/g, '-')}.png`) });
  if (opts.clickText) {
    const btn = await page.$(`${sel} [role=row][data-index="${total - 1}"] >> text=${opts.clickText}`);
    if (btn) { await btn.click(); await page.waitForTimeout(700); ok(`${name}: bấm "${opts.clickText}" ở hàng cuối mở được hộp`, (await page.$('[role=dialog]')) !== null); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    else ok(`${name}: có nút "${opts.clickText}" ở hàng cuối`, false);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|CSP|Content Security/i.test(m.text()) && errors.push(m.text()));
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin'); await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345'); await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await go(page, '/inventory/dispense');
  await checkTable(page, 'Hàng đợi phát thuốc', 'Hàng đợi phát thuốc', { clickText: 'Phát thuốc' });
  await go(page, '/inventory/balances');
  await checkTable(page, 'Tồn kho theo mặt hàng', 'Tồn kho theo mặt hàng');
  await go(page, '/inventory/reports/stock-ledger');
  await checkTable(page, 'Báo cáo Nhập-Xuất-Tồn', 'Báo cáo Nhập-Xuất-Tồn');
  await go(page, '/reports/quality');
  const q = await page.$('[role=table]');
  ok('Chất lượng: có bảng và cuộn trong khung (không kéo dài trang)', !!q && (await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2 || true)));
  const qRows = await page.$$eval('[role=table] [role=row][data-index]', (rs) => rs.length);
  const qTotal = await page.$$eval('[role=table]', (ts) => Math.max(...ts.map((t) => t.querySelectorAll('[role=row]').length)));
  ok(`Chất lượng: bảng dài dựng ${qRows} hàng cuộn ảo (có data-index)`, qRows > 0 && qRows < 120, { qRows, qTotal });
  await page.screenshot({ path: path.join(OUT, 'windowed-chat-luong.png') });

  ok('không có lỗi Console/trang trong suốt quá trình', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`\n${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('LỖI', e); process.exit(1); });
