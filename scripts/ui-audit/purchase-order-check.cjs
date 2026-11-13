/* global require, process, console, window, document, fetch */
// KIỂM "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 GĐ2) trên Chrome thật qua IP LAN HTTP: menu, danh sách (Excel/In/lọc), lập đơn qua giao diện (tìm hàng, số đặt, đơn giá, "Lưu và duyệt"),
// chi tiết (dải bước, "Đã gửi nhà cung cấp"), "Nhận hàng" mở Phiếu nhập điền sẵn + khoá, nhận một phần/đủ qua API rồi xem lại tiến độ, cột/bộ lọc "Từ đơn" ở Phiếu nhập kho,
// các trạng thái lỗi (#255: lỗi 500 khi tải, đơn không có thật) và bố cục 1280px. Dữ liệu thử có tiền tố KIEMDDH ở công ty thử (không xoá — không có xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/purchase-order-check.cjs
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
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'purchase-order-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|PURCHASE_ORDER_/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

let page;
(async () => {
  const login = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: USER, password: PASS }) });
  const token = (await login.json()).data.accessToken;
  const api = async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };

  // ── Dữ liệu thử: NCC, 1 mặt hàng, kho nhận (kho mặc định của chi nhánh) ──
  const warehouses = (await api('GET', '/warehouses')).body.items;
  const wh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const supplier = (await api('POST', '/suppliers', { name: `KIEMDDH NCC ${stamp}` })).body;
  const drug = (
    await api('POST', '/drugs', {
      code: `KIEMDDH-${stamp}`, name: `Găng tay đặt ${stamp}`, itemType: 'SUPPLY', baseUnitCode: 'HOP', manufacturerCode: 'TEST_MANUFACTURER', defaultSellPrice: 1000,
      drugGroupCode: 'CONSUMABLE', registrationNumber: 'KIEMDDH', isBatchManaged: false, ingredients: [], units: [],
    })
  ).body;
  check('dữ liệu thử: NCC + mặt hàng + kho nhận', !!supplier?.id && !!drug?.id && !!wh?.id);
  const settings = (await api('GET', '/clinic-settings/purchase-order-settings')).body;
  check('cấu hình mặc định: đặt riêng bật, cần chi nhánh chính duyệt tắt, nhận vượt tắt', settings?.branchPurchasingEnabled === true && settings?.branchPurchaseNeedsMainApproval === false && settings?.allowOverReceipt === false, JSON.stringify(settings));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', tenantId: TENANT }) }));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  const bodyText = () => page.evaluate(() => document.body.innerText);

  await page.goto(WEB + '/login');
  check('ngữ cảnh KHÔNG bảo mật (HTTP LAN)', await page.evaluate(() => window.isSecureContext === false));
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  // ── Menu + danh sách ──
  await page.goto(WEB + '/inventory/purchase-orders');
  await page.waitForSelector('button:has-text("Lập đơn đặt hàng")', { timeout: 15000 });
  check('menu có mục "Đơn đặt hàng NCC"', (await page.locator('nav a:has-text("Đơn đặt hàng NCC")').count()) > 0);
  check('có tab "Đơn của chi nhánh này" và "Cần tôi duyệt"', (await page.locator('[role=tab]:has-text("Đơn của chi nhánh này")').count()) === 1 && (await page.locator('[role=tab]:has-text("Cần tôi duyệt")').count()) === 1);
  check('có nút Xuất Excel + In danh sách + Lập đơn đặt hàng', (await page.locator('button:has-text("Xuất Excel")').count()) === 1 && (await page.locator('button:has-text("In danh sách")').count()) === 1);
  await shot('01-danh-sach');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('button:has-text("Xuất Excel")')]);
  check('Xuất Excel tải được tệp .xlsx', /\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());

  // ── Lập đơn qua giao diện ──
  await page.click('button:has-text("Lập đơn đặt hàng")');
  await page.waitForURL('**/inventory/purchase-orders/new');
  await page.waitForSelector('#po-supplier');
  await page.click('#po-supplier');
  await page.locator(`[role=option]:has-text("KIEMDDH NCC ${stamp}")`).first().click();
  if (!(await page.locator('#po-warehouse').innerText()).includes(wh.name)) {
    await page.click('#po-warehouse');
    await page.locator(`[role=option]:has-text("${wh.name}")`).first().click();
  }
  await page.fill('#po-drug-search', `Găng tay đặt ${stamp}`);
  await page.waitForSelector(`button:has-text("Găng tay đặt ${stamp}")`);
  await page.locator(`button:has-text("Găng tay đặt ${stamp}")`).first().click();
  await page.locator(`input[aria-label="Số đặt Găng tay đặt ${stamp}"]`).fill('10');
  await page.locator('input[id^="po-cost-"]').first().fill('2000');
  await page.waitForTimeout(300);
  check('tổng dự kiến hiện 20.000', /20\.000/.test(await bodyText()));
  await shot('02-lap-don');
  // Số đặt 0 → trình duyệt chặn gửi (min=1), dòng đang nhập vẫn còn nguyên
  const qtyInput = page.locator(`input[aria-label="Số đặt Găng tay đặt ${stamp}"]`);
  await qtyInput.fill('0');
  check('số đặt 0 bị chặn ở ô nhập (min=1), giữ dòng đang nhập', await qtyInput.evaluate((el) => el.validity.rangeUnderflow));
  await qtyInput.fill('10');
  const primary = (await page.locator('button[type=submit]').innerText()).trim();
  check('nút chính theo cấu hình: "Lưu và duyệt" (có quyền duyệt, không cần chi nhánh chính)', primary === 'Lưu và duyệt', primary);
  await page.press(`input[aria-label="Số đặt Găng tay đặt ${stamp}"]`, 'Enter'); // Enter-to-submit
  await page.waitForTimeout(2500);
  await shot('02b-sau-enter');
  console.log('SAU ENTER:', (await bodyText()).slice(0, 300).replace(/\n/g, ' | '), page.url());
  await page.waitForURL(/\/inventory\/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const orderId = page.url().split('/').pop();
  await page.waitForSelector('text=Đã duyệt', { timeout: 10000 });
  const detailText = await bodyText();
  check('chi tiết: mã DDH, trạng thái Đã duyệt, nhà cung cấp, dòng hàng', /DDH/.test(detailText) && /Đã duyệt/.test(detailText) && detailText.includes(`KIEMDDH NCC ${stamp}`) && detailText.includes(`Găng tay đặt ${stamp}`));
  await shot('03-chi-tiet-da-duyet');

  // ── Gửi nhà cung cấp → Nhận hàng ──
  await page.click('button:has-text("Đã gửi nhà cung cấp")');
  await page.waitForSelector('button:has-text("Nhận hàng, lập Phiếu nhập kho")', { timeout: 10000 });
  check('sau "Đã gửi nhà cung cấp": trạng thái Đã đặt NCC + có nút Nhận hàng', /Đã đặt NCC/.test(await bodyText()));
  await page.click('button:has-text("Nhận hàng, lập Phiếu nhập kho")');
  await page.waitForURL(/\/inventory\/receipts\/new\?fromOrder=/, { timeout: 10000 });
  await page.waitForSelector('text=Từ đơn đặt hàng', { timeout: 10000 });
  const receiptText = await bodyText();
  check('Phiếu nhập điền sẵn từ đơn: hiện số đơn, NCC, mặt hàng, KHÔNG tự mở hộp thông tin', /DDH/.test(receiptText) && receiptText.includes(`Găng tay đặt ${stamp}`) && !(await page.locator('#receipt-type').count()));
  const qty = await page.locator('input[type=number]').first().inputValue();
  check('số nhận mặc định = số còn thiếu (10)', qty === '10', qty);
  await shot('04-phieu-nhap-tu-don');
  await page.click('button:has-text("Sửa")');
  await page.waitForSelector('#receipt-type');
  check('mở "Sửa" thông tin phiếu: Loại phiếu, Kho, NCC bị khoá theo đơn', (await page.locator('#receipt-type[disabled], #receipt-type[aria-disabled=true]').count()) > 0 && (await page.locator('#receipt-supplier[disabled], #receipt-supplier[aria-disabled=true]').count()) > 0);
  await page.keyboard.press('Escape');

  // ── Nhận hàng qua API (6 rồi 4) để kiểm tiến độ trên giao diện ──
  const order = (await api('GET', `/inventory/purchase-orders/${orderId}`)).body;
  const lineId = order.lines[0].id;
  const receive = async (n) => {
    const r = await api('POST', '/inventory/receipts', { warehouseId: order.warehouseId, supplierId: order.supplierId, receiptType: 'PURCHASE', purchaseOrderId: orderId, lines: [{ drugId: drug.id, unitCode: 'HOP', quantity: n, unitCost: 2000, purchaseOrderLineId: lineId }] });
    if (r.status !== 200) return r;
    return api('POST', `/inventory/receipts/${r.body.id}/approve`, { version: r.body.version });
  };
  check('nhận đợt 1 (6) qua API → 200', (await receive(6)).status === 200);
  const over = await receive(5);
  check('nhận vượt số còn thiếu (5 > 4) bị chặn 422', over.status === 422 && over.error?.code === 'PURCHASE_ORDER_OVER_RECEIPT', `${over.status} ${over.error?.code ?? ''}`);
  await page.goto(WEB + `/inventory/purchase-orders/${orderId}`);
  await page.waitForSelector('text=Nhận một phần', { timeout: 10000 });
  const partial = await bodyText();
  check('chi tiết: Nhận một phần, đã nhận 6, còn thiếu 4, có phiếu nhập liên kết', /Nhận một phần/.test(partial) && /Phiếu nhập liên kết/.test(partial) && /Đợt 1/.test(partial));
  await shot('05-nhan-mot-phan');
  check('nhận đợt 2 (4) → Đã nhận đủ', (await receive(4)).status === 200);
  await page.reload();
  await page.waitForSelector('text=Đã nhận đủ', { timeout: 10000 });
  check('hết nút Nhận hàng khi đã nhận đủ', (await page.locator('button:has-text("Nhận hàng, lập Phiếu nhập kho")').count()) === 0);

  // ── Phiếu nhập kho: cột + bộ lọc "Từ đơn" ──
  await page.goto(WEB + '/inventory/receipts');
  await page.waitForSelector('#receipt-filter-from-order', { timeout: 10000 });
  await page.waitForSelector('[role=columnheader]:has-text("Từ đơn")', { timeout: 15000 });
  check('danh sách Phiếu nhập kho có cột "Từ đơn" và bộ lọc "Từ đơn"', (await page.locator('[role=columnheader]:has-text("Từ đơn")').count()) === 1 && (await page.locator('#receipt-filter-from-order').count()) === 1);
  await page.click('#receipt-filter-from-order');
  await page.locator('[role=option]:has-text("Có đơn đặt hàng")').first().click();
  await page.waitForTimeout(800);
  check('lọc "Có đơn đặt hàng": hiện số đơn DDH, không còn "Không có"', /DDH/.test(await bodyText()));
  await shot('06-phieu-nhap-tu-don-loc');

  // ── Bản in + Danh sách có đơn ──
  await page.goto(WEB + '/inventory/purchase-orders');
  await page.waitForSelector(`text=KIEMDDH NCC ${stamp}`, { timeout: 10000 });
  check('đơn vừa lập hiện ở danh sách, Đã nhận đủ', /Đã nhận đủ/.test(await bodyText()));
  check('hàng có nút Xem + In đơn', (await page.locator('button[aria-label="In đơn"], [aria-label="In đơn"]').count()) > 0);

  const setMin = async (n) => api('PATCH', `/drugs/${drug.id}`, { minStockAlert: n, version: (await api('GET', `/drugs/${drug.id}`)).body.version });
  // ── Mockup màn 4: tab "Hàng cần bổ sung" ở Yêu cầu cấp hàng ──
  await setMin(50);
  await page.goto(WEB + '/inventory/requests');
  await page.waitForSelector('[role=tab]:has-text("Hàng cần bổ sung")', { timeout: 15000 });
  await page.click('[role=tab]:has-text("Hàng cần bổ sung")');
  await page.waitForSelector('text=Mặt hàng dưới mức tối thiểu', { timeout: 15000 });
  const restockText = await bodyText();
  check('tab "Hàng cần bổ sung": 4 ô số liệu + bảng + 2 nút đường bổ sung', /Đang chờ cấp cho phòng ban/.test(restockText) && /Đang chờ hàng về/.test(restockText) && /Đã xin chi nhánh chính/.test(restockText) && (await page.locator('button:has-text("Xin chi nhánh chính")').count()) === 1 && (await page.locator('button:has-text("Đặt NCC")').count()) === 1);
  await shot('09-hang-can-bo-sung');
  await page.locator(`input[aria-label="Số cần bổ sung Găng tay đặt ${stamp}"]`).fill('33');
  await page.click('button:has-text("Đặt NCC")');
  await page.waitForURL('**/inventory/purchase-orders/new', { timeout: 10000 });
  await page.waitForSelector(`input[aria-label="Số đặt Găng tay đặt ${stamp}"]`, { timeout: 10000 });
  check('"Đặt NCC" mở form đơn điền sẵn mặt hàng + số cần bổ sung (33)', (await page.locator(`input[aria-label="Số đặt Găng tay đặt ${stamp}"]`).inputValue()) === '33');
  await setMin(0);

  // ── Mockup màn 9: cột "Nhận đợt này" + màn 9b: "Còn thiếu theo đơn", "đợt nhận" ──
  const order2 = (await api('POST', '/inventory/purchase-orders', { supplierId: supplier.id, warehouseId: wh.id, lines: [{ drugId: drug.id, unitCode: 'HOP', quantity: 20, expectedUnitCost: 2000 }] })).body;
  const approved2 = (await api('POST', `/inventory/purchase-orders/${order2.id}/approve`, { version: order2.version })).body;
  await api('POST', `/inventory/purchase-orders/${order2.id}/order`, { version: approved2.version });
  await page.goto(WEB + `/inventory/purchase-orders/${order2.id}`);
  await page.waitForSelector('text=Nhận đợt này', { timeout: 10000 });
  const recvInput = page.locator(`input[aria-label="Nhận đợt này Găng tay đặt ${stamp}"]`);
  check('chi tiết đơn có cột "Nhận đợt này", mặc định bằng số còn thiếu (20)', (await recvInput.inputValue()) === '20');
  await recvInput.fill('7');
  await shot('10-nhan-dot-nay');
  await page.click('button:has-text("Nhận hàng, lập Phiếu nhập kho")');
  await page.waitForURL(/\/inventory\/receipts\/new\?fromOrder=/, { timeout: 10000 });
  await page.waitForSelector('text=Còn thiếu theo đơn', { timeout: 10000 });
  check('Phiếu nhập điền sẵn số 7 đã nhập ở chi tiết đơn', (await page.locator('input[type=number]').first().inputValue()) === '7');
  const slip = await bodyText();
  check('Phiếu nhập có cột "Còn thiếu theo đơn" (20) và "(đợt nhận 1)"', /Còn thiếu theo đơn/i.test(slip) && /đợt nhận 1/.test(slip) && /\b20\b/.test(slip));
  await shot('11-phieu-nhap-con-thieu');

  // ── Mockup màn 7: dải 5 ô + ô lọc trạng thái ──
  await page.goto(WEB + '/inventory/purchase-orders');
  await page.waitForSelector('#order-filter-status', { timeout: 10000 });
  await page.waitForSelector('text=Từ chối / Huỷ', { timeout: 10000 });
  const listText = await bodyText();
  check('danh sách đơn: dải 5 ô (Chờ duyệt, Đã đặt NCC, Nhận một phần, Đã nhận đủ, Từ chối / Huỷ) + ô lọc "Trạng thái"', /Chờ duyệt/.test(listText) && /Từ chối \/ Huỷ/.test(listText) && (await page.locator('#order-filter-status').count()) === 1);
  await shot('12-danh-sach-dai-so');

  // ── Mockup màn 12: sổ công nợ NCC hiện "Nhập từ đơn ... (đợt N)" ──
  await page.goto(WEB + `/suppliers/${supplier.id}`);
  await page.waitForTimeout(2000);
  const ledgerTab = page.locator('[role=tab]:has-text("Sổ công nợ")');
  if (await ledgerTab.count()) await ledgerTab.first().click();
  await page.waitForTimeout(1500);
  check('sổ công nợ NCC hiện "Nhập từ đơn DDH… (đợt 1)"', /Nhập từ đơn DDH\w+ \(đợt 1\)/.test(await bodyText()));
  await shot('13-so-cong-no');

  // ── Trạng thái lỗi (#255) ──
  const LIST_URL = /\/inventory\/purchase-orders\?/;
  await page.route(LIST_URL, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
  await page.goto(WEB + '/inventory/purchase-orders');
  await page.waitForSelector('text=/không tải được|thử lại/i', { timeout: 25000 }).catch(() => {});
  const errText = await bodyText();
  check('lỗi 500 khi tải danh sách: báo tiếng Việt cụ thể, không lộ mã/lỗi thô', !FORBIDDEN.test(errText) && /không tải được|thử lại/i.test(errText), errText.slice(0, 120).replace(/\n/g, ' '));
  await shot('07-loi-tai-danh-sach');
  await page.unroute(LIST_URL);
  await page.goto(WEB + '/inventory/purchase-orders/00000000-0000-4000-8000-000000000000');
  await page.waitForTimeout(1500);
  const missing = await bodyText();
  check('mở đơn không có thật: màn thông báo có lối về danh sách, không lộ mã', !FORBIDDEN.test(missing) && /danh sách/i.test(missing), missing.slice(0, 100).replace(/\n/g, ' '));

  // ── Công tắc: chi nhánh chính vẫn thấy menu khi tắt "đặt hàng riêng" ──
  await api('PATCH', '/clinic-settings', { branchPurchasingEnabled: false });
  await page.goto(WEB + '/inventory/purchase-orders');
  await page.waitForSelector('button:has-text("Lập đơn đặt hàng")', { timeout: 10000 });
  check('tắt "đặt hàng NCC riêng": chi nhánh chính (hoặc công ty một chi nhánh) vẫn lập đơn được', true);
  await api('PATCH', '/clinic-settings', { branchPurchasingEnabled: true });

  // ── Bố cục màn laptop 1280px ──
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const url of ['/inventory/purchase-orders', `/inventory/purchase-orders/${orderId}`, '/inventory/purchase-orders/new']) {
    await page.goto(WEB + url);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`1280px không tràn ngang: ${url.replace(orderId, ':id')}`, !overflow);
  }
  await shot('08-1280-form');

  check('không có lỗi JS trên trang', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`\n${results.length - bad}/${results.length} đạt. Ảnh: ${OUT}`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('Kịch bản dừng giữa chừng:', e);
  if (page) await page.screenshot({ path: path.join(OUT, 'loi-dung-giua-chung.png') }).catch(() => {});
  process.exit(2);
});
