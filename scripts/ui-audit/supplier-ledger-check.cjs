/* global require, process, console, window, document, fetch */
// KIỂM tab "Sổ công nợ" của nhà cung cấp/đối tác (docs/DECISIONS.md #292) trên Chrome thật qua IP LAN (HTTP, ngữ cảnh KHÔNG bảo mật — #257): lọc khoảng ngày, dải tổng hợp kỳ, Xuất Excel thật, In,
// kỳ ngược, trạng thái lỗi (500 giữ nguyên bộ lọc, có "Thử lại"), vài cỡ màn hình. Dữ liệu thử tạo qua API bằng dev.admin (nhà cung cấp tiền tố "Kiểm sổ công nợ").
// Chạy: PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_API=http://localhost:3001 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/supplier-ledger-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const API = (process.env.UI_AUDIT_API || 'http://localhost:3001') + '/api/v1';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'supplier-ledger-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack/;
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');
const NAME = `Kiểm sổ công nợ ${String(Date.now()).slice(-6)}`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function call(method, urlPath, token, body) {
  const res = await fetch(API + urlPath, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(method + ' ' + urlPath + ' → ' + res.status + ' ' + JSON.stringify(json).slice(0, 200));
  return json.data;
}

async function seedData() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/web/public/config.json'), 'utf8'));
  const login = await call('POST', '/auth/login', null, { tenantId: cfg.tenantId, username: 'dev.admin', password: 'Dev@12345' });
  const token = login.accessToken;
  const supplier = await call('POST', '/suppliers', token, { name: NAME });
  await call('POST', `/supplier-debt/${supplier.id}/opening-balance`, token, { amount: 5_000_000, occurredAt: '2026-01-15', note: 'Nợ đầu kỳ kiểm sổ' });
  const accounts = await call('GET', '/cash-accounts', token);
  const cashAccountId = (accounts.items || accounts)[0].id;
  await call('POST', `/supplier-debt/${supplier.id}/payment`, token, { amount: 2_000_000, paymentMethodCode: 'CASH', cashAccountId, occurredAt: '2026-03-10' });
  await call('POST', `/supplier-debt/${supplier.id}/payment`, token, { amount: 500_000, paymentMethodCode: 'CASH', cashAccountId, occurredAt: '2026-04-20' });
  return supplier.id;
}

async function login(page) {
  await page.goto(WEB + '/login');
  await page.fill('#username', 'dev.admin');
  await page.fill('#password', 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

/** Dòng của bảng Sổ công nợ (chỉ bảng đang HIỂN THỊ có cột "Số dư sau"; bản in ẩn cũng có bảng cùng cột). */
const ledgerRows = (page) => page.locator('table:visible').filter({ hasText: 'Số dư sau' }).locator('tbody tr');
/** Nội dung trang, chữ thường — giao diện hiển thị chữ hoa qua CSS nên so không phân biệt hoa/thường. */
const pageText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ').toLowerCase();

(async () => {
  const supplierId = await seedData();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await login(page);
    check('ngữ cảnh KHÔNG bảo mật (mô hình on-prem LAN HTTP)', (await page.evaluate(() => window.isSecureContext)) === false, WEB);
    await page.goto(`${WEB}/suppliers/${supplierId}`);
    await page.getByRole('tab', { name: 'Sổ công nợ' }).click().catch(async () => page.getByText('Sổ công nợ', { exact: true }).first().click());
    await page.getByText('Số dư đầu kỳ', { exact: true }).waitFor({ timeout: 20000 });
    const body0 = await pageText(page);
    check('chưa lọc: dải tổng hợp đủ 4 ô và đủ 3 bút toán', ['số dư đầu kỳ', 'tăng nợ', 'giảm nợ', 'số dư cuối kỳ'].every((s) => body0.includes(s)) && (await ledgerRows(page).count()) === 3, `${await ledgerRows(page).count()} dòng`);
    check('chưa lọc: có "Từ ngày", "Đến ngày", Xuất Excel, In; chưa có "Xoá lọc"', (await page.getByLabel('Từ ngày').count()) === 1 && (await page.getByLabel('Đến ngày').count()) === 1 && (await page.getByRole('button', { name: /Xuất Excel/ }).count()) === 1 && (await page.getByRole('button', { name: /^In/ }).count()) >= 1 && (await page.getByRole('button', { name: 'Xoá lọc' }).count()) === 0);

    // Lọc tháng 3/2026
    await page.getByLabel('Từ ngày').fill('01/03/2026');
    await page.getByLabel('Đến ngày').fill('31/03/2026');
    await page.waitForTimeout(1200);
    const march = await pageText(page);
    check('lọc 01–31/03/2026: chỉ còn dòng thanh toán 2.000.000', (await ledgerRows(page).count()) === 1 && /thanh toán/.test(march));
    check('lọc tháng 3: đầu kỳ 5.000.000, giảm nợ 2.000.000, cuối kỳ 3.000.000', /số dư đầu kỳ\s*5\.000\.000/.test(march) && /giảm nợ\s*2\.000\.000/.test(march) && /số dư cuối kỳ\s*3\.000\.000/.test(march), (march.match(/số dư đầu kỳ[^t]*/) || [''])[0].slice(0, 60));
    check('có nút "Xoá lọc" khi đang lọc', (await page.getByRole('button', { name: 'Xoá lọc' }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, 'ledger-march.png'), fullPage: true });

    // Excel thật
    {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, 'so-cong-no.xlsx');
      await dl.saveAs(f);
      check('Xuất Excel tải được tệp thật theo kỳ đang lọc', fs.statSync(f).size > 2000 && /so-cong-no/.test(dl.suggestedFilename()), dl.suggestedFilename());
    }
    // In
    await page.evaluate(() => {
      window.__printCalls = 0;
    });
    await page.getByRole('button', { name: /^In/ }).first().click();
    await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
    const printText = (await page.evaluate(() => document.body.textContent || '')).toLowerCase();
    check('In: mở hộp in và bản in có tiêu đề, nhà cung cấp, kỳ', printText.includes('sổ công nợ nhà cung cấp') && printText.includes(NAME.toLowerCase()) && printText.includes('01/03/2026'));

    // Kỳ ngược
    await page.getByLabel('Từ ngày').fill('01/05/2026');
    await page.getByLabel('Đến ngày').fill('01/04/2026');
    await page.waitForTimeout(800);
    const bad = await pageText(page);
    check('kỳ ngược: báo "phải trước hoặc bằng", không có bảng, Excel/In bị khoá', /phải trước hoặc bằng/.test(bad) && (await ledgerRows(page).count()) === 0 && (await page.getByRole('button', { name: /Xuất Excel/ }).isDisabled()));

    // Kỳ không có bút toán
    await page.getByLabel('Từ ngày').fill('01/02/2026');
    await page.getByLabel('Đến ngày').fill('28/02/2026');
    await page.waitForTimeout(1200);
    const quiet = await pageText(page);
    check('kỳ không có bút toán: trạng thái rỗng "Không có bút toán trong kỳ", đầu kỳ = cuối kỳ = 5.000.000', /không có bút toán trong kỳ/.test(quiet) && /số dư đầu kỳ\s*5\.000\.000/.test(quiet) && /số dư cuối kỳ\s*5\.000\.000/.test(quiet));

    // Xoá lọc
    await page.getByRole('button', { name: 'Xoá lọc' }).click();
    await page.waitForTimeout(1000);
    check('Xoá lọc: trở lại 3 bút toán', (await ledgerRows(page).count()) === 3);

    // Lỗi 500
    await page.route('**/supplier-debt/*/ledger*', (r) => (r.request().method() === 'GET' && !r.request().url().includes('/export') ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }) : r.continue()));
    await page.getByLabel('Từ ngày').fill('01/03/2026');
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 40000 });
    const errText = await page.locator('body').innerText();
    check('lỗi 500: khung lỗi tiếng Việt có "Thử lại", không lộ chữ kỹ thuật, vẫn thấy ô lọc', !FORBIDDEN.test(noDigits(errText)) && (await page.getByLabel('Từ ngày').inputValue()) === '01/03/2026');
    await page.unroute('**/supplier-debt/*/ledger*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await ledgerRows(page).first().waitFor({ timeout: 20000 });
    check('bấm "Thử lại" tải lại được', true);

    for (const [w, h] of [[1280, 720], [1536, 730], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${w}×${h}: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
    }
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err && err.message ? err.message : err).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => undefined);
  }

  check('không có lỗi JS trên trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} đạt`);
  await browser.close();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  console.error('LỖI kịch bản:', e.message);
  process.exit(1);
});
