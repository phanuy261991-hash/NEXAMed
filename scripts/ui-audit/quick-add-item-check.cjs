/* global require, process, console, window, document, fetch */
// KIỂM "Thêm nhanh mặt hàng" (docs/DECISIONS.md #298 bổ sung 2) trên Chrome thật qua IP LAN HTTP, ở Đơn đặt hàng NCC và Phiếu nhập kho:
// dòng "Thêm mặt hàng mới" khi gõ không ra kết quả, Enter mở hộp, kiểm lỗi trong hộp (giữ nguyên dữ liệu), lưu xong tự thêm dòng + mã MH tự sinh,
// Enter trong hộp KHÔNG lưu nhầm cả đơn, lỗi máy chủ 500 giữ dữ liệu, người không có quyền thêm thuốc/vật tư chỉ thấy gợi ý nhờ quản lý, phiếu nhận theo đơn không mở hộp.
// Dữ liệu thử có tiền tố KIEMNHANH ở công ty thử (không xoá — không có xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/quick-add-item-check.cjs
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
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'quick-add-item-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

(async () => {
  const login = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: USER, password: PASS }) });
  const token = (await login.json()).data.accessToken;
  const api = async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };

  // ── Dữ liệu thử: NCC + kho nhận; vai trò/tài khoản KHÔNG có quyền thêm thuốc/vật tư ──
  const warehouses = (await api('GET', '/warehouses')).body.items;
  const wh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const supplier = (await api('POST', '/suppliers', { name: `KIEMNHANH NCC ${stamp}` })).body;
  check('dữ liệu thử: NCC + kho nhận', !!supplier?.id && !!wh?.id);

  const roles = (await api('GET', '/roles?limit=200')).body.items;
  const adminRole = roles.find((r) => r.code === 'clinic_admin' || r.name === 'Quản lý phòng khám' || /clinic_admin/.test(JSON.stringify(r)));
  const newRole = (await api('POST', '/roles', { name: `KIEMNHANH ${stamp}` })).body;
  const adminMatrix = (await api('GET', `/roles/${adminRole.id}/permissions`)).body.permissions;
  const newMatrix = await api('GET', `/roles/${newRole.id}/permissions`);
  const entries = adminMatrix.filter((p) => !(p.module === 'drug' && p.action === 'create') && p.dataScope !== 'none').map((p) => ({ permissionId: p.permissionId, dataScope: p.dataScope }));
  const saved = await api('PUT', `/roles/${newRole.id}/permissions`, { version: newMatrix.body.role.version, entries });
  const limitedUser = `kiemnhanh${stamp}`;
  const limited = await api('POST', '/users', { username: limitedUser, password: 'Kiem@12345', fullName: `Kiểm nhanh ${stamp}`, displayName: `Kiểm nhanh ${stamp}`, roleIds: [newRole.id] });
  check('tạo vai trò + tài khoản KHÔNG có quyền thêm thuốc/vật tư', saved.status === 200 && [200, 201].includes(limited.status), `roleSave=${saved.status} user=${limited.status}`);

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
  const pickFirst = async (page, id) => {
    await page.click(`#${id}`);
    await page.locator('[role=option]').first().click();
  };

  const page = await openSession(USER, PASS);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const bodyText = () => page.evaluate(() => document.body.innerText);

  // ═══ A. Đơn đặt hàng NCC ═══
  await page.goto(WEB + '/inventory/purchase-orders/new');
  await page.waitForSelector('#po-drug-search', { timeout: 15000 });
  const newName = `Khẩu trang N95 KIEMNHANH ${stamp}`;
  await page.fill('#po-drug-search', newName);
  await page.waitForSelector('text=Thêm mặt hàng mới', { timeout: 10000 });
  check('PO: gõ tên chưa có → hiện dòng "Thêm mặt hàng mới" mang sẵn tên vừa gõ (không còn "Không tìm thấy")', (await bodyText()).includes(`Thêm mặt hàng mới "${newName}"`) && !(await bodyText()).includes('Không tìm thấy'));
  await shot('01-po-dong-them-moi');
  await page.press('#po-drug-search', 'Enter');
  await page.waitForSelector('#quick-add-name', { timeout: 5000 });
  check('PO: Enter mở hộp, tên điền sẵn', (await page.inputValue('#quick-add-name')) === newName);
  check('PO: hộp nằm ngoài <form> của đơn (portal), không lồng form', (await page.evaluate(() => !!document.querySelector('#quick-add-name') && !document.querySelector('form form'))));
  await shot('02-po-hop-vat-tu');

  // Lưu thiếu mục bắt buộc → báo lỗi tại chỗ, giữ nguyên dữ liệu, KHÔNG lưu nhầm cả đơn (đơn chưa chọn NCC: nếu bị submit sẽ hiện "Phải chọn Nhà cung cấp.")
  await page.press('#quick-add-name', 'Enter');
  await page.waitForSelector('[role=alert]:has-text("Phân nhóm VTYT")', { timeout: 5000 });
  check('PO: thiếu mục bắt buộc → báo đúng mục đầu tiên còn thiếu, hộp vẫn mở, tên còn nguyên', (await page.inputValue('#quick-add-name')) === newName);
  check('PO: Enter trong hộp KHÔNG submit form đơn phía sau', !(await bodyText()).includes('Phải chọn Nhà cung cấp'));

  // Lỗi máy chủ 500 khi lưu → thông báo tiếng Việt, giữ dữ liệu, không lộ mã
  await pickFirst(page, 'quick-add-group');
  await pickFirst(page, 'quick-add-manufacturer');
  await page.fill('#quick-add-registration', `GP-${stamp}`);
  await pickFirst(page, 'quick-add-base-unit');
  await page.fill('#quick-add-price', '15000');
  await shot('03-po-hop-da-dien');
  await page.route('**/api/v1/drugs', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }) : route.continue()));
  await page.click('button[type=submit]:has-text("Thêm vào đơn")');
  await page.waitForTimeout(1500);
  const afterFail = await bodyText();
  await shot('04-po-loi-500');
  check('PO: lỗi 500 khi lưu → không lộ mã/lỗi thô', !FORBIDDEN.test(afterFail.replace(newName, '')), afterFail.match(FORBIDDEN)?.[0]);
  check('PO: lỗi 500 → dữ liệu đang nhập còn nguyên', (await page.locator('#quick-add-name').count()) === 1 ? (await page.inputValue('#quick-add-name')) === newName && (await page.inputValue('#quick-add-registration')) === `GP-${stamp}` : (afterFail.includes('Thử lại') || afterFail.includes('Đóng')));
  // đóng hộp báo lỗi hệ thống (nếu có) rồi bỏ chặn
  const closeFailure = page.locator('[role=dialog] button:has-text("Đóng")');
  if (await closeFailure.count()) await closeFailure.last().click();
  await page.unroute('**/api/v1/drugs');
  if ((await page.locator('#quick-add-name').count()) === 0) {
    await page.fill('#po-drug-search', newName);
    await page.waitForSelector('text=Thêm mặt hàng mới');
    await page.press('#po-drug-search', 'Enter');
    await page.waitForSelector('#quick-add-name');
    await pickFirst(page, 'quick-add-group');
    await pickFirst(page, 'quick-add-manufacturer');
    await page.fill('#quick-add-registration', `GP-${stamp}`);
    await pickFirst(page, 'quick-add-base-unit');
    await page.fill('#quick-add-price', '15000');
  }

  // Lưu thật
  await page.click('button[type=submit]:has-text("Thêm vào đơn")');
  await page.waitForSelector('#quick-add-name', { state: 'detached', timeout: 15000 });
  await page.waitForSelector(`text=${newName}`, { timeout: 10000 });
  const qty = page.locator(`input[aria-label="Số đặt ${newName}"]`);
  check('PO: lưu xong → dòng mới tự thêm vào đơn, số đặt để trống', (await qty.count()) === 1 && (await qty.inputValue()) === '');
  const created = (await api('GET', `/drugs?q=${encodeURIComponent(newName)}`)).body.items.find((d) => d.name === newName);
  check('mặt hàng mới có thật ở danh mục, loại Vật tư, mã tự sinh tiền tố MH', !!created && created.itemType === 'SUPPLY' && /^MH/.test(created.code), created ? `${created.code} ${created.itemType}` : 'không thấy');
  check('ô tìm hàng được xoá sau khi thêm', (await page.inputValue('#po-drug-search')) === '');
  await shot('05-po-sau-khi-them');
  // đơn dùng được ngay: lưu nháp thành công với mặt hàng vừa tạo
  await pickFirst(page, 'po-supplier');
  if (!(await page.locator('#po-warehouse').innerText()).includes(wh.name)) await pickFirst(page, 'po-warehouse');
  await qty.fill('5');
  await page.click('button:has-text("Lưu nháp")');
  await page.waitForURL(/\/inventory\/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const savedOrderId = page.url().split('/').pop();
  check('PO: lập đơn với mặt hàng vừa thêm nhanh → lưu được', /^[0-9a-f-]{36}$/.test(savedOrderId));

  // Tên đã có sẵn trong đơn → KHÔNG hiện "Thêm mặt hàng mới" (mặt hàng đã có trong danh mục)
  await page.goto(WEB + '/inventory/purchase-orders/new');
  await page.waitForSelector('#po-drug-search');
  await page.fill('#po-drug-search', newName);
  await page.waitForSelector(`button:has-text("${newName}")`, { timeout: 10000 });
  check('PO: gõ tên mặt hàng ĐÃ có → hiện mặt hàng, không hiện "Thêm mặt hàng mới"', !(await bodyText()).includes('Thêm mặt hàng mới'));

  // ═══ B. Phiếu nhập kho ═══
  await page.goto(WEB + '/inventory/receipts/new');
  await page.waitForTimeout(1500);
  await shot('06-phieu-nhap-dau');
  // Hộp "Thông tin phiếu nhập kho" mở sẵn lúc tạo mới: chọn kho + NCC rồi Lưu.
  await page.waitForSelector('#receipt-warehouse', { timeout: 10000 });
  await pickFirst(page, 'receipt-warehouse');
  await pickFirst(page, 'receipt-supplier');
  await page.click('[role=dialog] button[type=submit]:has-text("Lưu"), [role=dialog] button:has-text("Lưu")');
  await page.waitForSelector('#receipt-warehouse', { state: 'detached', timeout: 10000 });
  const receiptName = `Bơm tiêm KIEMNHANH ${stamp}`;
  await page.fill('#receipt-drug-search', receiptName);
  await page.waitForSelector('text=Thêm mặt hàng mới', { timeout: 10000 });
  check('Phiếu nhập: gõ tên chưa có → hiện dòng "Thêm mặt hàng mới"', (await bodyText()).includes(`Thêm mặt hàng mới "${receiptName}"`));
  await page.click('button:has-text("Thêm mặt hàng mới")');
  await page.waitForSelector('#quick-add-name');
  check('Phiếu nhập: bấm dòng mở hộp, nút lưu ghi "Thêm vào phiếu"', (await page.inputValue('#quick-add-name')) === receiptName && (await page.locator('button[type=submit]:has-text("Thêm vào phiếu")').count()) === 1);
  // Chuyển sang Thuốc để kiểm khối Hoạt chất & hàm lượng
  await page.click('button[aria-pressed]:has-text("Thuốc")');
  check('Phiếu nhập: chọn "Thuốc" → hiện khối Hoạt chất & hàm lượng + Đường dùng', (await bodyText()).includes('HOẠT CHẤT') || (await bodyText()).toLowerCase().includes('hoạt chất & hàm lượng'));
  await shot('07-phieu-nhap-hop-thuoc');
  await page.click('button[aria-pressed]:has-text("Vật tư y tế")');
  await pickFirst(page, 'quick-add-group');
  await pickFirst(page, 'quick-add-manufacturer');
  await page.fill('#quick-add-registration', `GP2-${stamp}`);
  await pickFirst(page, 'quick-add-base-unit');
  // "Chỉ dùng nội bộ": không cần giá bán
  await page.check('input[type=checkbox]');
  check('Phiếu nhập: bật "Chỉ dùng nội bộ" → ô giá bán bị khoá', await page.locator('#quick-add-price').isDisabled());
  await page.click('button[type=submit]:has-text("Thêm vào phiếu")');
  await page.waitForSelector('#quick-add-name', { state: 'detached', timeout: 15000 });
  await page.waitForSelector(`text=${receiptName}`, { timeout: 10000 });
  const created2 = (await api('GET', `/drugs?q=${encodeURIComponent(receiptName)}`)).body.items.find((d) => d.name === receiptName);
  check('Phiếu nhập: lưu xong → dòng mới vào phiếu; mặt hàng nội bộ có mã MH, internalUseOnly', !!created2 && /^MH/.test(created2.code) && created2.internalUseOnly === true, created2 ? created2.code : 'không thấy');
  await shot('08-phieu-nhap-sau-khi-them');

  // Esc đóng hộp, không thêm gì
  await page.fill('#receipt-drug-search', `Khong co ${stamp}`);
  await page.waitForSelector('text=Thêm mặt hàng mới');
  await page.press('#receipt-drug-search', 'Enter');
  await page.waitForSelector('#quick-add-name');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#quick-add-name', { state: 'detached' });
  check('Esc đóng hộp, không tạo mặt hàng', (await api('GET', `/drugs?q=${encodeURIComponent('Khong co ' + stamp)}`)).body.items.length === 0);

  // ═══ C. Người KHÔNG có quyền thêm thuốc/vật tư ═══
  const lim = await openSession(limitedUser, 'Kiem@12345');
  await lim.goto(WEB + '/inventory/purchase-orders/new');
  await lim.waitForSelector('#po-drug-search', { timeout: 15000 });
  await lim.fill('#po-drug-search', `Không có ${stamp}`);
  await lim.waitForSelector('text=Nhờ quản lý thêm', { timeout: 10000 });
  const limText = await lim.evaluate(() => document.body.innerText);
  check('không có quyền thêm thuốc/vật tư: chỉ thấy gợi ý nhờ quản lý, KHÔNG có dòng "Thêm mặt hàng mới"', !limText.includes('Thêm mặt hàng mới') && limText.includes('Nhờ quản lý thêm'));
  await lim.press('#po-drug-search', 'Enter');
  await lim.waitForTimeout(500);
  check('không có quyền: Enter không mở hộp', (await lim.locator('#quick-add-name').count()) === 0);
  await lim.screenshot({ path: path.join(OUT, '09-khong-quyen.png') });

  // ═══ D. Phiếu nhận theo đơn không thêm được mặt hàng ngoài đơn → không mở hộp ═══
  // (cần đơn đã đặt NCC; kiểm nhanh bằng API: duyệt + đã gửi, rồi mở /inventory/receipts/new?fromOrder=)
  const orderId = savedOrderId;
  const orderRes = await api('GET', `/inventory/purchase-orders/${orderId}`);
  let ordered = orderRes.body;
  if (ordered && ordered.status === 'DRAFT') {
    const approved = await api('POST', `/inventory/purchase-orders/${orderId}/approve`, { version: ordered.version });
    if (approved.status === 200) ordered = (await api('POST', `/inventory/purchase-orders/${orderId}/order`, { version: approved.body.version })).body ?? approved.body;
  }
  if (ordered && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(ordered.status)) {
    await page.goto(`${WEB}/inventory/receipts/new?fromOrder=${orderId}`);
    await page.waitForSelector('#receipt-drug-search', { timeout: 15000 });
    await page.fill('#receipt-drug-search', `Không có ${stamp}`);
    await page.waitForTimeout(1500);
    const orderText = await bodyText();
    check('phiếu nhận theo đơn: gõ tên lạ KHÔNG hiện "Thêm mặt hàng mới"', !orderText.includes('Thêm mặt hàng mới'));
    await page.press('#receipt-drug-search', 'Enter');
    await page.waitForTimeout(400);
    check('phiếu nhận theo đơn: Enter không mở hộp', (await page.locator('#quick-add-name').count()) === 0);
  } else {
    console.log('BỎ QUA mục D: không đưa được đơn sang trạng thái đã đặt NCC —', ordered?.status);
  }

  check('không có lỗi script trên trang (pageerror)', page.pageErrors.length === 0 && lim.pageErrors.length === 0, [...page.pageErrors, ...lim.pageErrors].join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\nKẾT QUẢ: ${results.length - failed}/${results.length} đạt. Ảnh ở ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT LỖI:', e);
  process.exit(2);
});
