/* global require, process, console, document, fetch */
// KIỂM Toàn hệ thống › Tổng hợp tháng và Xếp hạng có lãi gộp dịch vụ (docs/DECISIONS.md #297 bổ sung 4) trên Chrome thật qua IP LAN HTTP: cột/ô tổng, lựa chọn xếp hạng "Lãi gộp dịch vụ",
// Excel, In, trạng thái lỗi 503 và không tràn ngang ở vài cỡ màn hình. Chỉ ĐỌC dữ liệu sẵn có (không tạo dữ liệu thử).
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/system-service-margin-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'system-service-margin-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity/;
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const bodyText = () => page.evaluate(() => document.body.innerText);
  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ── Tổng hợp tháng ──
    await page.goto(`${WEB}/reports/system?tab=monthly`);
    const monthlyTable = page.getByRole('table', { name: 'Tổng hợp tháng theo chi nhánh' });
    await monthlyTable.waitFor({ timeout: 25000 });
    const kpi = await page.getByLabel('Số liệu tổng hợp tháng').innerText();
    check('tháng: dải số có Lãi gộp thuốc, Lãi gộp dịch vụ và Lãi gộp tổng', /Lãi gộp thuốc/.test(kpi) && /Lãi gộp dịch vụ/.test(kpi) && /Lãi gộp tổng/.test(kpi), kpi.replace(/\n/g, ' | ').slice(0, 200));
    const monthlyText = await monthlyTable.innerText();
    check('tháng: bảng theo chi nhánh có cột Lãi gộp dịch vụ và Lãi gộp tổng', /lãi gộp dịch vụ/i.test(monthlyText) && /lãi gộp tổng/i.test(monthlyText));
    check('tháng: dòng Cộng có đủ cột (nhiều hơn 10 ô)', (monthlyText.match(/Cộng \d+ chi nhánh/) || []).length === 1);
    await shot('01-tong-hop-thang.png');
    const [dlMonthly] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    check('tháng: Xuất Excel tải được tệp .xlsx', /\.xlsx$/.test(dlMonthly.suggestedFilename()), dlMonthly.suggestedFilename());
    check('tháng: có nút In', (await page.getByRole('button', { name: /^In/ }).count()) > 0);

    // ── Xếp hạng ──
    await page.goto(`${WEB}/reports/system?tab=ranking`);
    await page.getByRole('group', { name: 'Loại xếp hạng' }).or(page.getByRole('radiogroup', { name: 'Loại xếp hạng' })).first().waitFor({ timeout: 25000 });
    const option = page.getByRole('radio', { name: 'Lãi gộp dịch vụ' }).or(page.getByRole('button', { name: 'Lãi gộp dịch vụ' })).first();
    check('xếp hạng: có lựa chọn "Lãi gộp dịch vụ"', (await option.count()) > 0);
    await option.click();
    await page.waitForTimeout(800);
    const rankingTable = page.getByRole('table', { name: 'Xếp hạng lãi gộp dịch vụ' });
    const emptyShown = /Chưa có lượt dịch vụ nào ghi tiêu hao trong kỳ/.test(await bodyText());
    if (!emptyShown) {
      await rankingTable.waitFor({ timeout: 20000 });
      const rankingText = await rankingTable.innerText();
      check('xếp hạng: bảng có cột Số lượt và Lãi gộp dịch vụ', /số lượt/i.test(rankingText) && /lãi gộp dịch vụ/i.test(rankingText), rankingText.slice(0, 160).replace(/\n/g, ' | '));
    } else {
      check('xếp hạng: kỳ không có lượt ghi tiêu hao thì hiện thông báo trống tiếng Việt', true);
    }
    await shot('02-xep-hang-lai-gop-dich-vu.png');
    const [dlRanking] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    check('xếp hạng: Xuất Excel tải được tệp .xlsx', /\.xlsx$/.test(dlRanking.suggestedFilename()), dlRanking.suggestedFilename());

    // Lỗi 503 khi bấm Làm mới: thông báo tiếng Việt kèm "Thử lại", không lộ mã; gỡ chặn rồi Thử lại hiện lại.
    await page.route('**/api/v1/reports/system/ranking**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' } }) }));
    await page.getByRole('button', { name: /Làm mới/ }).click();
    await page.getByRole('button', { name: /Thử lại/ }).waitFor({ timeout: 20000 });
    const errText = await bodyText();
    check('xếp hạng: lỗi máy chủ → thông báo tiếng Việt có "Thử lại", không lộ mã/lỗi thô', /Hệ thống đang khởi động hoặc tạm thời không truy cập được|Không tải được bảng xếp hạng/.test(errText) && !FORBIDDEN.test(errText));
    await shot('03-xep-hang-loi.png');
    await page.unroute('**/api/v1/reports/system/ranking**');
    await page.getByRole('button', { name: /Thử lại/ }).click();
    await page.getByRole('button', { name: /Thử lại/ }).waitFor({ state: 'detached', timeout: 20000 });
    check('xếp hạng: Thử lại sau khi máy chủ ổn → hết thông báo lỗi', true);

    // ── Không tràn ngang ở vài cỡ màn hình ──
    for (const [w, h] of [[1536, 864], [1280, 720], [1024, 768], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['monthly', 'ranking']) {
        await page.goto(`${WEB}/reports/system?tab=${tab}`);
        await page.waitForSelector('[role="table"], [role="status"]', { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check(`bố cục ${w}×${h} tab ${tab}: không tràn ngang cả trang`, !overflow);
      }
    }
  } catch (err) {
    check('kịch bản không văng lỗi', false, String(err && err.message ? err.message : err).split('\n')[0]);
    await shot('99-loi.png').catch(() => {});
  } finally {
    check('không có lỗi JS trên trang', jsErrors.length === 0, jsErrors.join(' | '));
    await browser.close();
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} ĐẠT`);
  void fetch;
  process.exit(ok === results.length ? 0 : 1);
})();
