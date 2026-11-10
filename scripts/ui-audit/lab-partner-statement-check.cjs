/* global require, process, console, window, document, fetch */
// KIỂM tab "Mẫu đã gửi" (bảng kê mẫu gửi đối tác) ở trang chi tiết đối tác (docs/DECISIONS.md #291 GĐ4) trên Chrome thật.
// Cần một đối tác xét nghiệm đã có dòng gửi (đã nhận/chờ/không nhận): UI_AUDIT_PARTNER=<id nhà cung cấp>. Dùng tài khoản dev của công ty thử cố định.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5173 UI_AUDIT_API=http://<IP>:3001 UI_AUDIT_PARTNER=<id> UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-statement-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const API = process.env.UI_AUDIT_API || 'http://localhost:3001';
const PARTNER = process.env.UI_AUDIT_PARTNER || '';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-statement-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack/;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function nonPartnerSupplierId() {
  const tenant = (await (await fetch(WEB + '/config.json')).json()).tenantId;
  const lg = await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, username: USER, password: PASS }) })).json();
  const sup = await (await fetch(API + '/api/v1/suppliers', { headers: { authorization: `Bearer ${lg.data.accessToken}` } })).json();
  const s = (sup.data.items || []).find((x) => !x.isLabPartner);
  return s ? s.id : '';
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.print = () => {};
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    check('có mã đối tác để kiểm', PARTNER !== '');
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Trang đối tác: chip, dải số, tab ──
    await page.goto(`${WEB}/suppliers/${PARTNER}`);
    const samplesTab = page.getByRole('tab', { name: 'Mẫu đã gửi' }).or(page.getByRole('button', { name: 'Mẫu đã gửi' })).first();
    await samplesTab.waitFor({ timeout: 20000 });
    const bodyText = await page.locator('body').innerText();
    check('hiện chip "Đối tác XN" cạnh tên', /Đối tác XN/.test(bodyText));
    check('có tab "Mẫu đã gửi", không còn "Phiếu nhập"/"Phiếu trả hàng"', (await page.getByText('Phiếu nhập', { exact: true }).count()) === 0 && (await page.getByText('Phiếu trả hàng', { exact: true }).count()) === 0);
    check('dải số: "Tổng tiền dịch vụ đã ghi nợ" và "Đang chờ kết quả" (chưa ghi nợ)', /Tổng tiền dịch vụ đã ghi nợ/i.test(bodyText) && /Đang chờ kết quả/i.test(bodyText) && /chưa ghi nợ/.test(bodyText));
    const labelFont = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((s) => s.children.length <= 1 && s.textContent === 'Tổng tiền dịch vụ đã ghi nợ');
      const cs = el ? getComputedStyle(el) : null;
      return cs ? { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), color: cs.color, transform: cs.textTransform } : null;
    });
    check('nhãn thẻ số: 15px, đậm vừa (600), chữ tối, không in HOA', !!labelFont && labelFont.size >= 15 && labelFont.weight === 600 && labelFont.transform === 'none' && labelFont.color.includes('0.279'), JSON.stringify(labelFont));

    // ── Bảng kê ──
    const table = page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).first();
    await table.waitFor({ timeout: 20000 });
    const tableText = await table.innerText();
    check('bảng có đủ cột: Mã ống, Bệnh nhân, Dịch vụ, Gửi lúc, Nhận kết quả lúc, Thời gian trả, Giá trả, Trạng thái', ['Mã ống', 'Bệnh nhân', 'Dịch vụ', 'Gửi lúc', 'Nhận kết quả lúc', 'Thời gian trả', 'Giá trả', 'Trạng thái'].every((h) => new RegExp(h, 'i').test(tableText)));
    check('hiện đủ trạng thái: Đã có kết quả, Chờ kết quả/Quá hạn, Không nhận', /Đã có kết quả/.test(tableText) && /(Chờ kết quả|Quá hạn)/.test(tableText) && /Không nhận/.test(tableText));
    check('dòng Cộng ghi số mẫu từng loại', /Cộng đã có kết quả: \d+ mẫu · chờ kết quả: \d+ mẫu · không nhận: \d+ mẫu/.test(tableText), tableText.split('\n').filter((l) => /Cộng đã có/.test(l)).join(' ').slice(0, 120));
    check('mẫu chờ kết quả có chữ "dự kiến"', /dự kiến/.test(tableText));
    await page.screenshot({ path: path.join(OUT, '01-bang-ke.png') });

    // ── Lọc trạng thái ──
    const statusBox = page.locator('#lps-status');
    await statusBox.click();
    await page.getByRole('option', { name: 'Không nhận' }).click();
    await page.waitForTimeout(800);
    const rejectedTable = await page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).first().innerText();
    check('lọc "Không nhận": chỉ còn dòng không nhận', /Không nhận/.test(rejectedTable) && !/Đã có kết quả\n/.test(rejectedTable.replace(/Cộng đã có kết quả[^\n]*/, '')));
    await page.getByRole('button', { name: 'Xoá lọc' }).click();
    await page.waitForTimeout(800);

    // ── Đổi mốc tính kỳ ──
    await page.getByRole('button', { name: 'Ngày gửi' }).click();
    await page.waitForTimeout(800);
    check('đổi sang "Ngày gửi" vẫn tải được bảng', (await page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).count()) + (await page.getByText('Chưa gửi mẫu nào cho đối tác này').count()) >= 1);
    await page.getByRole('button', { name: 'Ngày nhận kết quả' }).click();

    // ── Khoảng ngày ngược ──
    await page.locator('#lps-from').fill('30/11/2026');
    await page.locator('#lps-to').fill('01/11/2026');
    await page.waitForTimeout(500);
    const rangeBody = await page.locator('body').innerText();
    check('khoảng ngày ngược: báo lỗi tiếng Việt, tắt Excel + In', /Ngày bắt đầu phải trước hoặc bằng ngày kết thúc/.test(rangeBody) && (await page.getByRole('button', { name: 'Xuất Excel' }).isDisabled()));
    await page.getByRole('button', { name: 'Xoá lọc' }).click();
    await page.waitForTimeout(800);

    // ── Kỳ rỗng ──
    await page.locator('#lps-from').fill('01/01/2000');
    await page.locator('#lps-to').fill('31/01/2000');
    await page.waitForTimeout(1000);
    check('kỳ không có mẫu: hiện trạng thái rỗng thân thiện', (await page.getByText('Không có mẫu nào khớp bộ lọc').count()) === 1);
    await page.getByRole('button', { name: 'Xoá lọc' }).click();
    await page.waitForTimeout(800);

    // ── Excel ──
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Xuất Excel' }).click()]);
    check('Xuất Excel tải về tệp bang-ke-mau-gui-doi-tac.xlsx', download.suggestedFilename() === 'bang-ke-mau-gui-doi-tac.xlsx', download.suggestedFilename());
    const saved = path.join(OUT, 'bang-ke.xlsx');
    await download.saveAs(saved);
    check('tệp Excel có nội dung', fs.statSync(saved).size > 2000, `${fs.statSync(saved).size} byte`);

    // ── In ──
    await page.getByRole('button', { name: 'In bảng kê' }).click();
    await page.waitForTimeout(800);
    const printText = await page.locator('body').evaluate((b) => b.textContent || '');
    check('bản in: có tiêu đề, số dư và hai ô ký', /Bảng kê mẫu xét nghiệm gửi đối tác/.test(printText) && /Số dư đầu kỳ/.test(printText) && /Đại diện phòng khám/.test(printText) && /Đại diện đối tác/.test(printText));

    // ── Lỗi tải bảng kê ──
    await page.route('**/api/v1/lab-partner-statement/**', (route) => {
      if (route.request().url().includes('/export') || route.request().url().includes('pending-summary')) return route.continue();
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) });
    });
    await page.reload();
    await page.getByText('Không tải được bảng kê mẫu đã gửi.').waitFor({ timeout: 30000 });
    const errBody = await page.locator('body').innerText();
    check('lỗi 500: thông báo tiếng Việt có "Thử lại", không lộ mã', (await page.getByRole('button', { name: 'Thử lại' }).count()) >= 1 && !FORBIDDEN.test(errBody.replace(/Mã ống/g, '')));
    await page.screenshot({ path: path.join(OUT, '02-loi-tai.png') });
    await page.unroute('**/api/v1/lab-partner-statement/**');

    // ── Mất mạng khi xuất Excel ──
    await page.reload();
    await page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).first().waitFor({ timeout: 20000 });
    await page.route('**/api/v1/lab-partner-statement/**/export**', (route) => route.abort('connectionrefused'));
    await page.getByRole('button', { name: 'Xuất Excel' }).click();
    await page.waitForTimeout(1500);
    const exportErr = await page.locator('body').innerText();
    check('Excel lỗi mạng: báo tiếng Việt, bảng còn nguyên', (/Không xuất được Excel/.test(exportErr) || /Không kết nối được/.test(exportErr) || /máy chủ/i.test(exportErr)) && (await page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, '03-excel-loi.png') });
    await page.unroute('**/api/v1/lab-partner-statement/**/export**');
    const closeBtn = page.getByRole('button', { name: 'Đóng' });
    if ((await closeBtn.count()) > 0) await closeBtn.last().click().catch(() => {});

    // ── Công tắc tắt: trang như nhà cung cấp thường ──
    await page.route('**/api/v1/clinic-settings/lab-partner-enabled', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { enabled: false } }) }));
    await page.reload();
    await page.getByRole('tab', { name: 'Sổ công nợ' }).or(page.getByRole('button', { name: 'Sổ công nợ' })).first().waitFor({ timeout: 20000 });
    const offBody = await page.locator('body').innerText();
    check('công tắc tắt: có "Phiếu nhập", không có "Mẫu đã gửi"', /Phiếu nhập/.test(offBody) && !/Mẫu đã gửi/.test(offBody));
    await page.unroute('**/api/v1/clinic-settings/lab-partner-enabled');

    // ── Nhà cung cấp thường không đổi ──
    const plain = await nonPartnerSupplierId();
    if (plain) {
      await page.goto(`${WEB}/suppliers/${plain}`);
      await page.getByRole('tab', { name: 'Sổ công nợ' }).or(page.getByRole('button', { name: 'Sổ công nợ' })).first().waitFor({ timeout: 20000 });
      const plainBody = await page.locator('body').innerText();
      check('nhà cung cấp thường: giữ tab "Phiếu nhập", không chip "Đối tác XN", không "Mẫu đã gửi"', /Phiếu nhập/.test(plainBody) && !/Mẫu đã gửi/.test(plainBody) && !/Đối tác XN/.test(plainBody));
    } else {
      check('có nhà cung cấp thường để so sánh', false);
    }

    // ── Phụ lục trong hộp "Lập biên bản đối chiếu" ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${WEB}/suppliers/${PARTNER}`);
    await page.getByRole('button', { name: 'Lập biên bản đối chiếu' }).click();
    const appendix = page.getByRole('region', { name: 'Phụ lục bảng kê mẫu gửi đối tác' });
    await appendix.waitFor({ timeout: 20000 });
    const appText = await appendix.innerText();
    check('hộp đối chiếu: phụ lục ghi số mẫu đã có kết quả, chờ, không nhận', /\d+ mẫu đã có kết quả = /.test(appText) && /chưa tính vào nợ/.test(appText), appText.replace(/\s+/g, ' ').slice(0, 170));
    await appendix.getByRole('button', { name: 'Xem' }).click();
    const appTable = appendix.locator('table:visible');
    await appTable.waitFor({ timeout: 10000 });
    check('bấm "Xem": bảng kê hiện ngay trong hộp, có dòng Cộng', /Cộng đã có kết quả/.test(await appTable.innerText()));
    await page.screenshot({ path: path.join(OUT, '05-doi-chieu-phu-luc.png') });
    await appendix.getByRole('button', { name: 'Ẩn' }).click();
    check('bấm "Ẩn": bảng thu lại', (await appendix.locator('table:visible').count()) === 0);
    check('có nút "In" cho phụ lục', (await appendix.getByRole('button', { name: 'In', exact: true }).count()) === 1);
    await page.route('**/api/v1/lab-partner-statement/**', (route) => (route.request().url().includes('pending-summary') ? route.continue() : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) })));
    await page.locator('#recon-date').fill('09/11/2026');
    await page.getByText('Không tải được bảng kê mẫu gửi.').waitFor({ timeout: 30000 });
    const appErr = await page.getByRole('dialog').or(page.locator('form')).first().innerText();
    check('phụ lục lỗi 500: báo tại chỗ có "Thử lại", không lộ mã, vẫn lập được biên bản', /Thử lại/.test(appErr) && !FORBIDDEN.test(appErr.replace(/Mã ống/g, '')) && (await page.getByRole('button', { name: 'Huỷ' }).isEnabled()));
    await page.unroute('**/api/v1/lab-partner-statement/**');
    await page.getByRole('button', { name: 'Huỷ' }).click();

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${WEB}/suppliers/${PARTNER}`);
      await page.locator('table:visible').filter({ hasText: 'Nhận kết quả lúc' }).first().waitFor({ timeout: 20000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${w}×${h}: trang không cuộn ngang`, overflow <= 1, `lệch ${overflow}px`);
      await page.screenshot({ path: path.join(OUT, `04-${w}x${h}.png`) });
    }

    check('không có lỗi JS trong trang', jsErrors.length === 0, jsErrors.join(' | ').slice(0, 200));
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err.message || err).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => {});
  } finally {
    await browser.close();
  }

  const pass = results.filter(Boolean).length;
  console.log(`\nKẾT QUẢ: ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})();
