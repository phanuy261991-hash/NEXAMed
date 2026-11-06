/* global require, process, console, window, document */
// KIỂM "Gửi mẫu đối tác" giai đoạn 1 (docs/DECISIONS.md #291) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: công tắc tắt (không pill/không khối "Nơi thực hiện"), bật công tắc, thêm đối tác (mã DT), chip "Đối tác XN" ở Quản lý nhà cung cấp, form dịch vụ (Gửi đối tác + giá trả theo đối tác, lưu và mở lại),
// kiểm tra form (thiếu giá), lỗi máy chủ 409 giữ nguyên dữ liệu đang nhập, tắt công tắc lại, vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-config-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-config-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|LAB_PARTNER|ECONN|\b50[0-4]\b|\b404\b|stack/;
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');
const RUN = String(Date.now()).slice(-6);
const PARTNER_NAME = `Phòng xét nghiệm Kiểm ${RUN}`;
const PARTNER2_NAME = `Phòng xét nghiệm Kiểm B ${RUN}`;
const SERVICE_NAME = `XN gửi đối tác kiểm ${RUN}`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function login(page, user, pass) {
  await page.goto(WEB + '/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function setToggle(page, want) {
  await page.goto(WEB + '/admin/system-config');
  await page.waitForLoadState('networkidle');
  // Công tắc là ô tích ẩn (`sr-only`) nằm trong nhãn; chọn mục "Cấu hình chung" ở danh sách trái trước.
  await page.getByRole('button', { name: 'Cấu hình chung' }).first().click();
  const sw = page.getByRole('checkbox', { name: 'Dùng đối tác xét nghiệm' });
  await sw.waitFor({ state: 'attached', timeout: 20000 });
  const on = await sw.isChecked();
  if (on !== want) {
    await Promise.all([page.waitForResponse((r) => r.url().includes('/clinic-settings') && r.request().method() === 'PATCH', { timeout: 15000 }), sw.evaluate((el) => el.click())]);
    await page.waitForTimeout(600);
  }
  return await sw.isChecked();
}

async function openCatalog(page) {
  await page.goto(WEB + '/admin/catalog-paraclinical');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Dịch vụ kỹ thuật' }).first().waitFor({ timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await login(page, process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    check('ngữ cảnh KHÔNG bảo mật (mô hình on-prem LAN HTTP)', (await page.evaluate(() => window.isSecureContext)) === false, WEB);

    // ── Công tắc TẮT ──
    check('đưa công tắc về TẮT', (await setToggle(page, false)) === false);
    await openCatalog(page);
    check('công tắc tắt: danh mục Cận lâm sàng KHÔNG có mục "Đối tác xét nghiệm"', (await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).count()) === 0);
    await page.getByRole('button', { name: /Thêm dịch vụ/ }).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    check('công tắc tắt: form dịch vụ KHÔNG có khối "Nơi thực hiện"', (await page.getByRole('group', { name: 'Nơi thực hiện' }).count()) === 0);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.getByRole('button', { name: 'Đóng' }).first().click().catch(() => undefined);

    // ── Bật công tắc ──
    check('bật công tắc "Dùng đối tác xét nghiệm"', (await setToggle(page, true)) === true);
    await openCatalog(page);
    const partnerPill = page.getByRole('button', { name: 'Đối tác xét nghiệm' });
    check('công tắc bật: có mục "Đối tác xét nghiệm"', (await partnerPill.count()) === 1);

    // ── Thêm đối tác ──
    await partnerPill.click();
    await page.getByRole('button', { name: /Thêm đối tác/ }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Thêm đối tác/ }).click();
    await page.getByLabel('Tên đối tác').fill(PARTNER_NAME);
    await page.getByLabel('Người liên hệ').fill('Chị Thu Hà');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText(PARTNER_NAME, { exact: true }).waitFor({ timeout: 15000 });
    const partnerRow = page.locator('tr', { hasText: PARTNER_NAME });
    const rowText = (await partnerRow.innerText()).replace(/\s+/g, ' ');
    check('đối tác mới có mã DT và hiện trong danh mục', /\bDT\d+/.test(rowText), rowText.slice(0, 120));
    check('cột "Dịch vụ" của đối tác mới = 0', /\b0\b/.test(rowText));
    check('danh mục đối tác không có cột Mã số thuế / Tổng mua', (await page.getByRole('columnheader', { name: 'Mã số thuế' }).count()) === 0 && (await page.getByRole('columnheader', { name: 'Tổng mua' }).count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'partner-list.png') });
    await page.getByRole('button', { name: /Thêm đối tác/ }).click();
    await page.getByLabel('Tên đối tác').fill(PARTNER2_NAME);
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.locator('tr', { hasText: PARTNER2_NAME }).first().waitFor({ timeout: 15000 });
    check('thêm được đối tác thứ hai', (await page.locator('tr', { hasText: PARTNER2_NAME }).count()) === 1);

    // ── Quản lý nhà cung cấp: chip ──
    await page.goto(WEB + '/suppliers');
    await page.waitForLoadState('networkidle');
    // Tên và chip "Đối tác XN" cùng một ô nên không khớp chính xác theo chữ.
    await page.locator('tr', { hasText: PARTNER_NAME }).first().waitFor({ timeout: 20000 });
    const supplierRow = page.locator('tr', { hasText: PARTNER_NAME });
    check('Quản lý nhà cung cấp: đối tác có chip "Đối tác XN"', (await supplierRow.getByText('Đối tác XN').count()) === 1);

    // ── Form dịch vụ: Gửi đối tác + giá trả ──
    await openCatalog(page);
    await page.getByRole('button', { name: /Thêm dịch vụ/ }).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    await page.fill('#ts-name', SERVICE_NAME);
    const placeGroup = page.getByRole('group', { name: 'Nơi thực hiện' });
    check('công tắc bật + xét nghiệm tự làm: form có khối "Nơi thực hiện"', (await placeGroup.count()) === 1);
    check('mặc định chọn "Tại phòng khám", chưa có bảng giá trả', (await page.getByText('Giá trả bên thứ ba theo từng đối tác').count()) === 0);
    await placeGroup.getByText('Gửi đối tác', { exact: true }).click();
    await page.getByText('Giá trả bên thứ ba theo từng đối tác').waitFor({ timeout: 10000 });
    check('chọn "Gửi đối tác": hiện bảng giá trả', true);

    check('chọn "Gửi đối tác" mà ô thời gian trả còn trống: mặc định nhập theo giờ', (await page.getByPlaceholder('Ví dụ: 24').count()) === 1);
    await page.fill('#ts-tat', '24');

    // Đơn giá bán và đơn vị tính trước: form kiểm đơn giá trước thông báo về đối tác.
    await page.locator('#ts-unit').click().catch(() => undefined);
    await page.getByRole('option').first().click().catch(() => undefined);
    await page.fill('#ts-amount', '220000');

    // Lưu khi chưa có đối tác → báo lỗi tiếng Việt, giữ nguyên dữ liệu
    await page.getByRole('button', { name: 'Lưu dịch vụ', exact: true }).click();
    await page.waitForTimeout(500);
    const dlgText = await page.getByRole('dialog').innerText();
    check('chưa chọn đối tác: báo "Chọn ít nhất một đối tác", không lộ chữ kỹ thuật', /Chọn ít nhất một đối tác/.test(dlgText) && !FORBIDDEN.test(noDigits(dlgText)));
    check('thông báo lỗi giữ nguyên tên dịch vụ đang nhập', (await page.inputValue('#ts-name')) === SERVICE_NAME);

    // Thêm đối tác qua ô chọn
    await page.locator('#ts-partner-add').click();
    await page.getByRole('option', { name: new RegExp(PARTNER_NAME) }).first().click();
    const partnerRowInForm = page.getByText(PARTNER_NAME, { exact: true }).last();
    await partnerRowInForm.waitFor({ timeout: 10000 });
    check('thêm đối tác vào bảng: dòng đầu tự là "Mặc định"', (await page.getByRole('dialog').getByText('Mặc định', { exact: true }).count()) >= 1);

    // Lưu khi chưa nhập giá trả
    await page.getByRole('button', { name: 'Lưu dịch vụ', exact: true }).click();
    await page.waitForTimeout(500);
    check('chưa nhập giá trả: báo "Nhập giá trả cho mọi đối tác"', /Nhập giá trả cho mọi đối tác/.test(await page.getByRole('dialog').innerText()));

    // Nhập giá trả + đơn giá bán
    const priceInputs = page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)');
    await priceInputs.first().fill('150000');
    await page.locator('#ts-partner-add').click();
    await page.getByRole('option', { name: new RegExp(PARTNER2_NAME) }).first().click();
    await page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)').nth(1).waitFor({ timeout: 10000 });
    await priceInputs.nth(1).fill('135000');
    check('hai đối tác trong bảng giá trả', (await priceInputs.count()) === 2);
    await page.getByRole('button', { name: 'Đặt mặc định' }).click();
    await page.waitForTimeout(200);
    const rows2 = page.getByRole('dialog').locator('[role="row"]').filter({ has: page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)') });
    check('đặt đối tác thứ hai làm mặc định: nhãn "Mặc định" chuyển sang dòng 2', /Mặc định/.test(await rows2.nth(1).innerText()) && !/Mặc định/.test((await rows2.nth(0).innerText()).replace(/Đặt mặc định/g, '')));
    await page.waitForTimeout(300);
    const marginText = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ');
    check('hiện cột "Giá niêm yết" (không còn "Giá bán cho khách") và lãi từng đối tác: 70.000 và 85.000', /Giá niêm yết/.test(marginText) && !/Giá bán cho khách/.test(marginText) && /Lãi 70\.000/.test(marginText) && /Lãi 85\.000/.test(marginText), (marginText.match(/Lãi [\d.]+/g) || []).join(' | '));
    check('có câu nhắc giá trả đối tác không hiện cho khách', /Giá trả đối tác chỉ hiện ở công nợ và đối chiếu/.test(marginText));
    await page.screenshot({ path: path.join(OUT, 'service-form-partner.png') });

    // Lỗi máy chủ 409: giữ nguyên dữ liệu
    await page.route('**/api/v1/technical-services', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LAB_PARTNER_DISABLED', message: 'Phòng khám đã tắt tính năng "Dùng đối tác xét nghiệm" ở Cấu hình chung.' } }) });
      }
      return route.continue();
    });
    await page.getByRole('button', { name: 'Lưu dịch vụ', exact: true }).click();
    await page.waitForTimeout(800);
    const errText = await page.locator('body').innerText();
    check('máy chủ 409: hiện thông báo tiếng Việt, không lộ mã lỗi', /đã tắt tính năng/.test(errText) && !/LAB_PARTNER_DISABLED/.test(errText));
    check('máy chủ 409: form vẫn mở và giữ nguyên dữ liệu', (await page.inputValue('#ts-name')) === SERVICE_NAME && (await page.getByRole('dialog').count()) >= 1);
    await page.unroute('**/api/v1/technical-services');

    // Lưu thật
    await page.getByRole('button', { name: 'Lưu dịch vụ', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
    check('lưu dịch vụ gửi đối tác thành công', true);

    // Mở lại: giá trả được giữ
    await openCatalog(page);
    await page.getByPlaceholder(/Tìm/).first().fill(SERVICE_NAME).catch(() => undefined);
    await page.waitForTimeout(800);
    const svcRow = page.locator('[role="row"], tr').filter({ hasText: SERVICE_NAME }).first();
    await svcRow.waitFor({ timeout: 15000 });
    await svcRow.getByRole('button', { name: /Xem|Sửa/ }).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    await page.getByText('Giá trả bên thứ ba theo từng đối tác').waitFor({ timeout: 15000 });
    const reopened = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ');
    check('mở lại: giữ đối tác và đang chọn "Gửi đối tác"', reopened.includes(PARTNER_NAME));
    const saved = page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)');
    const savedPrices = [await saved.nth(0).inputValue(), await saved.nth(1).inputValue()].sort();
    check('mở lại: giữ cả hai giá trả (135.000 và 150.000)', JSON.stringify(savedPrices) === JSON.stringify(['135.000', '150.000']), savedPrices.join(' | '));
    const savedRows = page.getByRole('dialog').locator('[role="row"]').filter({ has: page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)') });
    check('mở lại: đối tác mặc định vẫn là đối tác thứ hai', /Mặc định/.test((await savedRows.filter({ hasText: PARTNER2_NAME }).innerText()).replace(/Đặt mặc định/g, '')));
    check('mở lại: thời gian trả 24 giờ hiện đúng (không phải 1440 phút)', (await page.inputValue('#ts-tat')) === '24');
    await page.getByRole('button', { name: 'Đóng' }).first().click().catch(() => undefined);

    // Cột Dịch vụ của đối tác = 1
    await openCatalog(page);
    await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).click();
    await page.getByText(PARTNER_NAME, { exact: true }).waitFor({ timeout: 15000 });
    const rowAfter = (await page.locator('tr', { hasText: PARTNER_NAME }).innerText()).replace(/\s+/g, ' ');
    check('cột "Dịch vụ" của đối tác = 1 sau khi gán', /\b1\b/.test(rowAfter), rowAfter.slice(0, 120));
    const rowAfter2 = (await page.locator('tr', { hasText: PARTNER2_NAME }).innerText()).replace(/\s+/g, ' ');
    check('cột "Dịch vụ" của đối tác thứ hai cũng = 1', /\b1\b/.test(rowAfter2), rowAfter2.slice(0, 120));

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [1536, 730], [1920, 969], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${w}×${h} · danh mục đối tác: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ── Tắt công tắc lại: ẩn nhưng dữ liệu giữ ──
    check('tắt công tắc lại', (await setToggle(page, false)) === false);
    await openCatalog(page);
    check('công tắc tắt lại: mục "Đối tác xét nghiệm" biến mất', (await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).count()) === 0);
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err && err.message ? err.message : err).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => undefined);
  }

  // Luôn trả công tắc về TẮT dù kịch bản dừng giữa chừng (môi trường dev dùng chung).
  try {
    await setToggle(page, false);
  } catch {
    console.log('CẢNH BÁO không đưa được công tắc về TẮT, kiểm thủ công');
  }

  // ── Phân quyền: bác sĩ thấy form dịch vụ nhưng không sửa được; không thấy pill đối tác (thiếu quyền kho thuốc) ──
  try {
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await login(p, 'rl.doctor', '12345678');
    await p.goto(WEB + '/admin/catalog-paraclinical');
    await p.waitForLoadState('networkidle');
    const body = await p.locator('body').innerText();
    check('bác sĩ: không thấy mục "Đối tác xét nghiệm" (công tắc đã tắt)', !/Đối tác xét nghiệm/.test(body) && !FORBIDDEN.test(noDigits(body)));
    await p.context().close();
  } catch (e) {
    check('kiểm quyền bác sĩ', false, String(e.message).slice(0, 200));
  }

  check('không có lỗi JS trên trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} đạt`);
  await browser.close();
  process.exit(ok === results.length ? 0 : 1);
})();
