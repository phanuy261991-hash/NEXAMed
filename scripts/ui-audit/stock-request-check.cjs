/* global require, process, console, window, document, fetch, URL */
// KIỂM "Yêu cầu cấp hàng" (docs/DECISIONS.md #298 GĐ1) trên Chrome thật qua IP LAN HTTP: tạo phiếu (nháp → gửi), danh sách (tab, dải đếm, lọc), tiếp nhận, xử lý từng dòng
// (số cấp, "Chờ hàng về", "Từ chối") và "Chuyển thành phiếu điều chuyển", bên xin theo dõi, thêm/rút dòng, nhắn bổ sung, bản in, Excel + các trạng thái lỗi (#255).
// Dữ liệu thử có tiền tố KIEM298 ở công ty thử; kho phụ tạo cho kịch bản (không xoá — không có đường xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/stock-request-check.cjs
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
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'stock-request-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|STOCK_REQUEST_/;
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

  // ── Dữ liệu thử: kho chính, kho phụ, 3 mặt hàng ──
  const mainWh = (await api('GET', '/warehouses')).body.items.find((w) => w.isDefault) ?? (await api('GET', '/warehouses')).body.items[0];
  const subWh = (await api('POST', '/warehouses', { name: `KIEM298 Kho thủ thuật ${stamp}` })).body;
  check('dữ liệu thử: kho phụ cùng chi nhánh', !!subWh?.id && subWh.branchId === mainWh.branchId);
  let seq = 0;
  const mkDrug = async (name, minStock) =>
    (
      await api('POST', '/drugs', {
        code: `KIEM298-${stamp}-${++seq}`, name: `${name} ${stamp}`, itemType: 'SUPPLY', baseUnitCode: 'HOP', manufacturerCode: 'TEST_MANUFACTURER', defaultSellPrice: 1000,
        drugGroupCode: 'CONSUMABLE', registrationNumber: 'KIEM298', isBatchManaged: false, ingredients: [], units: [], minStockAlert: minStock,
      })
    ).body;
  const stockIn = async (whId, drug, qty) => {
    const r = (await api('POST', '/inventory/receipts', { warehouseId: whId, receiptType: 'OPENING_BALANCE', lines: [{ drugId: drug.id, unitCode: 'HOP', quantity: qty, unitCost: 1000 }] })).body;
    await api('POST', `/inventory/receipts/${r.id}/approve`, { version: r.version });
  };
  const gloves = await mkDrug('Găng tay kiểm', 20);
  const syringe = await mkDrug('Bơm tiêm kiểm', 12);
  const cotton = await mkDrug('Bông gạc kiểm', 8);
  await stockIn(mainWh.id, gloves, 12);
  await stockIn(mainWh.id, syringe, 40);
  await stockIn(subWh.id, gloves, 4);
  check('dữ liệu thử: 3 mặt hàng + tồn', !!gloves?.id && !!syringe?.id && !!cotton?.id);

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
  await page.goto(WEB + '/inventory/requests');
  await page.waitForSelector('button:has-text("Tạo yêu cầu")', { timeout: 15000 });
  check('menu có mục "Yêu cầu cấp hàng"', (await page.locator('nav a:has-text("Yêu cầu cấp hàng")').count()) > 0);
  check('có tab "Của tôi" và "Cần duyệt"', (await page.locator('[role=tab]:has-text("Của tôi")').count()) === 1 && (await page.locator('[role=tab]:has-text("Cần duyệt")').count()) === 1);
  check('có nút Xuất Excel + In danh sách + Tạo yêu cầu', (await page.locator('button:has-text("Xuất Excel")').count()) === 1 && (await page.locator('button:has-text("In danh sách")').count()) === 1 && (await page.locator('button:has-text("Tạo yêu cầu")').count()) === 1);
  await shot('01-danh-sach');

  // ── Tạo phiếu ──
  await page.click('button:has-text("Tạo yêu cầu")');
  await page.waitForURL('**/inventory/requests/new');
  await page.waitForSelector('#request-warehouse');
  await page.click('#request-warehouse');
  await page.locator(`[role=option]:has-text("KIEM298 Kho thủ thuật ${stamp}")`).first().click();
  const supplierText = await page.locator('p:has-text("Kho cấp (tự động theo cấp)") + p').innerText();
  check('kho cấp tự điền theo cấp (kho chính), không cho chọn', supplierText.trim().length > 0 && supplierText.trim() !== '—', supplierText.trim());
  // Thêm mặt hàng qua tìm kiếm
  await page.fill('#request-drug-search', `Bơm tiêm kiểm ${stamp}`);
  await page.waitForSelector(`button:has-text("Bơm tiêm kiểm ${stamp}")`);
  await page.locator(`button:has-text("Bơm tiêm kiểm ${stamp}")`).first().click();
  await page.locator(`input[aria-label="Số xin Bơm tiêm kiểm ${stamp}"]`).fill('10', { timeout: 5000 });
  // Thêm các mặt hàng dưới mức tối thiểu (Găng tay: tồn 4 < 20; Bông gạc: tồn 0 < 8)
  const lowBtn = page.locator('button:has-text("Thêm các mặt hàng dưới mức tồn tối thiểu")');
  await lowBtn.waitFor();
  await page.waitForFunction(() => /\(\d+\)/.test(document.querySelector('button.border-dashed')?.textContent ?? '') && !/\(0\)/.test(document.querySelector('button.border-dashed')?.textContent ?? ''), null, { timeout: 15000 });
  await lowBtn.click();
  // Công ty thử còn nhiều mặt hàng khác có mức tối thiểu: giữ đúng 3 mặt hàng của kịch bản.
  for (;;) {
    const extra = page.locator(`[role=row]:not(:has-text("${stamp}")) button[aria-label^="Xoá dòng"]`).first();
    if (!(await extra.count())) break;
    await extra.click();
  }
  const rowsAfterLow = await page.locator('[role=table] [role=row]').count();
  check('"Thêm các mặt hàng dưới mức tồn tối thiểu" điền sẵn số xin gợi ý', rowsAfterLow >= 3, `${rowsAfterLow - 1} dòng`);
  const glovesQty = await page.locator(`input[aria-label="Số xin Găng tay kiểm ${stamp}"]`).inputValue();
  check('số xin gợi ý của Găng tay = mức tối thiểu − tồn (20 − 4 = 16)', glovesQty === '16', glovesQty);
  await shot('02-tao-phieu');

  // Lỗi thao tác ghi: mất mạng khi gửi → hộp thông báo, dữ liệu nhập còn nguyên
  await page.route('**/api/v1/inventory/requests', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
  await page.click('button:has-text("Gửi yêu cầu")');
  await page.waitForTimeout(1500);
  const afterFail = await bodyText();
  check('gửi khi mất mạng: có thông báo tiếng Việt, không lộ mã/lỗi thô', !FORBIDDEN.test(afterFail) && /mạng|kết nối|thử lại/i.test(afterFail), afterFail.slice(0, 120).replace(/\n/g, ' '));
  const dialogBtn = page.locator('[role=dialog] button').first();
  if (await dialogBtn.count()) await dialogBtn.click().catch(() => {});
  check('dữ liệu đang nhập còn nguyên sau lỗi mạng', (await page.locator(`input[aria-label="Số xin Bơm tiêm kiểm ${stamp}"]`).inputValue()) === '10');
  await page.unroute('**/api/v1/inventory/requests');

  await page.click('button:has-text("Gửi yêu cầu")');
  await page.waitForURL(/\/inventory\/requests\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const requestUrl = page.url();
  await page.waitForSelector('text=Phiếu điều chuyển liên kết', { timeout: 2000 }).catch(() => {});
  const detailText = await bodyText();
  check('gửi xong: phiếu ở trạng thái "Đã gửi" mã YCCH', /Đã gửi/.test(detailText) && /YCCH/.test(detailText));
  await shot('03-da-gui');

  // ── Bên xin (admin vừa là bên xin vừa là kho cấp): hành động theo trạng thái ──
  await page.waitForSelector('main button:has-text("Tiếp nhận")');
  check('đã gửi: có Sửa phiếu + Huỷ phiếu + Tiếp nhận + Từ chối cả phiếu', (await page.locator('button:has-text("Sửa phiếu")').count()) === 1 && (await page.locator('button:has-text("Huỷ phiếu")').count()) === 1 && (await page.locator('main button:has-text("Tiếp nhận")').count()) === 1 && (await page.locator('button:has-text("Từ chối cả phiếu")').count()) === 1);

  // ── Danh sách có phiếu mới; tab Cần duyệt; dải đếm ──
  await page.goto(WEB + '/inventory/requests');
  await page.waitForSelector('[role=row]:has-text("YCCH")');
  check('danh sách hiện phiếu vừa gửi, dải đếm trạng thái', (await page.locator('button[aria-pressed]:has-text("Đã gửi")').count()) === 1);
  await page.click('[role=tab]:has-text("Cần duyệt")');
  await page.waitForSelector('[role=row]:has-text("YCCH")');
  check('tab "Cần duyệt" thấy phiếu xin kho chính', (await page.locator('[role=row]:has-text("YCCH")').count()) >= 1);
  await shot('04-can-duyet');

  // ── Tiếp nhận + xử lý từng dòng ──
  await page.goto(requestUrl);
  await page.click('main button:has-text("Tiếp nhận")');
  await page.waitForSelector('text=Chuyển thành phiếu điều chuyển');
  check('tiếp nhận xong: hiện khối xử lý với ô "Số cấp"', (await page.locator('input[aria-label^="Số cấp"]').count()) === 3);
  // Găng tay: kho chính có 12, xin 16 → cấp 12, phần thiếu 4 → Chờ hàng về
  const glovesRowQty = page.locator(`input[aria-label="Số cấp Găng tay kiểm ${stamp}"]`);
  check('số cấp mặc định = tồn kho cấp khi tồn < số xin', (await glovesRowQty.inputValue()) === '12');
  await page.locator(`[role=row]:has-text("Găng tay kiểm ${stamp}") button:has-text("Chờ hàng về")`).click();
  await page.fill('#remainder-reason', 'Kho chính đang đặt thêm');
  await page.press('#remainder-reason', 'Control+Enter').catch(() => {});
  await page.click('button:has-text("Lưu chờ hàng về")');
  // Bông gạc: kho chính 0 → cấp 0, Từ chối
  await page.locator(`[role=row]:has-text("Bông gạc kiểm ${stamp}") button:has-text("Từ chối")`).click();
  await page.fill('#remainder-reason', 'NCC ngừng sản xuất');
  await page.click('button:has-text("Lưu từ chối")');
  await shot('05-xu-ly');
  // Thiếu quyết định → báo lỗi tiếng Việt, không lộ mã
  await page.locator(`[role=row]:has-text("Găng tay kiểm ${stamp}") button:has-text("Sửa")`).count();
  await page.click('button:has-text("Chuyển thành phiếu điều chuyển")');
  await page.waitForSelector('[role=dialog]:has-text("Chuyển thành phiếu điều chuyển")');
  await shot('06-xac-nhan');
  await page.locator('[role=dialog] button:has-text("Xác nhận")').click();
  await page.waitForURL(/\/inventory\/transfers\/[0-9a-f-]{36}/, { timeout: 15000 });
  await page.waitForSelector('h2:has-text("PDC")', { timeout: 15000 });
  const transferPage = await bodyText();
  check('chuyển thành phiếu điều chuyển: mở thẳng phiếu nháp đã điền sẵn mặt hàng', /Duyệt/.test(transferPage) && transferPage.includes(`Bơm tiêm kiểm ${stamp}`) && transferPage.includes(`Găng tay kiểm ${stamp}`));
  await shot('07-phieu-dieu-chuyen-nhap');

  // ── Quay lại phiếu yêu cầu: trạng thái dòng, diễn biến, phiếu liên kết ──
  await page.goto(requestUrl);
  await page.waitForSelector('text=Diễn biến');
  const after = await bodyText();
  check('phiếu "Đang xử lý": dòng chờ hàng về + từ chối kèm lý do + phiếu điều chuyển liên kết',
    /Đang xử lý/.test(after) && /Chờ hàng về/.test(after) && /Kho chính đang đặt thêm/.test(after) && /NCC ngừng sản xuất/.test(after) && /Phiếu điều chuyển liên kết/.test(after));
  check('diễn biến ghi cả bước gửi/tiếp nhận/cấp hàng', /Đã gửi/.test(after) && /Đã tiếp nhận/.test(after) && /Cấp đợt 1: tạo PDC/.test(after) && /Chờ hàng về: /.test(after) && /Cấp tiếp khi hàng về/.test(after));
  await shot('08-dang-xu-ly');

  // ── In phiếu + Excel ──
  const printBtn = page.locator('button:has-text("In phiếu")').first();
  check('có nút In phiếu trên chi tiết', (await printBtn.count()) === 1);
  await page.goto(WEB + '/inventory/requests');
  await page.waitForSelector('[role=row]:has-text("YCCH")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('button:has-text("Xuất Excel")')]);
  check('Xuất Excel tải về file .xlsx', /\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());

  // ── Lỗi tải: 500 ở danh sách → banner có Thử lại, không lộ mã ──
  await page.route('**/api/v1/inventory/requests?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
  await page.reload();
  await page.waitForSelector('text=Thử lại', { timeout: 20000 }).catch(() => {});
  const errText = await bodyText();
  check('danh sách lỗi 500: thông báo tiếng Việt + Thử lại, không lộ mã', !FORBIDDEN.test(errText) && /Thử lại/.test(errText), errText.slice(0, 100).replace(/\n/g, ' '));
  await page.unroute('**/api/v1/inventory/requests?*');
  await shot('09-loi-tai-danh-sach');

  // ── Phiếu không tồn tại → màn thông báo có lối về ──
  await page.goto(WEB + '/inventory/requests/00000000-0000-4000-8000-000000000000');
  await page.waitForTimeout(1500);
  const missing = await bodyText();
  check('mở phiếu không có thật: màn thông báo có lối về danh sách, không lộ mã', !FORBIDDEN.test(missing) && /danh sách/i.test(missing), missing.slice(0, 100).replace(/\n/g, ' '));

  // ── Công tắc tắt: trang báo rõ ──
  await api('PATCH', '/clinic-settings', { stockRequestEnabled: false });
  await page.goto(WEB + '/inventory/requests');
  await page.waitForTimeout(1500);
  check('công tắc tắt: trang báo "đang tắt" kèm lối đi, không lỗi thô', /đang tắt/.test(await bodyText()) && !FORBIDDEN.test(await bodyText()));
  await api('PATCH', '/clinic-settings', { stockRequestEnabled: true });

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
