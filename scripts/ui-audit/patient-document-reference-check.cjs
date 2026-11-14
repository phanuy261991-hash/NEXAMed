/* global require, process, console, document, fetch, Buffer, Blob, FormData */
// KIỂM tab "Hình ảnh & Tài liệu" GIAI ĐOẠN 2 (docs/DECISIONS.md #299 bổ sung 3) trên Chrome thật qua IP LAN HTTP: ảnh kết quả cận lâm sàng đã duyệt, ảnh thẻ BHYT và ảnh đại diện tự
// hiện ở tab dạng dòng THAM CHIẾU chỉ đọc (nhãn nguồn, cột Nguồn "Kết quả CLS · tên dịch vụ", nút "Mở kết quả", không Sửa/Xoá), công tắc BHYT tắt thì ẩn, lễ tân chỉ thấy giấy tờ,
// "Mở kết quả" gặp lỗi mạng thì hiện thông báo cụ thể. Dữ liệu thử có tiền tố KIEMGD2 (tạo qua API, không ghi thẳng CSDL; không xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/patient-document-reference-check.cjs
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
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'patient-document-reference-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|PATIENT_DOCUMENT/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const loginAs = async (username, password) => {
    const res = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username, password }) });
    return (await res.json()).data.accessToken;
  };
  const apiWith = (token) => async (method, url, body) => {
    const res = await fetch(`${WEB}/api/v1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };
  const uploadWith = (token) => async (url, fields, file) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append('file', new Blob([file.buffer], { type: file.type }), file.name);
    const res = await fetch(`${WEB}/api/v1${url}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json.data, error: json.error };
  };
  const adminToken = await loginAs(USER, PASS);
  const api = apiWith(adminToken);
  const upload = uploadWith(adminToken);

  // ── Dữ liệu thử qua API: dịch vụ siêu âm, bệnh nhân, lượt khám, kết quả đã duyệt kèm ảnh, thẻ BHYT có ảnh, ảnh đại diện ──
  const settingsBefore = (await api('GET', '/clinic-settings')).body;
  const hadInsurance = settingsBefore?.insuranceEnabled === true;
  const hadDeferred = settingsBefore?.deferredPaymentEnabled === true;
  const hadShiftRule = settingsBefore?.requirePreviousShiftClosed === true;
  const settingsPatch = {};
  if (!hadInsurance) settingsPatch.insuranceEnabled = true;
  if (!hadDeferred) settingsPatch.deferredPaymentEnabled = true;
  if (hadShiftRule) settingsPatch.requirePreviousShiftClosed = false;
  if (Object.keys(settingsPatch).length > 0) await api('PATCH', '/clinic-settings', settingsPatch);

  const roles = (await api('GET', '/roles?limit=200')).body.items;
  const doctorRole = roles.find((r) => r.name === 'doctor');
  const recRole = roles.find((r) => r.name === 'receptionist');
  const docUser = `kiemgd2.bs.${stamp}`;
  const docPass = 'KiemGd2Doc!45';
  const recUser = `kiemgd2.lt.${stamp}`;
  const recPass = 'KiemGd2Rec!45';
  const doc = await api('POST', '/users', { username: docUser, password: docPass, fullName: `KIEMGD2 Bác sĩ ${stamp}`, displayName: `BS. KIEMGD2 ${stamp}`, roleIds: [doctorRole.id] });
  const rec = await api('POST', '/users', { username: recUser, password: recPass, fullName: `KIEMGD2 Lễ tân ${stamp}`, displayName: `LT. KIEMGD2 ${stamp}`, roleIds: [recRole.id] });
  check('dữ liệu thử: bác sĩ và lễ tân thử', doc.status === 200 && rec.status === 200, JSON.stringify(doc.error ?? rec.error ?? ''));
  const docApi = apiWith(await loginAs(docUser, docPass));

  const serviceName = `KIEMGD2 Siêu âm ổ bụng ${stamp}`;
  const svc = await api('POST', '/technical-services', { name: serviceName, serviceKind: 'IMAGING', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 300000, effectiveFrom: '2020-01-01' }] });
  const patient = (await api('POST', '/patients', { fullName: `KIEMGD2 ${stamp}`, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
  const checkIn = await api('POST', '/reception/direct', {
    patientId: patient.id, doctorId: doc.body.id, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150000, quantity: 1 }],
    receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString(),
  });
  const encounterId = checkIn.body?.id;
  const started = await docApi('POST', `/encounters/${encounterId}/start`, { version: 1 });
  const ordered = await docApi('PUT', `/encounters/${encounterId}/clinical-orders`, { items: [{ performance: 'IN_HOUSE', technicalServiceId: svc.body.id, quantity: 1 }] });
  const itemId = ordered.body?.order?.items?.[0]?.id;
  const invoice = (await api('GET', `/billing/invoices/${encounterId}`)).body;
  const paid = await api('POST', `/billing/invoices/${encounterId}/pay`, { method: 'CASH', version: invoice.version });
  const called = await api('POST', '/paraclinical/imaging/start', { itemIds: [itemId] });
  check('dữ liệu thử: lượt khám, chỉ định, thu tiền, gọi vào phòng', [checkIn, started, ordered, paid, called].every((r) => r.status === 200), JSON.stringify(checkIn.error ?? started.error ?? ordered.error ?? paid.error ?? called.error ?? ''));
  const img1 = await upload(`/paraclinical/imaging/items/${itemId}/images`, {}, { buffer: PNG, type: 'image/png', name: 'sieu-am-1.png' });
  const img2 = await upload(`/paraclinical/imaging/items/${itemId}/images`, {}, { buffer: PNG, type: 'image/png', name: 'sieu-am-2.png' });
  check('dữ liệu thử: 2 ảnh siêu âm', img1.status === 200 && img2.status === 200, JSON.stringify(img1.error ?? img2.error ?? ''));
  // Trước khi duyệt: ảnh của bản nháp CHƯA hiện ở tab.
  const draftList = await api('GET', `/patients/${patient.id}/documents`);
  check('API: kết quả chưa duyệt thì tab chưa có dòng nào', draftList.status === 200 && draftList.body.items.length === 0, `items=${draftList.body?.items?.length}`);
  const approved = await api('POST', `/paraclinical/imaging/items/${itemId}/result/approve`, { sections: [{ itemId, descriptionText: 'Gan nhiễm mỡ nhẹ.', conclusionText: 'Gan nhiễm mỡ độ 1.' }], submit: false });
  check('dữ liệu thử: duyệt kết quả siêu âm', approved.status === 200, JSON.stringify(approved.error ?? ''));

  const card = await api('POST', `/patients/${patient.id}/insurance-cards`, { cardNo: '1' + String(Math.floor(10000000000 + Math.random() * 89999999999)), validTo: '2030-12-31', facilityCode: '79001', facilityName: 'Bệnh viện thử', benefitRate: 80 });
  const cardBody = card.body?.card ?? card.body;
  const front = await upload(`/patients/${patient.id}/insurance-cards/${cardBody?.id}/photo`, { side: 'front', version: cardBody?.version ?? 1 }, { buffer: PNG, type: 'image/png', name: 'front.png' });
  const cardAfter = front.body?.card ?? front.body;
  const back = await upload(`/patients/${patient.id}/insurance-cards/${cardBody?.id}/photo`, { side: 'back', version: cardAfter?.version ?? 2 }, { buffer: PNG, type: 'image/png', name: 'back.png' });
  check('dữ liệu thử: thẻ BHYT có 2 ảnh', card.status === 200 && front.status === 200 && back.status === 200, JSON.stringify(card.error ?? front.error ?? back.error ?? ''));
  const patientFresh = (await api('GET', `/patients/${patient.id}`)).body;
  const photo = await upload(`/patients/${patient.id}/photo`, { version: patientFresh.version }, { buffer: PNG, type: 'image/png', name: 'avatar.png' });
  check('dữ liệu thử: ảnh đại diện', photo.status === 200, JSON.stringify(photo.error ?? ''));

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

  let page;
  try {
    page = await openSession(USER, PASS);
    await openTab(page);

    // ── Xem theo ngày: mọi nguồn hiện chung, có nhãn nguồn ở góc ảnh ──
    await page.getByText('Từ kết quả CLS').first().waitFor({ timeout: 20000 });
    const day = await text(page);
    check('theo ngày: 2 ảnh siêu âm có nhãn "Từ kết quả CLS"', (await page.getByText('Từ kết quả CLS', { exact: true }).count()) === 2);
    check('theo ngày: 2 ảnh thẻ BHYT có nhãn "Từ thẻ BHYT"', (await page.getByText('Từ thẻ BHYT', { exact: true }).count()) === 2);
    check('theo ngày: ảnh đại diện có nhãn "Từ hồ sơ"', (await page.getByText('Từ hồ sơ', { exact: true }).count()) === 1);
    check('dải số: tổng 5 tệp (2 CLS + 2 thẻ + 1 ảnh đại diện)', /Tổng số tệp\s*5/.test(day.replace(/\n/g, ' ')) || /5\s*tệp/.test(day), day.slice(0, 160).replace(/\n/g, ' | '));
    await shot(page, '01-theo-ngay');
    await noRaw(page, 'theo ngày');

    // ── Xem theo loại → Kết quả cận lâm sàng: cột Nguồn có tên dịch vụ, nút Mở kết quả, KHÔNG có Sửa/Xoá ──
    await page.getByRole('button', { name: 'Theo loại' }).click();
    await page.getByRole('button', { name: /^Kết quả cận lâm sàng \d/ }).click();
    await page.getByText(`Kết quả CLS · ${serviceName}`).first().waitFor({ timeout: 15000 });
    check('bảng CLS: cột Nguồn nêu "Kết quả CLS · tên dịch vụ"', (await page.getByText(`Kết quả CLS · ${serviceName}`).count()) >= 0 && /Kết quả CLS ·/.test(await text(page)));
    check('bảng CLS: mỗi dòng có nút "Mở kết quả"', (await page.getByRole('button', { name: 'Mở kết quả' }).count()) === 2);
    check('bảng CLS: không có menu Sửa/Xoá (dòng chỉ đọc)', (await page.getByRole('button', { name: 'Thêm thao tác' }).count()) === 0);
    await shot(page, '02-bang-cls');

    // ── Mở kết quả từ bảng → phiếu kết quả của tab "Kết quả cận lâm sàng" ──
    await page.getByRole('button', { name: 'Mở kết quả' }).first().click();
    await page.getByRole('dialog', { name: 'Xem kết quả cận lâm sàng' }).waitFor({ timeout: 20000 });
    await page.getByText('Gan nhiễm mỡ độ 1.').first().waitFor({ timeout: 20000 });
    check('Mở kết quả: hiện đúng phiếu kết quả (kết luận của bác sĩ)', true);
    await shot(page, '03-mo-ket-qua');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Xem kết quả cận lâm sàng' }).waitFor({ state: 'detached', timeout: 5000 });

    // ── Xem lớn dòng CLS: Nguồn + câu giải thích + Tải về + Mở kết quả; không Sửa/Chuyển/Xoá ──
    await page.getByText(`sieu-am-1.png`).first().click();
    const viewer = page.getByRole('dialog', { name: /sieu-am-1/ });
    await viewer.waitFor();
    const vt = await viewer.innerText();
    check('xem lớn: có dòng Nguồn "Kết quả CLS · tên dịch vụ"', new RegExp(`Nguồn\\s*Kết quả CLS · ${serviceName}`).test(vt));
    check('xem lớn: câu giải thích "Tệp thuộc kết quả đã duyệt. Muốn gỡ, đính chính ở kết quả."', /Tệp thuộc kết quả đã duyệt\. Muốn gỡ, đính chính ở kết quả\./.test(vt));
    check('xem lớn: có Tải về + Mở kết quả, không có Sửa/Chuyển/Xoá', (await viewer.getByRole('button', { name: /Tải về/ }).count()) === 1 && (await viewer.getByRole('button', { name: /Mở kết quả/ }).count()) === 1 && (await viewer.getByRole('button', { name: /^(Sửa|Chuyển|Xoá)/ }).count()) === 0);
    await shot(page, '04-xem-lon');
    // Mở kết quả từ hộp xem lớn → hộp xem lớn đóng, phiếu kết quả mở
    await viewer.getByRole('button', { name: /Mở kết quả/ }).click();
    await page.getByRole('dialog', { name: 'Xem kết quả cận lâm sàng' }).waitFor({ timeout: 20000 });
    check('Mở kết quả từ hộp xem lớn: hộp xem lớn đã đóng, phiếu kết quả mở', (await page.getByRole('dialog', { name: /sieu-am-1/ }).count()) === 0);
    await page.keyboard.press('Escape');

    // ── Mở kết quả gặp lỗi mạng → thông báo cụ thể, không lộ mã ──
    const blockResult = (route) => route.abort('failed');
    await page.route(/\/api\/v1\/paraclinical\//, blockResult);
    // Tải lại trang để xoá bộ nhớ đệm — nếu không, phiếu đã mở trước đó hiện lại từ bộ nhớ đệm và không gặp lỗi.
    await openTab(page);
    await page.getByRole('button', { name: 'Theo loại' }).click();
    await page.getByRole('button', { name: /^Kết quả cận lâm sàng \d/ }).click();
    await page.getByRole('button', { name: 'Mở kết quả' }).first().click();
    await page.getByText('Không tải được kết quả.').waitFor({ timeout: 20000 });
    check('Mở kết quả khi mất mạng: hiện "Không tải được kết quả." kèm Thử lại', (await page.getByRole('button', { name: /Thử lại/ }).count()) >= 1);
    await noRaw(page, 'Mở kết quả lỗi');
    await shot(page, '05-mo-ket-qua-loi');
    await page.keyboard.press('Escape');
    await page.unroute(/\/api\/v1\/paraclinical\//, blockResult);

    // ── Hợp đồng và giấy tờ: ảnh thẻ BHYT chỉ có Xem + Tải về ──
    await page.getByRole('button', { name: /Theo loại/ }).first().click();
    await page.getByRole('button', { name: /^Hợp đồng và giấy tờ \d/ }).click();
    await page.getByText('Từ thẻ BHYT').first().waitFor({ timeout: 15000 });
    check('giấy tờ: 2 dòng "Từ thẻ BHYT"', (await page.getByText('Từ thẻ BHYT', { exact: true }).count()) === 2);
    check('giấy tờ: dòng thẻ BHYT không có "Mở kết quả" và không có menu Sửa/Xoá', (await page.getByRole('button', { name: 'Mở kết quả' }).count()) === 0 && (await page.getByRole('button', { name: 'Thêm thao tác' }).count()) === 0);
    await shot(page, '06-giay-to');
    // ── Khác: ảnh đại diện ──
    await page.getByRole('button', { name: /Theo loại/ }).first().click();
    await page.getByRole('button', { name: /^Khác \d/ }).click();
    await page.getByText('Từ hồ sơ').first().waitFor({ timeout: 15000 });
    check('khác: dòng "Từ hồ sơ" (ảnh đại diện)', (await page.getByText('Ảnh đại diện.png').count()) >= 1);
    await shot(page, '07-khac');
    check('không lỗi JS trong cả phiên quản trị', page.pageErrors.length === 0, page.pageErrors.join(' | '));

    // ── Công tắc BHYT tắt → ảnh thẻ biến mất khỏi tab ──
    await api('PATCH', '/clinic-settings', { insuranceEnabled: false });
    await openTab(page);
    await page.getByText('Từ kết quả CLS').first().waitFor({ timeout: 20000 });
    check('tắt "Áp dụng BHYT": ảnh thẻ không còn ở tab, ảnh CLS vẫn còn', (await page.getByText('Từ thẻ BHYT', { exact: true }).count()) === 0 && (await page.getByText('Từ kết quả CLS', { exact: true }).count()) === 2);
    await api('PATCH', '/clinic-settings', { insuranceEnabled: true });

    // ── Lễ tân: chỉ thấy giấy tờ (thẻ BHYT), không thấy kết quả cận lâm sàng ──
    const recPage = await openSession(recUser, recPass);
    await openTab(recPage);
    await recPage.getByText('Từ thẻ BHYT').first().waitFor({ timeout: 20000 });
    const rt = await text(recPage);
    check('lễ tân: thấy ảnh thẻ BHYT', (await recPage.getByText('Từ thẻ BHYT', { exact: true }).count()) === 2);
    check('lễ tân: KHÔNG thấy ảnh kết quả cận lâm sàng, không có nút Mở kết quả', (await recPage.getByText('Từ kết quả CLS', { exact: true }).count()) === 0 && (await recPage.getByRole('button', { name: 'Mở kết quả' }).count()) === 0 && !rt.includes(serviceName));
    await shot(recPage, '08-le-tan');
    await noRaw(recPage, 'lễ tân');
    check('không lỗi JS ở phiên lễ tân', recPage.pageErrors.length === 0, recPage.pageErrors.join(' | '));
  } catch (e) {
    if (page) await shot(page, 'LOI-kich-ban').catch(() => undefined);
    throw e;
  } finally {
    await browser.close();
    // Trả cài đặt về như cũ; tài khoản thử khoá (không xoá cứng).
    const restore = {};
    if (!hadInsurance) restore.insuranceEnabled = false;
    if (!hadDeferred) restore.deferredPaymentEnabled = false;
    if (hadShiftRule) restore.requirePreviousShiftClosed = true;
    if (Object.keys(restore).length > 0) await api('PATCH', '/clinic-settings', restore);
    for (const u of [doc.body, rec.body]) if (u?.id) await api('POST', `/users/${u.id}/deactivate`, { version: u.version ?? 1 }).catch(() => undefined);
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} ĐẠT`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e);
  process.exit(2);
});
