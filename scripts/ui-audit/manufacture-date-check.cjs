/* global require, process, console, window, document, fetch */
// KIỂM Ngày sản xuất của lô (docs/DECISIONS.md #297 GĐ2) trên Chrome thật qua IP LAN HTTP: cột "Ngày SX" ở dòng phiếu nhập (báo lỗi ngay tại ô,
// chặn lưu), Tồn theo lô, Cảnh báo hạn dùng, lỗi chặn khi nhập lại cùng số lô khác Ngày SX. Tạo MỘT vật tư thử mã KIEM297M-… ở công ty thử rồi ẩn.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/manufacture-date-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'manufacture-date-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity/;

const stamp = String(Date.now()).slice(-7);
const CODE = `KIEM297M-${stamp}`;
const LOT = `LOT${stamp}`;
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const display = (iso) => iso.split('-').reverse().join('/');

(async () => {
  const login = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: USER, password: PASS }) });
  const token = (await login.json()).data.accessToken;
  const api = async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json().catch(() => ({}))).data };
  };
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

  const wh = (await api('GET', '/warehouses')).body.items[0];
  const supplier = (await api('POST', '/suppliers', { name: `NCC kiểm ${stamp}` })).body;
  const drug = (
    await api('POST', '/drugs', {
      code: CODE, name: `Găng tay kiểm NSX ${stamp}`, itemType: 'SUPPLY', baseUnitCode: 'CAI', manufacturerCode: 'TEST_MANUFACTURER', defaultSellPrice: 1000,
      drugGroupCode: 'CONSUMABLE', registrationNumber: 'KIEM297', ingredients: [], units: [],
    })
  ).body;
  const mfg = addDays(today, -60);
  const expiry = addDays(today, 10); // còn 10 ngày → hiện ở Cảnh báo hạn dùng (ngưỡng mặc định 30)
  const newDraft = async (manufactureDate) =>
    (await api('POST', '/inventory/receipts', {
      warehouseId: wh.id, supplierId: supplier.id, receiptType: 'PURCHASE',
      lines: [{ drugId: drug.id, unitCode: 'CAI', quantity: 20, unitCost: 1000, batchNo: LOT, manufactureDate, expiryDate: expiry }],
    })).body;
  const first = await newDraft(mfg);
  check('dữ liệu thử: phiếu nháp có Ngày SX qua API', !!first && first.lines[0].manufactureDate === mfg);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ── Form phiếu nhập: cột Ngày SX ──
    await page.goto(`${WEB}/inventory/receipts/${first.id}`);
    await page.getByRole('columnheader', { name: 'Ngày SX' }).waitFor({ timeout: 20000 });
    const headers = await page.getByRole('columnheader').allInnerTexts();
    const iM = headers.findIndex((h) => /Ngày SX/i.test(h));
    const iE = headers.findIndex((h) => /Hạn dùng/i.test(h));
    check('cột "Ngày SX" nằm ngay trước "Hạn dùng"', iM >= 0 && iE === iM + 1, headers.join(' | '));
    const lineKey = first.lines[0].id;
    const mInput = page.locator(`#manufacture-${lineKey}`);
    await mInput.waitFor({ timeout: 10000 });
    check('ô Ngày SX hiện đúng ngày đã lưu (dd/mm/yyyy)', (await mInput.inputValue()) === display(mfg), await mInput.inputValue());
    await page.screenshot({ path: path.join(OUT, '01-form-phieu-nhap.png') });

    // Ngày SX sau hôm nay → báo ngay tại ô + chặn lưu
    await mInput.fill(display(addDays(today, 3)));
    await mInput.blur();
    const errCell = page.getByText('Không được sau hôm nay');
    await errCell.waitFor({ timeout: 5000 });
    check('Ngày SX sau hôm nay: báo "Không được sau hôm nay" ngay tại ô', (await errCell.count()) === 1);
    await page.screenshot({ path: path.join(OUT, '02-loi-sau-hom-nay.png') });
    await page.getByRole('button', { name: /Lưu nháp|Lưu & chuyển duyệt/ }).click();
    const formErr = page.getByText(/Ngày sản xuất không được sau hôm nay/);
    await formErr.waitFor({ timeout: 5000 });
    check('bấm Lưu bị chặn, thông báo tiếng Việt kèm tên dòng, không lộ mã lỗi', !FORBIDDEN.test(await formErr.innerText()), (await formErr.innerText()).slice(0, 120));
    check('chưa gửi gì lên máy chủ: phiếu vẫn giữ Ngày SX cũ', (await api('GET', `/inventory/receipts/${first.id}`)).body.lines[0].manufactureDate === mfg);

    // Hạn dùng sớm hơn Ngày SX → "Phải trước hạn dùng" (Ngày SX hợp lệ nhưng không trước hạn dùng)
    const eInput = page.locator(`#expiry-${lineKey}`);
    await mInput.fill(display(mfg));
    await mInput.blur();
    await eInput.fill(display(addDays(today, -100)));
    await eInput.blur();
    await page.getByText('Phải trước hạn dùng').waitFor({ timeout: 5000 });
    check('Hạn dùng sớm hơn Ngày SX: báo "Phải trước hạn dùng"', true);
    await eInput.fill(display(expiry));
    await eInput.blur();

    // Ngày SX hợp lệ mới → lưu được
    const newMfg = addDays(today, -90);
    await mInput.fill(display(newMfg));
    await mInput.blur();
    await page.getByRole('button', { name: /Lưu nháp|Lưu & chuyển duyệt/ }).click();
    await page.waitForTimeout(1500);
    check('Ngày SX hợp lệ: lưu được, máy chủ ghi đúng', (await api('GET', `/inventory/receipts/${first.id}`)).body.lines[0].manufactureDate === newMfg);

    // ── Duyệt, rồi xem Tồn theo lô + Cảnh báo hạn dùng ──
    const approved = await api('POST', `/inventory/receipts/${first.id}/approve`, { version: (await api('GET', `/inventory/receipts/${first.id}`)).body.version });
    check('Duyệt phiếu thành công', approved.status === 200);

    await page.goto(WEB + '/admin/catalog-pharmacy');
    await page.locator('input[placeholder^="Tìm theo tên"]').fill(CODE);
    const row = page.locator('tbody tr').filter({ hasText: CODE }).first();
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await page.getByRole('tab', { name: /Tồn kho theo lô/ }).or(page.getByRole('button', { name: /Tồn kho theo lô/ })).first().click();
    const batchRow = page.locator('tbody tr').filter({ hasText: LOT }).first();
    await batchRow.waitFor({ timeout: 15000 });
    const batchText = await batchRow.innerText();
    check('Tồn theo lô: có cột NSX, dòng lô hiện đúng ngày SX và hạn dùng', (await page.locator('thead th').allInnerTexts()).some((h) => /NSX/i.test(h)) && batchText.includes(display(newMfg)) && batchText.includes(display(expiry)), batchText.replace(/\s+/g, ' '));
    await page.screenshot({ path: path.join(OUT, '03-ton-theo-lo.png') });

    await page.goto(WEB + '/inventory/balances');
    await page.getByRole('button', { name: 'Cảnh báo hạn dùng' }).or(page.getByRole('tab', { name: 'Cảnh báo hạn dùng' })).first().click();
    const warnRow = page.getByRole('row').filter({ hasText: LOT }).first();
    await warnRow.waitFor({ timeout: 15000 });
    const warnHeaders = await page.getByRole('table', { name: 'Cảnh báo hạn dùng' }).getByRole('columnheader').allInnerTexts();
    const warnText = (await warnRow.innerText()).replace(/\s+/g, ' ');
    check('Cảnh báo hạn dùng: có cột NSX trước Hạn dùng, dòng hiện đúng ngày SX', warnHeaders.findIndex((h) => /NSX/i.test(h)) >= 0 && warnHeaders.findIndex((h) => /NSX/i.test(h)) + 1 === warnHeaders.findIndex((h) => /Hạn dùng/i.test(h)) && warnText.includes(display(newMfg).split('/').join('-')), warnHeaders.join(' | ') + ' // ' + warnText);
    await page.screenshot({ path: path.join(OUT, '04-canh-bao-han-dung.png') });

    // ── Nhập lại cùng số lô nhưng khác Ngày SX → Duyệt bị chặn, báo rõ ──
    const other = await newDraft(addDays(today, -30));
    check('lập được Nháp khác Ngày SX (chỉ chặn khi Duyệt)', !!other && other.status === 'DRAFT');
    await page.goto(`${WEB}/inventory/receipts/${other.id}`);
    await page.getByRole('button', { name: /Lưu & Duyệt ngay/ }).click();
    const blocked = page.getByText(/đã có Ngày sản xuất/);
    await blocked.waitFor({ timeout: 10000 });
    const blockedText = await blocked.first().innerText();
    check('Duyệt bị chặn: nêu số lô, cả hai ngày, không lộ mã lỗi', blockedText.includes(LOT) && blockedText.includes(display(newMfg)) && blockedText.includes(display(addDays(today, -30))) && !FORBIDDEN.test(blockedText), blockedText.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '05-duyet-bi-chan.png') });
    check('phiếu vẫn là Nháp, tồn không đổi (20)', (await api('GET', `/inventory/receipts/${other.id}`)).body.status === 'DRAFT' && (await api('GET', `/inventory/drugs/${drug.id}/balances`)).body.totalQuantityOnHand === 20);

    check('không có lỗi JS trong trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, String(e && e.message).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => {});
  } finally {
    await browser.close();
    // Dọn: ẩn vật tư thử (mã bắt đầu CHÍNH XÁC KIEM297M-).
    const list = (await api('GET', `/drugs?q=KIEM297M&includeInactive=true`)).body.items.filter((d) => d.code.startsWith('KIEM297M-') && d.isActive);
    console.log('Ẩn vật tư thử:', list.map((d) => d.code).join(', ') || '(không có)');
    for (const d of list) await api('PATCH', `/drugs/${d.id}`, { isActive: false, version: d.version });
  }
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} đạt. Ảnh: ${OUT}`);
  process.exit(pass === results.length ? 0 : 1);
})();
