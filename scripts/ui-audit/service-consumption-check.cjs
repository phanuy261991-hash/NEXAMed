/* global require, process, console, window, document, fetch */
// KIỂM "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4) trên Chrome thật qua IP LAN HTTP: định mức trong form dịch vụ (màn 8), ghi vật tư đã dùng ở màn kết quả
// và tab "Vật tư đã dùng" (màn 7), báo cáo (màn 9), hộp "Khách không làm dịch vụ" (màn 10) + các trạng thái lỗi. Tạo dữ liệu thử có tiền tố KIEM297 ở công ty thử rồi ẩn.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/service-consumption-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'service-consumption-check');
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
  const apiWith = (bearer) => async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };
  const api = apiWith(token);
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

  // ── Dữ liệu thử ──
  const wh = (await api('GET', '/warehouses')).body.items[0];
  const mkSupply = async (name, cost) => {
    const d = (
      await api('POST', '/drugs', {
        code: `KIEM297C-${stamp}-${name.length}`, name: `${name} ${stamp}`, itemType: 'SUPPLY', baseUnitCode: 'CAI', manufacturerCode: 'TEST_MANUFACTURER', defaultSellPrice: 1000,
        drugGroupCode: 'CONSUMABLE', registrationNumber: 'KIEM297', isBatchManaged: true, ingredients: [], units: [],
      })
    ).body;
    const r = (await api('POST', '/inventory/receipts', { warehouseId: wh.id, receiptType: 'OPENING_BALANCE', lines: [{ drugId: d.id, unitCode: 'CAI', quantity: 100, unitCost: cost, batchNo: `K297${stamp}`, expiryDate: '2099-01-01' }] })).body;
    await api('POST', `/inventory/receipts/${r.id}/approve`, { version: r.version });
    return d;
  };
  const gel = await mkSupply('Gel siêu âm kiểm', 300);
  const tissue = await mkSupply('Giấy lau kiểm', 50);
  check('dữ liệu thử: 2 vật tư có tồn', !!gel?.id && !!tissue?.id);
  // Kho phụ của chi nhánh (không gắn Khoa/Phòng): có 100 Giấy lau; kho chính cũng có 100.
  const subWh = (await api('POST', '/warehouses', { name: `KIEM297 Kho phụ ${stamp}` })).body;
  const subReceipt = (await api('POST', '/inventory/receipts', { warehouseId: subWh.id, receiptType: 'OPENING_BALANCE', lines: [{ drugId: tissue.id, unitCode: 'CAI', quantity: 100, unitCost: 50, batchNo: `K297S${stamp}`, expiryDate: '2099-01-01' }] })).body;
  await api('POST', `/inventory/receipts/${subReceipt.id}/approve`, { version: subReceipt.version });
  check('dữ liệu thử: kho phụ thuộc chi nhánh đang làm việc', !!subWh?.id && subWh.branchId === wh.branchId, `${subWh?.branchId} / ${wh.branchId}`);

  const svc = (await api('POST', '/technical-services', { name: `KIEM297 Siêu âm ${stamp}`, serviceKind: 'IMAGING', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 420000, effectiveFrom: '2020-01-01' }] }));
  check('dữ liệu thử: dịch vụ kỹ thuật', svc.status === 200, JSON.stringify(svc.error ?? ''));
  const svcId = svc.body.id;
  // Dịch vụ B: chỉ định cùng lượt nhưng KHÔNG gọi vào phòng (còn ORDERED) → dùng thử hộp "Khách không làm dịch vụ" (màn 10).
  const svc2 = await api('POST', '/technical-services', { name: `KIEM297 Siêu âm phụ ${stamp}`, serviceKind: 'IMAGING', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 300000, effectiveFrom: '2020-01-01' }] });
  const svc2Id = svc2.body.id;

  const settings = (await api('GET', '/clinic-settings')).body;
  const hadDeferred = settings?.deferredPaymentEnabled === true;
  if (!hadDeferred) await api('PATCH', '/clinic-settings', { deferredPaymentEnabled: true });
  // Tạm tắt "ngày trước phải đóng ca" để bắt đầu khám được (trả lại như cũ ở cuối).
  const hadShiftRule = settings?.requirePreviousShiftClosed === true;
  if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: false });
  // Bác sĩ thử: chỉ bác sĩ phụ trách mới bắt đầu khám và chỉ định được → tạo tài khoản kiem297 rồi khoá ở cuối.
  const roles = (await api('GET', '/roles')).body?.items ?? [];
  const doctorRole = roles.find((r) => r.name === 'doctor');
  const docUser = `kiem297.bs.${stamp}`;
  const docPass = 'Kiem@297Doc!';
  const docCreated = await api('POST', '/users', { username: docUser, password: docPass, fullName: `KIEM297 Bác sĩ ${stamp}`, displayName: `BS. KIEM297 ${stamp}`, roleIds: [doctorRole.id] });
  check('dữ liệu thử: bác sĩ thử', docCreated.status === 200, JSON.stringify(docCreated.error ?? ''));
  const doctor = docCreated.body;
  const docLogin = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: docUser, password: docPass }) });
  const docApi = apiWith((await docLogin.json()).data.accessToken);
  // Mỗi lượt khám: bệnh nhân + tiếp nhận + bắt đầu khám + chỉ định MỘT dịch vụ cận lâm sàng.
  const newEncounter = async (label, technicalServiceId) => {
    const patient = (await api('POST', '/patients', { fullName: `KIEM297 ${label} ${stamp}`, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
    const checkIn = await api('POST', '/reception/direct', {
      patientId: patient.id, doctorId: doctor.id, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150000, quantity: 1 }],
      receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString(),
    });
    const id = checkIn.body?.id;
    const started = await docApi('POST', `/encounters/${id}/start`, { version: 1 });
    const ordered = await docApi('PUT', `/encounters/${id}/clinical-orders`, { items: [{ performance: 'IN_HOUSE', technicalServiceId, quantity: 1 }] });
    check(`dữ liệu thử: lượt khám ${label} (tiếp nhận, bắt đầu khám, chỉ định)`, checkIn.status === 200 && started.status === 200 && ordered.status === 200, JSON.stringify(checkIn.error ?? started.error ?? ordered.error ?? ''));
    return { encounterId: id, itemId: ordered.body?.order?.items?.[0]?.id, patientName: `KIEM297 ${label} ${stamp}` };
  };

  // Lượt 1 — dịch vụ A: thu tiền (để gọi vào phòng được) rồi gọi vào phòng; ghi tiêu hao ở giao diện (màn 7A).
  const encA = await newEncounter('Bệnh nhân A', svcId);
  const encounterId = encA.encounterId;
  const orderItemId = encA.itemId;
  const invA = (await api('GET', `/billing/invoices/${encounterId}`)).body;
  const paid = await api('POST', `/billing/invoices/${encounterId}/pay`, { method: 'CASH', version: invA.version });
  check('dữ liệu thử: thu tiền phiếu của lượt 1', paid.status === 200, JSON.stringify(paid.error ?? ''));
  const called = await api('POST', '/paraclinical/imaging/start', { itemIds: [orderItemId] });
  check('dữ liệu thử: gọi dịch vụ A vào phòng', called.status === 200, JSON.stringify(called.error ?? ''));

  // Lượt 2 — dịch vụ B còn chờ làm, phiếu chưa thu: có định mức + đã ghi tiêu hao 10 Gel → thử "Khách không làm dịch vụ" (màn 10).
  const encB = await newEncounter('Bệnh nhân B', svc2Id);
  const encounter2Id = encB.encounterId;
  const orderItem2Id = encB.itemId;
  await api('PUT', `/service-consumption/norms?kind=TECHNICAL_SERVICE&ref=${svc2Id}`, { lines: [{ drugId: gel.id, quantity: 10 }] });
  const recB = await api('POST', '/service-consumption/records', { encounterId: encounter2Id, target: { kind: 'CLINICAL_ORDER_ITEM', id: orderItem2Id }, lines: [{ drugId: gel.id, quantity: 10 }] });
  check('dữ liệu thử: ghi tiêu hao cho dịch vụ B (còn chờ làm)', recB.status === 200, JSON.stringify(recB.error ?? ''));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const bodyText = () => page.evaluate(() => document.body.innerText);

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ── Màn 8: định mức trong form Dịch vụ kỹ thuật ──
    await page.goto(`${WEB}/admin/catalog-paraclinical`);
    await page.getByRole('searchbox').or(page.getByPlaceholder(/tìm/i)).first().fill(`KIEM297 Siêu âm ${stamp}`);
    await page.waitForTimeout(800);
    await page.getByText(`KIEM297 Siêu âm ${stamp}`).first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /^Sửa/ }).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    await page.getByText('Vật tư tiêu hao (định mức)').waitFor({ timeout: 15000 });
    check('màn 8: form dịch vụ kỹ thuật có khối "Vật tư tiêu hao (định mức)"', true);
    const norm = page.locator('#ts-norm-search');
    await norm.fill(`Gel siêu âm kiểm ${stamp}`);
    await page.getByRole('option').filter({ hasText: `Gel siêu âm kiểm ${stamp}` }).first().click();
    await norm.fill(`Giấy lau kiểm ${stamp}`);
    await page.getByRole('option').filter({ hasText: `Giấy lau kiểm ${stamp}` }).first().click();
    const gelQty = page.getByLabel(`Số lượng Gel siêu âm kiểm ${stamp}`);
    await gelQty.fill('30');
    await page.getByLabel(`Số lượng Giấy lau kiểm ${stamp}`).fill('2');
    // Enter trong ô tìm vật tư không được lưu form (hộp thoại vẫn mở)
    // Từ khoá không có kết quả: Enter chỉ được chặn gửi form, không thêm dòng nào.
    await norm.fill('zzzz-khong-co-mat-hang-nay');
    await norm.press('Enter');
    check('màn 8: Enter ở ô tìm vật tư KHÔNG gửi form (hộp thoại còn mở)', (await page.getByRole('dialog').count()) > 0);
    await shot('01-dinh-muc-form.png');
    await page.getByRole('button', { name: 'Lưu dịch vụ' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 });
    const normSaved = await api('GET', `/service-consumption/norms?kind=TECHNICAL_SERVICE&ref=${svcId}`);
    check('màn 8: lưu form → định mức được lưu (2 dòng, 30 và 2)', normSaved.body?.lines?.length === 2 && normSaved.body.lines.some((l) => l.quantity === 30), JSON.stringify(normSaved.body?.lines?.map((l) => l.quantity)));

    // ── Màn 7A: ghi vật tư ở màn nhập kết quả ──
    await page.goto(`${WEB}/paraclinical/imaging/items/${orderItemId}`);
    await page.getByText('Vật tư và thuốc đã dùng').first().waitFor({ timeout: 20000 });
    const notice = await bodyText();
    check('màn 7A: có nhắc "có định mức nhưng chưa ghi" (không chặn duyệt)', /có định mức vật tư nhưng chưa ghi/.test(notice));
    const filledGel = await page.getByLabel(`Số lượng Gel siêu âm kiểm ${stamp}`).inputValue();
    check('màn 7A: bảng điền sẵn theo định mức (Gel = 30)', filledGel === '30', filledGel);
    check('màn 7A: cột Lô ghi "Tự chọn theo hạn dùng"', /Tự chọn theo hạn dùng/.test(notice));
    await shot('02-ghi-tieu-hao-man-ket-qua.png');
    await page.getByLabel(`Số lượng Gel siêu âm kiểm ${stamp}`).fill('20');
    await page.getByLabel(`Số lượng Gel siêu âm kiểm ${stamp}`).press('Enter');
    check('màn 7A: Enter ở ô số lượng KHÔNG duyệt kết quả (vẫn ở màn nhập)', /\/paraclinical\/imaging\/items\//.test(page.url()));
    await page.getByRole('button', { name: 'Lưu vật tư đã dùng' }).click();
    await page.getByText(/Ghi bởi/).waitFor({ timeout: 15000 });
    const after = await bodyText();
    check('màn 7A: sau khi lưu → chỉ đọc kèm "Ghi bởi", cột Giá vốn + Thành tiền + dòng Tổng chi phí vốn (quản lý)', /Ghi bởi/.test(after) && /Giá vốn/i.test(after) && /Thành tiền/i.test(after) && /Tổng chi phí vốn/i.test(after));
    // 20 × 300 + 2 × 50 = 6.100
    check('màn 7A: tổng chi phí vốn = 6.100', /6\.100/.test(after));
    check('màn 7A: có nút "Đảo phiếu" (quản lý)', (await page.getByRole('button', { name: /Đảo phiếu/ }).count()) > 0);
    await shot('03-da-ghi-tieu-hao.png');
    check('màn 7A: nhắc "chưa ghi" biến mất sau khi ghi', !/có định mức vật tư nhưng chưa ghi/.test(after));

    // ── Màn 7B: tab "Vật tư đã dùng" ở màn khám (dịch vụ khám) + trạng thái lỗi khi lưu ──
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await page.getByRole('button', { name: /Vật tư đã dùng/ }).click();
    await page.getByRole('group', { name: 'Chọn dịch vụ' }).waitFor({ timeout: 20000 });
    check('màn 7B: tab có ô chọn dịch vụ khám (Khám thường)', /Khám thường/.test(await bodyText()));
    const tabSearch = page.getByLabel('Tìm vật tư hoặc thuốc để thêm');
    await tabSearch.fill(`Giấy lau kiểm ${stamp}`);
    await page.getByRole('option').filter({ hasText: `Giấy lau kiểm ${stamp}` }).first().click();
    await page.getByLabel(`Số lượng Giấy lau kiểm ${stamp}`).fill('3');
    // Ô "Kho trừ": mặc định kho chính; chọn kho phụ.
    const khoBox = page.getByLabel('Kho trừ');
    await khoBox.waitFor({ timeout: 10000 });
    check('màn 7B: ô "Kho trừ" mặc định là kho chính', /kho chính/i.test(await khoBox.inputValue()), await khoBox.inputValue());
    await khoBox.click();
    await page.getByRole('option', { name: new RegExp(`KIEM297 Kho phụ ${stamp}`) }).click();
    check('màn 7B: chọn được kho phụ; cột Lô ghi "trong <kho phụ>"', /KIEM297 Kho phụ/.test(await khoBox.inputValue()) && new RegExp(`trong KIEM297 Kho phụ ${stamp}`).test(await bodyText()));
    await shot('07-tab-vat-tu-da-dung.png');
    // Lỗi máy chủ khi lưu: hộp báo lỗi tiếng Việt, KHÔNG lộ mã/lỗi thô, dữ liệu đang nhập còn nguyên.
    await page.route('**/api/v1/service-consumption/records', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' } }) }));
    await page.getByRole('button', { name: 'Lưu vật tư đã dùng' }).click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    const failText = await page.getByRole('dialog').innerText();
    check('màn 7B: lưu gặp 503 → hộp báo lỗi tiếng Việt, không lộ mã/lỗi thô', !FORBIDDEN.test(failText) && /\S/.test(failText), failText.slice(0, 160).replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(OUT, '08-loi-503.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('màn 7B: sau lỗi, số lượng đang nhập (3) còn nguyên', (await page.getByLabel(`Số lượng Giấy lau kiểm ${stamp}`).inputValue()) === '3');
    await page.unroute('**/api/v1/service-consumption/records');
    await page.getByRole('button', { name: 'Lưu vật tư đã dùng' }).click();
    await page.getByText(/Ghi bởi/).waitFor({ timeout: 15000 });
    const saved7b = await bodyText();
    check('màn 7B: lưu lại thành công → chỉ đọc, chi phí 150 (3 × 50), có "Đảo phiếu"', /Ghi bởi/.test(saved7b) && /150/.test(saved7b) && (await page.getByRole('button', { name: /Đảo phiếu/ }).count()) > 0);
    check('màn 7B: sau khi lưu hiện tên kho đã trừ', new RegExp(`KIEM297 Kho phụ ${stamp}`).test(saved7b));
    const bal = async (khoId) => ((await api('GET', `/inventory/balances?warehouseId=${khoId}`)).body.items ?? []).find((r) => r.drugId === tissue.id)?.quantityOnHand;
    check('màn 7B: tồn Giấy lau: kho phụ 97 (100 − 3), kho chính 98 (100 − 2 của dịch vụ A) — không lẫn nhau', (await bal(subWh.id)) === 97 && (await bal(wh.id)) === 98, `${await bal(subWh.id)} / ${await bal(wh.id)}`);
    await shot('09-tab-vat-tu-da-ghi.png');

    // ── Màn 9: báo cáo ──
    await page.goto(`${WEB}/reports/service-consumption`);
    await page.getByRole('heading', { name: 'Chi phí vật tư theo dịch vụ' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Số liệu chi phí vật tư theo dịch vụ').waitFor({ timeout: 20000 });
    const rep = await bodyText();
    check('màn 9: có 3 ô tổng, 2 tab, bảng theo dịch vụ có dịch vụ thử', /Số lượt dịch vụ/.test(rep) && /Chi phí trung bình mỗi lượt/.test(rep) && /Theo dịch vụ/.test(rep) && /Theo khách/.test(rep) && new RegExp(`KIEM297 Siêu âm ${stamp}`).test(rep));
    check('màn 9: dịch vụ thử có chi phí 6.100 và mặt hàng dùng nhiều nhất', /6\.100/.test(rep) && new RegExp(`Gel siêu âm kiểm ${stamp}`).test(rep));
    await shot('04-bao-cao-theo-dich-vu.png');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    check('màn 9: Xuất Excel tải được tệp .xlsx', /\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
    check('màn 9: có nút In', (await page.getByRole('button', { name: /^In/ }).count()) > 0);
    await page.getByRole('tab', { name: 'Theo khách' }).click();
    await page.getByRole('table', { name: 'Chi phí vật tư theo khách' }).waitFor({ timeout: 20000 });
    const cust = await bodyText();
    check('màn 9: tab Theo khách liệt kê khách thử với vật tư đã dùng', new RegExp(`Gel siêu âm kiểm ${stamp} ×20`).test(cust));
    await shot('05-bao-cao-theo-khach.png');

    // ── Doanh thu + lãi gộp dịch vụ, hai tab mới, So sánh chi nhánh (#297 bổ sung 4) ──
    await page.getByRole('tab', { name: 'Theo dịch vụ' }).click();
    const byServiceTable = page.getByRole('table', { name: 'Chi phí vật tư theo dịch vụ' });
    await byServiceTable.waitFor({ timeout: 20000 });
    const kpiText = await page.getByLabel('Số liệu chi phí vật tư theo dịch vụ').innerText();
    check('bổ sung 4: dải số có Doanh thu dịch vụ, Lãi gộp dịch vụ, biên lãi gộp và 5 ô', /Doanh thu dịch vụ/.test(kpiText) && /Lãi gộp dịch vụ/.test(kpiText) && /Biên lãi gộp/.test(kpiText) && /Chi phí trung bình mỗi lượt/.test(kpiText));
    const serviceTableText = await byServiceTable.innerText();
    check('bổ sung 4: bảng Theo dịch vụ có cột Doanh thu, Lãi gộp, Biên', /doanh thu/i.test(serviceTableText) && /lãi gộp/i.test(serviceTableText) && /\bbiên\b/i.test(serviceTableText));
    check('bổ sung 4: dịch vụ thử có doanh thu 420.000 (giá dịch vụ) cạnh chi phí vốn', new RegExp(`KIEM297 Siêu âm ${stamp}[\\s\\S]{0,160}420\\.000`).test(serviceTableText), serviceTableText.slice(0, 300));
    await shot('07-bao-cao-lai-gop-dich-vu.png');

    await page.getByRole('tab', { name: 'Theo khách' }).click();
    const byCustomerTable = page.getByRole('table', { name: 'Chi phí vật tư theo khách' });
    await byCustomerTable.waitFor({ timeout: 20000 });
    const customerTableText = await byCustomerTable.innerText();
    check('bổ sung 4: bảng Theo khách có cột Doanh thu và Lãi gộp', /doanh thu/i.test(customerTableText) && /lãi gộp/i.test(customerTableText));

    await page.getByRole('tab', { name: 'Theo vật tư' }).click();
    const byItemTable = page.getByRole('table', { name: 'Chi phí vật tư theo vật tư' });
    await byItemTable.waitFor({ timeout: 20000 });
    const itemTableText = await byItemTable.innerText();
    const itemKpi = await page.getByLabel('Số liệu chi phí vật tư theo vật tư').innerText();
    check('bổ sung 4: tab Theo vật tư liệt kê vật tư thử kèm số lượng, loại và tỷ trọng', new RegExp(`Gel siêu âm kiểm ${stamp}`).test(itemTableText) && /Vật tư/.test(itemTableText) && /%/.test(itemTableText), itemTableText.slice(0, 300));
    check('bổ sung 4: tab Theo vật tư có 3 ô tổng (Tổng chi phí vốn, Số mặt hàng đã dùng, Mặt hàng tốn nhất)', /Tổng chi phí vốn/.test(itemKpi) && /Số mặt hàng đã dùng/.test(itemKpi) && /Mặt hàng tốn nhất/.test(itemKpi));
    const [itemDownload] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    check('bổ sung 4: tab Theo vật tư xuất được Excel', /chi-phi-vat-tu-theo-vat-tu.*\.xlsx$/.test(itemDownload.suggestedFilename()), itemDownload.suggestedFilename());
    check('bổ sung 4: tab Theo vật tư có nút In', (await page.getByRole('button', { name: /^In/ }).count()) > 0);
    await shot('08-bao-cao-theo-vat-tu.png');

    // Trạng thái lỗi của tab mới: máy chủ trả 503 khi bấm Làm mới → thông báo tiếng Việt kèm "Thử lại", không lộ mã; gỡ chặn rồi Thử lại hiện lại bảng.
    await page.route('**/api/v1/reports/service-consumption/by-item**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' } }) }));
    await page.getByRole('button', { name: /Làm mới/ }).click();
    await page.getByRole('button', { name: /Thử lại/ }).waitFor({ timeout: 20000 });
    const errText = await bodyText();
    check('bổ sung 4: tab Theo vật tư gặp lỗi máy chủ → thông báo tiếng Việt có "Thử lại", không lộ mã/lỗi thô', /Hệ thống đang khởi động hoặc tạm thời không truy cập được|Không tải được báo cáo chi phí vật tư theo vật tư/.test(errText) && !FORBIDDEN.test(errText), errText.slice(0, 200));
    await shot('09b-loi-theo-vat-tu.png');
    await page.unroute('**/api/v1/reports/service-consumption/by-item**');
    await page.getByRole('button', { name: /Thử lại/ }).click();
    await byItemTable.waitFor({ timeout: 20000 });
    check('bổ sung 4: bấm Thử lại sau khi máy chủ ổn → bảng hiện lại', (await byItemTable.count()) > 0);

    const branchTab = page.getByRole('tab', { name: 'Theo chi nhánh' });
    check('bổ sung 4: công ty nhiều chi nhánh + quyền xem toàn công ty → có tab "Theo chi nhánh"', (await branchTab.count()) > 0);
    if ((await branchTab.count()) > 0) {
      await branchTab.click();
      const byBranchTable = page.getByRole('table', { name: 'Chi phí vật tư theo chi nhánh' });
      await byBranchTable.waitFor({ timeout: 20000 });
      const branchText = await byBranchTable.innerText();
      check('bổ sung 4: tab Theo chi nhánh có cột Doanh thu, Lãi gộp, Biên và dòng Cộng', /doanh thu/i.test(branchText) && /lãi gộp/i.test(branchText) && /Cộng \d+ chi nhánh/.test(branchText), branchText.slice(0, 300));
      await shot('10-bao-cao-theo-chi-nhanh.png');
    }

    await page.goto(`${WEB}/reports/system`);
    const sysTable = page.getByRole('table', { name: 'So sánh chi nhánh' });
    await sysTable.waitFor({ timeout: 25000 });
    const sysText = await sysTable.innerText();
    check('bổ sung 4: So sánh chi nhánh có thêm cột Lãi gộp dịch vụ và Lãi gộp tổng cạnh Lãi gộp thuốc', /lãi gộp thuốc/i.test(sysText) && /lãi gộp dịch vụ/i.test(sysText) && /lãi gộp tổng/i.test(sysText), sysText.slice(0, 200));
    await shot('11-so-sanh-chi-nhanh.png');

    // ── Màn 10: hộp "Khách không làm dịch vụ" ──
    await page.goto(`${WEB}/billing/${encounter2Id}`);
    await page.getByRole('button', { name: /Khách không làm dịch vụ/ }).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 15000 });
    await page.getByText(`KIEM297 Siêu âm phụ ${stamp}`).last().waitFor({ timeout: 15000 });
    await page.getByRole('checkbox', { name: new RegExp(`Chọn bỏ KIEM297 Siêu âm phụ ${stamp}`) }).check();
    await page.getByText(/đã ghi tiêu hao vật tư/).waitFor({ timeout: 15000 });
    const dlg = await page.getByRole('dialog').innerText();
    check('màn 10: khối "Dịch vụ này đã ghi tiêu hao vật tư" liệt kê vật tư + chi phí vốn', new RegExp(`Gel siêu âm kiểm ${stamp} ×10`).test(dlg) && /Chi phí vốn 3\.000/.test(dlg), dlg.slice(0, 400));
    check('màn 10: có 2 lựa chọn "Giữ nguyên" và "Đảo phiếu tiêu hao và hoàn kho"', /Giữ nguyên/.test(dlg) && /Đảo phiếu tiêu hao và hoàn kho/.test(dlg));
    await shot('06-huy-dich-vu.png');
    // Chưa chọn cách xử lý → nút xác nhận khoá
    await page.getByRole('combobox').first().click().catch(() => {});
    const lyDo = page.locator('#service-decline-reason');
    await lyDo.click();
    await page.getByRole('option').first().click();
    const confirmBtn = page.getByRole('button', { name: /Xác nhận/ }).last();
    check('màn 10: chưa chọn cách xử lý vật tư → nút Xác nhận bị khoá', await confirmBtn.isDisabled());
    await page.getByText('Đảo phiếu tiêu hao và hoàn kho').click();
    check('màn 10: chọn "Đảo phiếu" mà thiếu lý do → vẫn khoá', await confirmBtn.isDisabled());
    await page.locator('#service-decline-consumption-reason').fill('Khách bỏ trước khi làm');
    check('màn 10: có lý do → mở khoá', !(await confirmBtn.isDisabled()));
    await confirmBtn.click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
    const stock = (await api('GET', `/inventory/balances?warehouseId=${wh.id}`)).body.items.find((r) => r.drugId === gel.id);
    // Kho: 100 − 20 (dịch vụ A đã ghi ở màn 7A) = 80; dịch vụ B (10) đã đảo và hoàn kho.
    check('màn 10: đảo phiếu → vật tư hoàn kho (Gel còn 80 = 100 − 20 của dịch vụ A)', stock?.quantityOnHand === 80, String(stock?.quantityOnHand));
    const ov = await api('GET', `/service-consumption/encounters/${encounter2Id}`);
    check('màn 10: dịch vụ B đã huỷ không còn trong danh sách ghi tiêu hao', !(ov.body.services ?? []).some((s) => s.target.id === orderItem2Id));
  } catch (err) {
    check('kịch bản không văng lỗi', false, String(err && err.message ? err.message : err).split('\n')[0] + ' @ ' + String((err && err.stack) || '').split('\n').find((l) => l.includes('service-consumption-check')));
    await shot('99-loi.png').catch(() => {});
  } finally {
    check('không có lỗi JS trên trang', jsErrors.length === 0, jsErrors.join(' | '));
    await browser.close();
    // Dọn: ẩn dữ liệu thử, trả công tắc cũ.
    // Cần version (khoá lạc quan) — đọc lại bản mới nhất rồi mới ẩn.
    for (const d of [gel, tissue]) if (d?.id) { const cur = (await api('GET', `/drugs/${d.id}`)).body; if (cur) await api('PATCH', `/drugs/${d.id}`, { version: cur.version, isActive: false }); }
    if (doctor?.id) { const cur = (await api('GET', `/users/${doctor.id}`)).body; if (cur) await api('PATCH', `/users/${doctor.id}`, { version: cur.version, isActive: false }); }
    if (subWh?.id) { const cur = (await api('GET', `/warehouses/${subWh.id}`)).body; if (cur) await api('PATCH', `/warehouses/${subWh.id}`, { version: cur.version, isActive: false }); }
    for (const id of [svcId, svc2Id]) if (id) { const cur = (await api('GET', `/technical-services/${id}`)).body; if (cur) await api('PATCH', `/technical-services/${id}`, { version: cur.version, isActive: false }); }
    if (!hadDeferred) await api('PATCH', '/clinic-settings', { deferredPaymentEnabled: false }).catch(() => {});
    if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: true }).catch(() => {});
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} ĐẠT`);
  void FORBIDDEN;
  process.exit(ok === results.length ? 0 : 1);
})();
