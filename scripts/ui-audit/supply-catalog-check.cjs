/* global require, process, console, window, document, fetch */
// KIỂM Danh mục Thuốc & Vật tư (docs/DECISIONS.md #297 GĐ1) trên Chrome thật qua IP LAN HTTP:
// form Thêm vật tư (Phân nhóm VTYT, Tính chất, Số đăng ký, công tắc "Chỉ dùng nội bộ"), danh sách, ẩn mặt hàng nội bộ khỏi danh sách bán/kê đơn,
// xuất → nhập lại Excel, lỗi lưu giữ nguyên dữ liệu. Tạo MỘT vật tư thử mã KIEM297-… ở công ty thử (không xoá được, chỉ ẩn).
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/supply-catalog-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const ExcelJS = createRequire(path.join(__dirname, '../../apps/api/package.json'))('exceljs');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'supply-catalog-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack/;

const stamp = String(Date.now()).slice(-7);
const CODE = `KIEM297-${stamp}`;
const NAME = `Găng tay kiểm 297 ${stamp}`;
const GROUP = `Nhóm kiểm ${stamp}`;
const MANU = `Hãng kiểm ${stamp}`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function apiToken() {
  const res = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: USER, password: PASS }) });
  return (await res.json()).data.accessToken;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  // Chọn một dòng trong Combobox: gõ rồi bấm dòng khớp (hoặc dòng "thêm mới").
  const pick = async (id, text, { create = false } = {}) => {
    const input = page.locator(`#${id}`);
    await input.click();
    await input.fill(text);
    const option = create ? page.getByRole('option').filter({ hasText: text }).first() : page.getByRole('option', { name: text }).first();
    await option.waitFor({ timeout: 10000 });
    await option.click();
  };

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await page.goto(WEB + '/admin/catalog-pharmacy');
    await page.getByRole('button', { name: /Thêm mặt hàng/ }).waitFor({ timeout: 20000 });
    const headers = await page.locator('thead th').allInnerTexts();
    check('danh sách có cột "Phân nhóm" và "Tính chất"', headers.some((h) => /Phân nhóm/i.test(h)) && headers.some((h) => /Tính chất/i.test(h)), headers.join(' | '));
    await page.screenshot({ path: path.join(OUT, '01-danh-sach.png') });

    // ── Form Thêm vật tư ──
    await page.getByRole('button', { name: /Thêm mặt hàng/ }).click();
    await page.getByRole('menuitem', { name: /vật tư/i }).click();
    const form = page.locator('form').filter({ has: page.locator('#drug-name') });
    await form.locator('#drug-name').waitFor({ timeout: 10000 });
    const formText = await form.innerText();
    check('tiêu đề "Thêm vật tư", có Phân nhóm VTYT / Tính chất sử dụng / Số đăng ký / GPNK / Bảo quản & nhận diện / Chỉ dùng nội bộ',
      /Thêm vật tư/i.test(formText) && /Phân nhóm VTYT/i.test(formText) && /Tính chất sử dụng/i.test(formText) && /Số đăng ký \/ GPNK/i.test(formText) && /Bảo quản/i.test(formText) && /Chỉ dùng nội bộ, không bán/i.test(formText));
    check('KHÔNG có ô "Nhóm thuốc"/"Đường dùng" của thuốc', (await form.locator('#drug-group').count()) === 0 && (await form.locator('#drug-route').count()) === 0);
    check('thiếu Phân nhóm + Số đăng ký thì nút Lưu bị khoá', await form.getByRole('button', { name: 'Lưu', exact: true }).isDisabled());
    await page.screenshot({ path: path.join(OUT, '02-form-vat-tu.png') });

    await form.locator('#drug-code').fill(CODE);
    await form.locator('#drug-name').fill(NAME);
    await pick('drug-base-unit', 'Cái');
    await pick('drug-manufacturer', MANU, { create: true });
    await pick('drug-supply-group', GROUP, { create: true });
    check('thêm nhanh Phân nhóm VTYT: ô chọn hiện tên mới', (await form.locator('#drug-supply-group').inputValue()) === GROUP, await form.locator('#drug-supply-group').inputValue());
    check('còn thiếu Số đăng ký → Lưu vẫn khoá', await form.getByRole('button', { name: 'Lưu', exact: true }).isDisabled());
    await form.locator('#drug-registration-number').fill('2300456ĐKLH/BYT-HTTB');
    await form.getByRole('button', { name: 'Tái sử dụng' }).click();
    await form.locator('#drug-barcode').fill('8936000297297');

    // Công tắc nội bộ: giá bán thành "Không bán", không còn bắt buộc.
    await form.getByRole('switch', { name: /Chỉ dùng nội bộ/ }).setChecked(true, { force: true });
    check('bật "Chỉ dùng nội bộ" → ô giá hiện "Không bán" và bị khoá', (await form.locator('#drug-price').inputValue()) === 'Không bán' && (await form.locator('#drug-price').isDisabled()));
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button[type=submit]')].find((x) => x.textContent.trim() === 'Lưu'); return b && !b.disabled; }, null, { timeout: 5000 }).catch(() => {});
    check('đủ trường bắt buộc → nút Lưu mở', await form.getByRole('button', { name: 'Lưu', exact: true }).isEnabled());
    await page.screenshot({ path: path.join(OUT, '03-form-day-du.png') });

    // ── Lỗi lưu: giả lập 503, dữ liệu form phải còn nguyên ──
    await page.route('**/api/v1/drugs', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"X","message":"Service Unavailable"}}' }) : route.continue()));
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    const failure = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: /không|lỗi|thử lại/i })).last();
    await failure.waitFor({ timeout: 10000 });
    const failureText = await failure.innerText();
    check('lỗi hệ thống: có hộp thông báo tiếng Việt, không lộ mã/lỗi thô', !FORBIDDEN.test(failureText) && failureText.trim().length > 10, failureText.replace(/\s+/g, ' ').slice(0, 120));
    await page.screenshot({ path: path.join(OUT, '04-loi-luu.png') });
    await failure.getByRole('button').first().click().catch(() => {});
    await page.unroute('**/api/v1/drugs');
    check('sau lỗi, dữ liệu đang nhập còn nguyên (mã, tên, số đăng ký)', (await form.locator('#drug-code').inputValue()) === CODE && (await form.locator('#drug-name').inputValue()) === NAME && (await form.locator('#drug-registration-number').inputValue()) !== '');

    // ── Lưu thật ──
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await form.waitFor({ state: 'detached', timeout: 20000 });
    await page.locator('input[placeholder^="Tìm theo tên"]').fill(CODE);
    const row = page.locator('tbody tr').filter({ hasText: CODE });
    await row.first().waitFor({ timeout: 20000 });
    const rowText = await row.first().innerText();
    check('danh sách: dòng mới có Phân nhóm, "Tái sử dụng", dấu "Chỉ dùng nội bộ"', rowText.includes(GROUP) && /Tái sử dụng/.test(rowText) && /Chỉ dùng nội bộ/.test(rowText), rowText.replace(/\s+/g, ' ').slice(0, 160));
    await page.waitForTimeout(1200);
    check('cột Giá bán/Quản lý lô không bị bẻ dòng: dấu "Chỉ dùng nội bộ" và "Theo lô" đều 1 dòng', await page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((r) => /KIEM297-/.test(r.innerText)).every((r) => [...r.querySelectorAll('span')].filter((s) => /^(Chỉ dùng nội bộ|Theo lô)$/.test(s.innerText.trim())).every((s) => s.getBoundingClientRect().height < 30))));
    await page.screenshot({ path: path.join(OUT, '05-dong-moi.png') });

    await row.first().click();
    const detail = await page.locator('main').innerText();
    check('chi tiết: Phân nhóm VTYT (tên), "Chỉ dùng nội bộ, không bán", số đăng ký, mã vạch',
      detail.includes(GROUP) && /Chỉ dùng nội bộ, không bán/.test(detail) && detail.includes('2300456ĐKLH/BYT-HTTB') && detail.includes('8936000297297'));
    await page.screenshot({ path: path.join(OUT, '06-chi-tiet.png') });

    // ── Máy chủ: mặt hàng nội bộ không có trong danh sách bán/kê đơn ──
    const token = await apiToken();
    const get = async (qs) => (await (await fetch(`${WEB}/api/v1/drugs?${qs}`, { headers: { authorization: `Bearer ${token}` } })).json()).data.items;
    const all = await get(`q=${CODE}`);
    const sellable = await get(`q=${CODE}&sellableOnly=true`);
    check('GET /drugs thấy mặt hàng; sellableOnly=true (danh sách kê đơn/phát thuốc) KHÔNG thấy', all.some((d) => d.code === CODE && d.internalUseOnly === true && d.defaultSellPrice === null) && sellable.every((d) => d.code !== CODE));

    // ── Xuất Excel → nhập lại (đóng panel chi tiết trước vì nó che nút) ──
    await page.locator("button[aria-label='Đóng']").first().click();
    await page.locator("button[aria-label='Đóng']").first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.locator('input[placeholder^="Tìm theo tên"]').fill('');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: 'Xuất Excel' }).click()]);
    const xlsxPath = path.join(OUT, 'xuat.xlsx');
    await dl.saveAs(xlsxPath);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const sheet = wb.getWorksheet('Thuốc & Vật tư');
    const head = sheet.getRow(1).values.slice(1).map(String);
    check('file xuất có cột Chỉ dùng nội bộ / Phân nhóm VTYT *(vật tư) / Tính chất sử dụng (vật tư)', ['Chỉ dùng nội bộ', 'Phân nhóm VTYT *(vật tư)', 'Tính chất sử dụng (vật tư)'].every((h) => head.includes(h)), head.join(' | '));
    let found = null;
    sheet.eachRow((r, n) => {
      if (n > 1 && String(r.getCell(1).value) === CODE) found = r.values.slice(1).map(String);
    });
    check('dòng vật tư thử trong file xuất: tên nhóm, "Tái sử dụng", "Có"', !!found && found.includes(GROUP) && found.includes('Tái sử dụng') && found.includes('Có'));

    await page.getByRole('button', { name: 'Nhập Excel' }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: /Nhập Thuốc & Vật tư/ });
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('input[type=file]').setInputFiles(xlsxPath);
    await dlg.getByText(/Đã có sẵn/i).first().waitFor({ timeout: 40000 });
    const dlgText = await dlg.innerText();
    check('nhập lại chính file xuất: không có dòng lỗi, mọi mã là "Đã có sẵn"', !/dòng lỗi|Lỗi\s*[1-9]/i.test(dlgText.replace(/\n/g, ' ')) && /Đã có sẵn/i.test(dlgText), dlgText.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '07-nhap-lai.png') });

    check('không có lỗi JS trong trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

    // Dọn: ẩn các vật tư thử có mã bắt đầu CHÍNH XÁC bằng KIEM297- (in danh sách trước khi sửa).
    const leftovers = (await get('q=KIEM297&includeInactive=true')).filter((d) => d.code.startsWith('KIEM297-') && d.isActive);
    console.log('Ẩn vật tư thử:', leftovers.map((d) => d.code).join(', ') || '(không có)');
    for (const d of leftovers) {
      await fetch(`${WEB}/api/v1/drugs/${d.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ isActive: false, version: d.version }) });
    }
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, String(e && e.message).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} đạt. Ảnh: ${OUT}`);
  process.exit(pass === results.length ? 0 : 1);
})();
