/* global require, process, console, window, document, fetch */
// KIỂM "Giá trả (Excel)" ở Danh mục Cận lâm sàng › Đối tác xét nghiệm (docs/DECISIONS.md #291 GĐ4) trên Chrome thật.
// Cần công ty thử có công tắc "Dùng đối tác xét nghiệm" bật và ít nhất một dịch vụ gửi đối tác có giá trả (dữ liệu KIEM-GM). Ghi giá thật rồi KHÔI PHỤC về giá cũ.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5173 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-price-import-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const ExcelJS = createRequire(path.join(__dirname, '../../apps/api/package.json'))('exceljs');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-price-import-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack/;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function loadSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return { wb, sheet: wb.getWorksheet('Giá trả đối tác') };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  const openMenu = async () => {
    await page.getByRole('button', { name: /Giá trả \(Excel\)/ }).click();
  };
  const download = async (itemName) => {
    await openMenu();
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('menuitem', { name: itemName }).click()]);
    return d;
  };

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await page.goto(WEB + '/admin/catalog-paraclinical');
    await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).or(page.getByRole('tab', { name: 'Đối tác xét nghiệm' })).first().click();
    const menuBtn = page.getByRole('button', { name: /Giá trả \(Excel\)/ });
    await menuBtn.waitFor({ timeout: 20000 });
    check('có nút "Giá trả (Excel)" cạnh "Thêm đối tác"', (await menuBtn.count()) === 1 && (await page.getByRole('button', { name: 'Thêm đối tác' }).count()) === 1);
    await menuBtn.click();
    const items = await page.getByRole('menuitem').allInnerTexts();
    check('menu có đúng 3 mục: Tải file mẫu, Xuất giá trả hiện có, Nhập giá trả từ Excel…', ['Tải file mẫu', 'Xuất giá trả hiện có', 'Nhập giá trả từ Excel'].every((t) => items.some((i) => i.includes(t))), items.join(' | '));
    await page.screenshot({ path: path.join(OUT, '01-menu.png') });
    await page.keyboard.press('Escape');

    // ── Tải file mẫu + xuất ──
    const tpl = await download('Tải file mẫu');
    check('file mẫu tải về tên mau-gia-tra-doi-tac.xlsx', tpl.suggestedFilename() === 'mau-gia-tra-doi-tac.xlsx', tpl.suggestedFilename());
    const tplPath = path.join(OUT, 'mau.xlsx');
    await tpl.saveAs(tplPath);
    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.readFile(tplPath);
    check('file mẫu có 3 sheet: Giá trả đối tác, Hướng dẫn, Danh mục hiện có', tplWb.worksheets.map((s) => s.name).join('|') === 'Giá trả đối tác|Hướng dẫn|Danh mục hiện có');

    const exp = await download('Xuất giá trả hiện có');
    check('file xuất tải về tên gia-tra-doi-tac.xlsx', exp.suggestedFilename() === 'gia-tra-doi-tac.xlsx', exp.suggestedFilename());
    const expPath = path.join(OUT, 'xuat.xlsx');
    await exp.saveAs(expPath);
    const { wb: expWb, sheet: expSheet } = await loadSheet(expPath);
    const header = expSheet.getRow(1).values.slice(1).map(String);
    check('file xuất: ba cột đầu + cột "Giá trả [mã] tên" cho từng đối tác đang dùng', header[0] === 'Loại *' && header[1] === 'Tên dịch vụ *' && header[2] === 'Đối tác mặc định' && header.length >= 4 && header.slice(3).every((h) => /^Giá trả \[DT\d+\]/.test(h)), header.slice(0, 5).join(' | '));

    // Tìm một ô giá có số để sửa.
    let target = null;
    expSheet.eachRow((row, n) => {
      if (n === 1 || target) return;
      for (let c = 4; c <= header.length; c++) {
        const v = row.getCell(c).value;
        if (typeof v === 'number') {
          target = { row: n, col: c, value: v, name: String(row.getCell(2).value) };
          return;
        }
      }
    });
    check('có ô giá để thử đổi', target !== null);

    // ── Nhập: đổi giá một ô ──
    await openMenu();
    await page.getByRole('menuitem', { name: /Nhập giá trả từ Excel/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Nhập giá trả từ Excel' });
    await dlg.waitFor({ timeout: 10000 });
    check('hộp nhập: chưa chọn file thì nút ghi bị tắt', await dlg.getByRole('button', { name: 'Ghi giá' }).isDisabled());
    await page.screenshot({ path: path.join(OUT, '02-hop-nhap-trong.png') });

    const changedPath = path.join(OUT, 'doi-gia.xlsx');
    expSheet.getRow(target.row).getCell(target.col).value = target.value + 1000;
    await expWb.xlsx.writeFile(changedPath);
    await dlg.locator('input[type=file]').setInputFiles(changedPath);
    await dlg.getByText('Sẽ cập nhật').waitFor({ timeout: 20000 });
    const stats = await dlg.getByRole('term').allInnerTexts().catch(() => []);
    const dlgText = await dlg.innerText();
    check('xem trước: Sẽ cập nhật 1 giá, Lỗi 0, bảng có "Đổi giá"', /1 giá/.test(dlgText) && /Đổi giá/.test(dlgText) && /Lỗi\s*0/.test(dlgText.replace(/\n/g, ' ')), dlgText.replace(/\s+/g, ' ').slice(0, 160));
    check('nút ghi hiện "Ghi 1 giá"', (await dlg.getByRole('button', { name: 'Ghi 1 giá' }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, '03-xem-truoc.png') });
    await dlg.getByRole('button', { name: 'Ghi 1 giá' }).click();
    await dlg.getByRole('status').waitFor({ timeout: 20000 });
    const okText = await dlg.getByRole('status').innerText();
    check('ghi xong: báo "Đã ghi 1 giá cho 1 dịch vụ"', /Đã ghi 1 giá cho 1 dịch vụ/.test(okText), okText.slice(0, 120));
    await page.screenshot({ path: path.join(OUT, '04-ghi-xong.png') });
    await dlg.getByRole('button', { name: 'Đóng' }).last().click();

    // Xuất lại: giá đã đổi.
    const exp2 = await download('Xuất giá trả hiện có');
    const exp2Path = path.join(OUT, 'xuat2.xlsx');
    await exp2.saveAs(exp2Path);
    const { sheet: s2 } = await loadSheet(exp2Path);
    check('xuất lại: ô giá đã đổi đúng', s2.getRow(target.row).getCell(target.col).value === target.value + 1000, `${s2.getRow(target.row).getCell(target.col).value}`);

    // ── Khôi phục giá cũ bằng chính file xuất ban đầu ──
    await openMenu();
    await page.getByRole('menuitem', { name: /Nhập giá trả từ Excel/ }).click();
    const dlg2 = page.getByRole('dialog', { name: 'Nhập giá trả từ Excel' });
    await dlg2.waitFor();
    await dlg2.locator('input[type=file]').setInputFiles(expPath);
    await dlg2.getByRole('button', { name: 'Ghi 1 giá' }).waitFor({ timeout: 20000 });
    await dlg2.getByRole('button', { name: 'Ghi 1 giá' }).click();
    await dlg2.getByRole('status').waitFor({ timeout: 20000 });
    check('khôi phục giá cũ bằng file xuất ban đầu', true);
    await dlg2.getByRole('button', { name: 'Đóng' }).last().click();

    // ── Nhập file không đổi gì (xuất rồi nhập lại) ──
    await openMenu();
    await page.getByRole('menuitem', { name: /Nhập giá trả từ Excel/ }).click();
    const dlg3 = page.getByRole('dialog', { name: 'Nhập giá trả từ Excel' });
    await dlg3.waitFor();
    await dlg3.locator('input[type=file]').setInputFiles(expPath);
    await dlg3.getByText('Sẽ cập nhật').waitFor({ timeout: 20000 });
    check('nhập lại file vừa xuất: 0 giá cập nhật, nút ghi tắt', /0 giá/.test(await dlg3.innerText()) && (await dlg3.getByRole('button', { name: 'Ghi thay đổi' }).isDisabled()));

    // ── File lỗi từng dòng ──
    const errPath = path.join(OUT, 'loi.xlsx');
    const { wb: errWb, sheet: errSheet } = await loadSheet(expPath);
    errSheet.addRow(['Xét nghiệm', 'Dịch vụ không tồn tại', null, 1000]);
    errSheet.getRow(target.row).getCell(target.col).value = 'abc';
    await errWb.xlsx.writeFile(errPath);
    await dlg3.locator('input[type=file]').setInputFiles(errPath);
    await dlg3.getByText('Lỗi và cách sửa').waitFor({ timeout: 20000 });
    const errText = await dlg3.innerText();
    check('file lỗi: bảng Dòng/Cột/Lỗi, nêu cột + cách sửa, có dòng nhắc sửa file', /Lỗi và cách sửa/i.test(errText) && /không có dịch vụ "Dịch vụ không tồn tại"/.test(errText) && /"abc" không phải số/.test(errText) && /Chưa có giá nào được ghi/.test(errText));
    check('file lỗi: không có nút ghi dùng được', (await dlg3.getByRole('button', { name: /^Ghi/ }).isDisabled()));
    await page.screenshot({ path: path.join(OUT, '05-loi-tung-dong.png') });

    // ── Sai mẫu ──
    const badPath = path.join(OUT, 'sai-mau.xlsx');
    const badWb = new ExcelJS.Workbook();
    badWb.addWorksheet('Giá trả đối tác').addRow(['Tên', 'Loại', 'Gì đó']);
    await badWb.xlsx.writeFile(badPath);
    await dlg3.locator('input[type=file]').setInputFiles(badPath);
    await page.getByText(/file không đúng mẫu/).waitFor({ timeout: 20000 });
    const badBody = await dlg3.innerText();
    check('file sai mẫu: báo tiếng Việt ngay trong hộp, không lộ mã', /file không đúng mẫu/.test(badBody) && !FORBIDDEN.test(badBody.replace(/Mã ống/g, '')));

    // ── Lỗi máy chủ khi xem trước: giữ hộp, báo tại chỗ ──
    await page.route('**/api/v1/lab-partners/price-import/preview', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
    await dlg3.locator('input[type=file]').setInputFiles(expPath);
    await page.waitForTimeout(1500);
    const e500 = await page.locator('body').innerText();
    check('lỗi 500 khi xem trước: thông báo tiếng Việt, hộp còn mở, không lộ mã', (await dlg3.count()) === 1 && !FORBIDDEN.test((await dlg3.innerText()).replace(/Mã ống/g, '')), e500.slice(0, 0));
    await page.screenshot({ path: path.join(OUT, '06-loi-500.png') });
    await page.unroute('**/api/v1/lab-partners/price-import/preview');

    // ── Mất mạng khi tải file mẫu ──
    await dlg3.getByRole('button', { name: 'Huỷ' }).click();
    await page.route('**/api/v1/lab-partners/price-import/template', (route) => route.abort('connectionrefused'));
    await openMenu();
    await page.getByRole('menuitem', { name: 'Tải file mẫu' }).click();
    await page.waitForTimeout(1500);
    const netBody = await page.locator('body').innerText();
    check('mất mạng khi tải file mẫu: báo tiếng Việt, trang còn nguyên', /Không tải được file Excel|Không kết nối được|máy chủ/i.test(netBody) && (await page.getByRole('button', { name: /Giá trả \(Excel\)/ }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, '07-mat-mang.png') });
    await page.unroute('**/api/v1/lab-partners/price-import/template');
    const closeBtn = page.getByRole('button', { name: 'Đóng' });
    if ((await closeBtn.count()) > 0) await closeBtn.last().click().catch(() => {});

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(WEB + '/admin/catalog-paraclinical');
      await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).or(page.getByRole('tab', { name: 'Đối tác xét nghiệm' })).first().click();
      await page.getByRole('button', { name: /Giá trả \(Excel\)/ }).waitFor({ timeout: 20000 });
      await openMenu();
      await page.getByRole('menuitem', { name: /Nhập giá trả từ Excel/ }).click();
      const d = page.getByRole('dialog', { name: 'Nhập giá trả từ Excel' });
      await d.locator('input[type=file]').setInputFiles(errPath);
      await d.getByText('Lỗi và cách sửa').waitFor({ timeout: 20000 });
      const box = await d.boundingBox();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${w}×${h}: hộp nằm trọn khung hình, trang không cuộn ngang`, !!box && box.x >= 0 && box.x + box.width <= w + 1 && box.y >= 0 && box.y + box.height <= h + 1 && overflow <= 1, `hộp ${Math.round(box.width)}×${Math.round(box.height)}, lệch ${overflow}px`);
      await page.screenshot({ path: path.join(OUT, `08-${w}x${h}.png`) });
      await d.getByRole('button', { name: 'Huỷ' }).click();
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
