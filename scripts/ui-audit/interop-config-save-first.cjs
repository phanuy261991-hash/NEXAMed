/* global require, process, console, __dirname */
// Kiểm trang "Liên thông đơn thuốc" (Cấu hình hệ thống) trên Chrome thật (docs/DECISIONS.md #278): mới gạt "Có liên thông" mà CHƯA Lưu thì hai khối "Cơ sở khám chữa bệnh" và "Bác sĩ"
// phải hiện câu "Bấm Lưu trước." (không để trống); Lưu xong thì bảng nhập mã/mật khẩu hiện ra và câu hướng dẫn biến mất; "Nhập mã/mật khẩu" mở hộp có ô nhập.
// Lỗi gốc: bảng chỉ tải khi cấu hình ĐÃ LƯU là bật, nên người dùng gạt công tắc xong thấy khối trống và "không có chỗ nhập".
// Chuẩn bị giống layout-audit.cjs (README.md cùng thư mục): API + web chạy, tenant dev, `playwright-core` + PLAYWRIGHT_CORE. Script TRẢ cấu hình về "Không liên thông" khi xong.
// Biến môi trường: PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_WEB, UI_AUDIT_USER, UI_AUDIT_PASS. Chạy: node scripts/ui-audit/interop-config-save-first.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
  await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.goto(WEB + '/admin/system-config');
  await page.getByText('Liên thông đơn thuốc', { exact: true }).first().click();
  await page.getByText('Lưu cấu hình không làm đơn').waitFor({ timeout: 20000 });

  const save = page.getByRole('button', { name: 'Lưu', exact: true });
  async function saveIfDirty() {
    if (await save.isEnabled()) {
      await save.click();
      await page.getByText('Đã lưu.').waitFor({ timeout: 15000 });
    }
  }

  // Đưa về "Không liên thông" ĐÃ LƯU — rồi TẢI LẠI trang để bộ nhớ đệm không còn bảng cũ (nếu không, bảng đã tải trước đó vẫn hiện và che mất lỗi).
  await page.getByRole('button', { name: 'Không liên thông' }).click();
  await saveIfDirty();
  await page.reload();
  await page.getByText('Liên thông đơn thuốc', { exact: true }).first().click();
  await page.getByText('Lưu cấu hình không làm đơn').waitFor({ timeout: 20000 });

  await page.getByRole('button', { name: 'Có liên thông' }).click();
  await page.waitForTimeout(1500);
  const notices = await page.getByText('Bấm Lưu trước.').count();
  const tables = await page.locator('th', { hasText: 'Mã liên thông cơ sở' }).count();
  check('Chưa Lưu: cả hai khối Cơ sở và Bác sĩ có câu "Bấm Lưu trước."', notices === 2, `số câu = ${notices}`);
  check('Chưa Lưu: chưa có bảng nhập (đúng — chưa tải)', tables === 0);
  check('Chưa Lưu: câu dưới công tắc nêu rõ chưa lưu', (await page.getByText(/CHƯA LƯU/).count()) >= 1);

  await save.click();
  await page.getByText('Đã lưu.').waitFor({ timeout: 15000 });
  await page.locator('th', { hasText: 'Mã liên thông cơ sở' }).first().waitFor({ timeout: 15000 });
  const inputButtons = await page.getByRole('button', { name: /Nhập mã\/mật khẩu|Sửa mã\/mật khẩu/ }).count();
  check('Đã Lưu: hiện bảng cơ sở + nút "Nhập/Sửa mã/mật khẩu", câu "Bấm Lưu trước." biến mất', inputButtons > 0 && (await page.getByText('Bấm Lưu trước.').count()) === 0, `số nút = ${inputButtons}`);

  await page.getByRole('button', { name: /Nhập mã\/mật khẩu|Sửa mã\/mật khẩu/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10000 });
  check('"Nhập mã/mật khẩu" mở hộp có ô nhập mã và mật khẩu', (await dialog.locator('input').count()) >= 2);
  await dialog.getByRole('button', { name: /Huỷ|Đóng/ }).first().click();
  await dialog.waitFor({ state: 'detached', timeout: 10000 });

  // Trả về cấu hình ban đầu (tắt).
  await page.getByRole('button', { name: 'Không liên thông' }).click();
  await saveIfDirty();
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} đạt`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
