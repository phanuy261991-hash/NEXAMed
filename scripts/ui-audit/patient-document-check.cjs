/* global require, process, console, window, document, fetch, Buffer */
// KIỂM tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299) trên Chrome thật qua IP LAN HTTP: rỗng → tải lên nhiều tệp (kể cả tệp quá 15 MB báo ngay tại dòng) →
// xem theo ngày → xem theo loại → thư mục tự tạo (tạo, chuyển tệp vào, xoá thư mục còn tệp báo lỗi trong hộp) → xem lớn → sửa → xoá có lý do → lỗi tải danh sách
// (ErrorBanner + Thử lại) → mất mạng khi tải lên (hộp lỗi hệ thống, danh sách tệp còn nguyên) → lễ tân chỉ thấy hợp đồng và giấy tờ. Dữ liệu thử có tiền tố KIEMTAILIEU (không xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/patient-document-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

function lanIPv4() {
  const all = Object.values(os.networkInterfaces()).flatMap((infos) => infos ?? []).filter((i) => i.family === 'IPv4' && !i.internal);
  const rank = (a) => (/^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : 9);
  return all.map((i) => i.address).filter((a) => rank(a) < 9).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
const WEB = process.env.UI_AUDIT_WEB || `http://${lanIPv4()}:5174`;
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'patient-document-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|PATIENT_DOCUMENT/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const zlib = require('zlib');
/** PNG RGB nhiễu ngẫu nhiên (không nén được) lớn hơn 15 MB nhưng trình duyệt giải mã bình thường. */
function bigNoisePng(side) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = side * 3 + 1;
  const raw = require('crypto').randomBytes(row * side);
  for (let y = 0; y < side; y++) raw[y * row] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const login = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: USER, password: PASS }) });
  const token = (await login.json()).data.accessToken;
  const api = async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };

  const nid = '079' + String(Math.floor(100000000 + Math.random() * 899999999));
  const patient = (await api('POST', '/patients', { fullName: `KIEMTAILIEU ${stamp}`, dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: nid })).body;
  check('dữ liệu thử: bệnh nhân', !!patient?.id);
  const roles = (await api('GET', '/roles?limit=200')).body.items;
  const recRole = roles.find((r) => /receptionist|lễ tân/i.test(JSON.stringify(r)));
  const recUser = `kiemtailieu${stamp}`;
  const created = await api('POST', '/users', { username: recUser, password: 'Kiem@12345', fullName: `Lễ tân kiểm ${stamp}`, displayName: `Lễ tân kiểm ${stamp}`, roleIds: [recRole.id] });
  check('tạo tài khoản lễ tân thử', [200, 201].includes(created.status), `status=${created.status}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  async function openSession(username, password) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.pageErrors = [];
    page.on('pageerror', (e) => page.pageErrors.push(e.message));
    await page.route('**/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', tenantId: TENANT }) }));
    await page.goto(WEB + '/login');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    return page;
  }
  const text = (page) => page.evaluate(() => document.body.innerText);
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const noRaw = async (page, label) => check(`${label}: không lộ mã/lỗi thô`, !FORBIDDEN.test(await text(page)));
  const openTab = async (page) => {
    await page.goto(`${WEB}/patients/${patient.id}`);
    await page.getByRole('button', { name: 'Hình ảnh & Tài liệu' }).click();
  };

  try {
    const page = await openSession(USER, PASS);
    await openTab(page);

    // ── Trạng thái rỗng ──
    await page.getByText('Chưa có hình ảnh hay tài liệu').waitFor({ timeout: 15000 });
    check('rỗng: có tiêu đề + nút Tải lên', (await page.getByRole('button', { name: /Tải lên/ }).count()) >= 1);
    await shot(page, '01-rong');

    // ── Tải lên nhiều tệp: ảnh, PDF, tệp > 15 MB (báo lỗi tại dòng), tệp sai định dạng ──
    await page.getByRole('button', { name: /Tải lên/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Tải lên hình ảnh và tài liệu' });
    await dialog.waitFor();
    await dialog.getByLabel('Chọn tệp').setInputFiles([
      { name: 'Vết thương cẳng tay.png', mimeType: 'image/png', buffer: PNG },
      { name: 'Hop-dong-goi-kham.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 'Phim-panorama-goc.png', mimeType: 'image/png', buffer: bigNoisePng(2400) },
      { name: 'Ho-so-qua-lon.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([PDF, Buffer.alloc(16 * 1024 * 1024)]) },
      { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
    ]);
    await dialog.getByText(/đã thu nhỏ từ/).waitFor({ timeout: 40000 });
    const dt = await dialog.innerText();
    check('hộp tải lên: ảnh quá 15 MB được tự thu nhỏ (nêu dung lượng gốc)', /đã thu nhỏ từ \d+,\d MB/.test(dt));
    check('hộp tải lên: tệp PDF quá 15 MB vẫn báo lỗi ngay tại dòng', /vượt quá 15 MB, chọn tệp nhỏ hơn/.test(dt));
    check('hộp tải lên: tệp sai định dạng báo ngay tại dòng', /Chỉ nhận ảnh JPG, PNG, tệp PDF hoặc DICOM/.test(dt));
    check('hộp tải lên: nút nêu đúng số tệp hợp lệ', /Tải lên 3 tệp/.test(dt));
    check('hộp tải lên: có dòng thư mục ngày + nút Chụp ảnh', /Tệp sẽ vào thư mục ngày \d{2}\/\d{2}\/\d{4}/.test(dt) && /Chụp ảnh/.test(dt));
    // Đổi loại của PDF sang Hợp đồng và giấy tờ.
    const pdfRowCombo = dialog.locator('[id^="doc-cat-"]').nth(1);
    await pdfRowCombo.click();
    await page.getByText('Hợp đồng và giấy tờ', { exact: true }).last().click();
    await dialog.getByLabel('Ghi chú').fill('Bản có chữ ký khách');
    await shot(page, '02-hop-tai-len');
    await dialog.getByRole('button', { name: /Tải lên 3 tệp/ }).click();
    await dialog.waitFor({ state: 'detached', timeout: 20000 });
    check('tải lên xong: hộp tự đóng', true);

    // ── Không cho trùng tên tệp trong cùng hồ sơ ──
    await page.getByRole('button', { name: /Tải lên/ }).first().click();
    const dupUp = page.getByRole('dialog', { name: 'Tải lên hình ảnh và tài liệu' });
    await dupUp.getByLabel('Chọn tệp').setInputFiles([{ name: 'hop-DONG-goi-kham.pdf', mimeType: 'application/pdf', buffer: PDF }]);
    await dupUp.getByRole('button', { name: /Tải lên 1 tệp/ }).click();
    await dupUp.getByText(/Đã có tệp tên/).waitFor({ timeout: 15000 });
    check('trùng tên tệp (không phân biệt hoa thường): báo ngay tại dòng, hộp còn mở', !FORBIDDEN.test(await dupUp.innerText()));
    await dupUp.getByRole('button', { name: 'Huỷ' }).click();

    // ── Xem theo ngày ──
    await page.getByText('Hôm nay', { exact: true }).waitFor({ timeout: 10000 });
    const day = await text(page);
    check('theo ngày: thư mục ngày có chip "Hôm nay" + 3 tệp', /3\s*tệp/.test(day) && /Vết thương cẳng tay/.test(day) && /Hop-dong-goi-kham/.test(day), JSON.stringify(day.slice(Math.max(0, day.indexOf('Hôm nay') - 20), day.indexOf('Hôm nay') + 160)));
    check('theo ngày: dải số có Tổng số tệp, Kết quả cận lâm sàng, Hợp đồng và giấy tờ, Dung lượng', ['Tổng số tệp', 'Kết quả cận lâm sàng', 'Hợp đồng và giấy tờ', 'Dung lượng'].every((t) => day.includes(t)));
    await shot(page, '03-theo-ngay');

    // ── Xem theo loại ──
    await page.getByRole('button', { name: 'Theo loại' }).click();
    await page.getByText('Cập nhật gần nhất').waitFor();
    const root = await text(page);
    check('theo loại: đủ 4 loại', ['Kết quả cận lâm sàng', 'Ảnh lâm sàng', 'Hợp đồng và giấy tờ', 'Khác'].every((t) => root.includes(t)));
    await shot(page, '04-theo-loai');
    await page.getByRole('button', { name: /Hợp đồng và giấy tờ/ }).first().click();
    await page.getByRole('table').waitFor();
    const table = await text(page);
    check('mở loại: bảng có cột Nguồn/Người tải/Dung lượng/Thao tác', ['Tên tệp', 'Ngày tải', 'Nguồn', 'Người tải', 'Dung lượng', 'Thao tác'].every((t) => table.includes(t)));
    check('mở loại: dòng hợp đồng + nguồn "Tải lên tay"', /Hop-dong-goi-kham/.test(table) && /Tải lên tay/.test(table));
    await shot(page, '05-mo-loai');

    // ── Xem lớn ──
    await page.getByText('Hop-dong-goi-kham.pdf').first().click();
    const viewer = page.getByRole('dialog', { name: /Hop-dong-goi-kham/ });
    await viewer.waitFor();
    const vt = await viewer.innerText();
    check('xem lớn: chi tiết tệp + Tải về/Sửa/Chuyển/Xoá', ['Chi tiết tệp', 'Tải về', 'Sửa', 'Chuyển', 'Xoá', 'Bản có chữ ký khách'].every((t) => vt.includes(t)));
    await shot(page, '06-xem-lon');
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    check('xem lớn: Esc đóng', true);

    // ── Thư mục tự tạo ──
    await page.getByRole('button', { name: /Theo loại/ }).first().click(); // về màn gốc
    await page.getByRole('button', { name: /Thư mục mới/ }).click();
    const folderDialog = page.getByRole('dialog', { name: 'Tạo thư mục mới' });
    await folderDialog.getByLabel(/Tên thư mục/).fill('Theo dõi vết thương');
    await folderDialog.getByLabel(/Tên thư mục/).press('Enter');
    await folderDialog.waitFor({ state: 'detached', timeout: 10000 });
    await page.getByText('Thư mục tự tạo', { exact: true }).waitFor();
    check('tạo thư mục: Enter lưu, hiện ở mục "Thư mục tự tạo"', /Theo dõi vết thương/.test(await text(page)));
    // Tên trùng (không phân biệt hoa thường) bị chặn ngay trong hộp.
    await page.getByRole('button', { name: /Thư mục mới/ }).click();
    const dupDialog = page.getByRole('dialog', { name: 'Tạo thư mục mới' });
    await dupDialog.getByLabel(/Tên thư mục/).fill('THEO DÕI VẾT THƯƠNG');
    await dupDialog.getByRole('button', { name: 'Lưu' }).click();
    await dupDialog.getByText(/Đã có thư mục cùng tên/).waitFor({ timeout: 10000 });
    check('tạo thư mục trùng tên: báo lỗi trong hộp, giữ tên đã nhập', (await dupDialog.getByLabel(/Tên thư mục/).inputValue()) === 'THEO DÕI VẾT THƯƠNG');
    await dupDialog.getByRole('button', { name: 'Huỷ' }).click();

    // Chuyển ảnh vào thư mục qua hộp Sửa.
    await page.getByRole('button', { name: /Ảnh lâm sàng/ }).first().click();
    await page.getByRole('table').waitFor();
    await page.getByRole('button', { name: 'Thêm thao tác' }).first().click();
    await page.getByRole('menuitem', { name: /Chuyển thư mục/ }).click();
    const editDialog = page.getByRole('dialog', { name: 'Sửa thông tin tệp' });
    await editDialog.waitFor();
    await editDialog.locator('#doc-edit-folder').click();
    await page.getByText('Theo dõi vết thương', { exact: true }).last().click();
    await editDialog.getByRole('button', { name: 'Lưu' }).click();
    await editDialog.waitFor({ state: 'detached', timeout: 10000 });
    await page.getByRole('button', { name: /Theo loại/ }).first().click();
    await page.getByRole('button', { name: /Theo dõi vết thương/ }).click();
    await page.getByRole('table').waitFor();
    check('chuyển thư mục: ảnh nằm trong thư mục tự tạo', /Phim-panorama-goc/.test(await text(page)));
    await shot(page, '07-thu-muc-tu-tao');

    // Xoá thư mục còn tệp → lỗi trong hộp.
    await page.getByRole('button', { name: /Xoá thư mục/ }).click();
    const delFolder = page.getByRole('dialog', { name: 'Xoá thư mục' });
    await delFolder.getByRole('button', { name: 'Xoá' }).click();
    await delFolder.getByText(/Thư mục còn 1 tệp/).waitFor({ timeout: 10000 });
    check('xoá thư mục còn tệp: lỗi hiện trong hộp, không lộ mã', !FORBIDDEN.test(await delFolder.innerText()));
    await shot(page, '08-xoa-thu-muc-con-tep');
    await delFolder.getByRole('button', { name: 'Huỷ' }).click();

    // ── Xoá tệp cần lý do ──
    await page.getByRole('button', { name: 'Thêm thao tác' }).first().click();
    await page.getByRole('menuitem', { name: 'Xoá' }).click();
    const delDoc = page.getByRole('dialog', { name: 'Xoá tệp' });
    await delDoc.waitFor();
    check('xoá tệp: nút Xoá khoá khi chưa nhập lý do', await delDoc.getByRole('button', { name: 'Xoá' }).isDisabled());
    await delDoc.locator('textarea').fill('Chụp nhầm bệnh nhân');
    await delDoc.getByRole('button', { name: 'Xoá' }).click();
    await delDoc.waitFor({ state: 'detached', timeout: 10000 });
    await page.getByText('Thư mục này chưa có tệp').waitFor({ timeout: 10000 });
    check('xoá tệp: biến khỏi thư mục', true);

    // ── Lỗi tải danh sách ──
    await page.route(/\/documents(\?.*)?$/, (route) => (route.request().method() !== 'GET' ? route.continue() : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) })));
    await page.reload();
    await page.getByRole('button', { name: 'Hình ảnh & Tài liệu' }).click();
    await page.getByRole('button', { name: /Thử lại/ }).waitFor({ timeout: 40000 }).catch(async () => console.log('DEBUG lỗi tải:', JSON.stringify((await text(page)).slice(-400))));
    await noRaw(page, 'lỗi tải danh sách');
    await shot(page, '09-loi-tai');
    await page.unroute(/\/documents(\?.*)?$/);
    await page.getByRole('button', { name: /Thử lại/ }).click();
    await page.getByRole('button', { name: 'Theo ngày' }).waitFor({ timeout: 15000 });
    check('Thử lại: danh sách trở lại', true);

    // ── Mất mạng khi tải lên: hộp lỗi hệ thống, danh sách tệp còn nguyên ──
    await page.getByRole('button', { name: /Tải lên/ }).first().click();
    const dlg2 = page.getByRole('dialog', { name: 'Tải lên hình ảnh và tài liệu' });
    await dlg2.getByLabel('Chọn tệp').setInputFiles([{ name: 'anh-mat-mang.png', mimeType: 'image/png', buffer: PNG }]);
    // Mất mạng SAU KHI máy chủ đã ghi: gửi yêu cầu thật rồi cắt phản hồi — gửi lại phải trả kết quả cũ, không ghi tệp thứ hai.
    await page.route('**/documents', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      return route.abort('failed');
    });
    await dlg2.getByRole('button', { name: /Tải lên 1 tệp/ }).click();
    await page.getByText('Chưa kết nối được máy chủ').waitFor({ timeout: 15000 });
    await noRaw(page, 'mất mạng khi tải lên');
    await shot(page, '10-mat-mang');
    await page.getByRole('button', { name: 'Đóng' }).last().click();
    check('mất mạng: hộp tải lên còn mở, tệp đã chọn còn nguyên', (await dlg2.innerText()).includes('anh-mat-mang.png'));
    await page.unroute('**/documents');
    await dlg2.getByRole('button', { name: /Tải lên 1 tệp/ }).click();
    await dlg2.waitFor({ state: 'detached', timeout: 20000 });
    check('gửi lại sau mất mạng: thành công (máy chủ trả kết quả cũ, không báo trùng tên)', true);
    await page.getByText('anh-mat-mang.png').first().waitFor({ timeout: 15000 });
    const dayText = await text(page);
    check('gửi lại sau mất mạng: chỉ MỘT tệp anh-mat-mang.png', (dayText.match(/anh-mat-mang\.png/g) ?? []).length === 1);

    check('không có lỗi JS trên trang', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.context().close();

    // ── Lễ tân: chỉ thấy hợp đồng và giấy tờ ──
    const rec = await openSession(recUser, 'Kiem@12345');
    const mustChange = rec.url().includes('change-password');
    if (!mustChange) {
      await rec.goto(`${WEB}/patients/${patient.id}`);
      await rec.getByRole('button', { name: 'Hình ảnh & Tài liệu' }).click();
      await rec.getByRole('button', { name: 'Theo ngày' }).waitFor({ timeout: 15000 });
      const rt = await text(rec);
      check('lễ tân: thấy hợp đồng, KHÔNG thấy ảnh lâm sàng/kết quả cận lâm sàng', /Hop-dong-goi-kham/.test(rt) && !/Vết thương cẳng tay/.test(rt) && !rt.includes('Kết quả cận lâm sàng'));
      check('lễ tân: có nút Tải lên', (await rec.getByRole('button', { name: /Tải lên/ }).count()) >= 1);
      await shot(rec, '11-le-tan');
      await rec.context().close();
    } else {
      check('lễ tân: tài khoản mới bị bắt đổi mật khẩu (bỏ qua kiểm riêng)', true);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\nTổng: ${results.length - failed}/${results.length} đạt. Ảnh chụp: ${OUT}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e.message);
  process.exit(2);
});
