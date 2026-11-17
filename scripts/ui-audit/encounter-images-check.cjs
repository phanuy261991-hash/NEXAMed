/* global require, process, console, window, document, fetch, DataTransfer, ClipboardEvent, File */
// KIỂM tab "Hình ảnh" + hộp "Đính ảnh" ở màn khám (docs/DECISIONS.md #299 bổ sung 6) trên Chrome thật qua IP LAN HTTP:
// trạng thái rỗng, hộp Đính ảnh (gắn sẵn lượt khám, ô Loại, dán Ctrl+V, không có nút Chụp ảnh trên máy dùng chuột), tải 3 ảnh, số trên tab, lọc, xem lớn,
// ảnh nằm luôn ở tab hồ sơ bệnh nhân, ảnh đính sau khi hoàn tất khám ghi "bổ sung", chỉ có quyền xem thì nút mờ, lỗi tải danh sách/tải lên, công tắc tắt thì ẩn tab.
// Tạo dữ liệu thử có tiền tố KIEMIMG ở công ty thử cố định; cuối chạy khoá bác sĩ thử và trả công tắc như cũ.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/encounter-images-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'encounter-images-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stamp = String(Date.now()).slice(-7);
// Mỗi ảnh phải khác nội dung: máy chủ coi hai tệp giống hệt (cùng bệnh nhân, loại, ghi chú) tải liền nhau là một lần gửi lại.
const png = (tag) => Buffer.concat([PNG, Buffer.from(`${tag}${stamp}`)]);
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

  const settings = (await api('GET', '/clinic-settings')).body;
  const hadShiftRule = settings?.requirePreviousShiftClosed === true;
  if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: false });
  const roles = (await api('GET', '/roles')).body?.items ?? [];
  const doctorRole = roles.find((r) => r.name === 'doctor');
  const docUser = `kiemimg.bs.${stamp}`;
  const docPass = 'Kiem@Img123!';
  const docCreated = await api('POST', '/users', { username: docUser, password: docPass, fullName: `KIEMIMG Bác sĩ ${stamp}`, displayName: `BS. KIEMIMG ${stamp}`, roleIds: [doctorRole.id] });
  check('dữ liệu thử: bác sĩ thử', docCreated.status === 200, JSON.stringify(docCreated.error ?? ''));
  const doctor = docCreated.body;
  const docLogin = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: docUser, password: docPass }) });
  const docApi = apiWith((await docLogin.json()).data.accessToken);

  const patientName = `KIEMIMG ${stamp}`;
  const patient = (await api('POST', '/patients', { fullName: patientName, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
  const checkIn = await api('POST', '/reception/direct', {
    patientId: patient.id, doctorId: doctor.id, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150000, quantity: 1 }],
    receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString(),
  });
  const encounterId = checkIn.body?.id;
  const started = await docApi('POST', `/encounters/${encounterId}/start`, { version: 1 });
  check('dữ liệu thử: lượt khám đang khám', checkIn.status === 200 && started.status === 200, JSON.stringify(checkIn.error ?? started.error ?? ''));
  const encounterNo = checkIn.body?.encounterNo;

  const docsEnabledBefore = (await api('GET', '/clinic-settings/patient-documents-enabled')).body?.enabled;

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const tablist = () => page.locator('[role="tablist"][aria-label="Các phần của màn khám"]');
  const openImagesTab = async () => {
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await tablist().waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await tablist().getByRole('button', { name: /^Hình ảnh/ }).click();
  };

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ── Rỗng ──
    await openImagesTab();
    await page.getByText('Lượt khám này chưa có ảnh').waitFor({ timeout: 15000 });
    const emptyText = await bodyText();
    check('tab Hình ảnh: trạng thái rỗng có lời mời đính ảnh và nút', /Đính ảnh vết thương, phim chụp hoặc giấy chuyển tuyến/.test(emptyText) && (await page.getByRole('button', { name: 'Đính ảnh' }).count()) >= 1);
    check('tab Hình ảnh: chưa có ảnh thì không có số trên tab', !/Hình ảnh\s*\d/.test(await tablist().innerText()));
    await shot('01-rong.png');

    // ── Hộp Đính ảnh ──
    await page.getByRole('button', { name: 'Đính ảnh' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Đính ảnh vào lượt khám' });
    await dlg.waitFor({ timeout: 10000 });
    const dtext = await dlg.innerText();
    check('hộp Đính ảnh: gắn sẵn lượt khám + tên bệnh nhân + ngày', dtext.includes(String(encounterNo)) && dtext.includes(patientName), dtext.slice(0, 160).replace(/\n/g, ' | '));
    check('hộp Đính ảnh: không có ô Thư mục / Gắn lượt khám, có ô Loại và Ghi chú', !/Thư mục tự tạo|Gắn với lượt khám/.test(dtext) && /Loại/.test(dtext) && /Ghi chú \(tuỳ chọn\)/.test(dtext));
    check('hộp Đính ảnh: máy dùng chuột không thấy nút Chụp ảnh', !(await dlg.getByRole('button', { name: 'Chụp ảnh' }).isVisible()));
    check('hộp Đính ảnh: có câu hướng dẫn dán Ctrl+V', /Ctrl\+V/.test(dtext));
    await dlg.getByLabel('Chọn tệp').setInputFiles([
      { name: `a-${stamp}.png`, mimeType: 'image/png', buffer: png('a') },
      { name: `b-${stamp}.png`, mimeType: 'image/png', buffer: png('b') },
    ]);
    // Dán ảnh bằng Ctrl+V (sự kiện paste có clipboardData).
    await page.evaluate((name) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, `dan-${stamp}.png`);
    await page.waitForTimeout(400);
    const rowsText = await dlg.innerText();
    check('hộp Đính ảnh: chọn 2 tệp + dán 1 ảnh → 3 dòng', rowsText.includes(`a-${stamp}.png`) && rowsText.includes(`b-${stamp}.png`) && rowsText.includes(`dan-${stamp}.png`));
    check('hộp Đính ảnh: nút ghi "Đính 3 tệp"', (await dlg.getByRole('button', { name: 'Đính 3 tệp' }).count()) === 1);
    await shot('02-hop-dinh-anh.png');
    // Tệp thứ ba (ảnh dán, không phải PNG hợp lệ đầy đủ) có thể bị từ chối; bỏ nó để kiểm đường chạy đúng với 2 tệp hợp lệ.
    await dlg.getByRole('button', { name: `Bỏ dan-${stamp}.png` }).click();
    await dlg.getByRole('button', { name: 'Đính 2 tệp' }).click();
    await dlg.waitFor({ state: 'detached', timeout: 20000 });
    await page.getByText(`a-${stamp}.png`).first().waitFor({ timeout: 15000 });
    const afterText = await bodyText();
    check('sau khi đính: lưới có 2 ảnh, tiêu đề + bộ lọc có số', afterText.includes(`b-${stamp}.png`) && /Hình ảnh của lượt khám này/.test(afterText) && /Ảnh lâm sàng\s*2/.test(afterText) && /Tất cả\s*2/.test(afterText), afterText.slice(0, 200).replace(/\n/g, ' | '));
    check('sau khi đính: tab có số 2', /Hình ảnh\s*2/.test(await tablist().innerText()), await tablist().innerText().then((t) => t.replace(/\n/g, ' | ')));
    await shot('03-co-anh.png');

    // ── Xem lớn ──
    await page.getByRole('button', { name: new RegExp(`a-${stamp}`) }).first().click();
    const viewer = page.getByRole('dialog', { name: new RegExp(`a-${stamp}`) });
    await viewer.waitFor({ timeout: 10000 });
    check('bấm ô ảnh: mở hộp xem lớn của ảnh', true);
    await page.keyboard.press('Escape');
    check('Esc đóng hộp xem lớn', (await viewer.count()) === 0);

    // ── Ảnh nằm luôn ở hồ sơ bệnh nhân ──
    const listRes = await api('GET', `/patients/${patient.id}/documents?encounterId=${encounterId}`);
    check('máy chủ: lọc theo lượt khám trả đúng 2 ảnh lâm sàng', listRes.status === 200 && listRes.body.items.length === 2 && listRes.body.items.every((d) => d.category === 'CLINICAL_PHOTO' && d.encounterId === encounterId));
    await page.goto(`${WEB}/patients/${patient.id}`);
    await page.getByRole('button', { name: 'Hình ảnh & Tài liệu' }).click();
    await page.getByText(`a-${stamp}.png`).first().waitFor({ timeout: 15000 });
    check('ảnh đính ở màn khám hiện luôn ở tab Hình ảnh & Tài liệu của hồ sơ', (await bodyText()).includes(`b-${stamp}.png`));

    // ── Hoàn tất khám rồi đính thêm: ghi "bổ sung" ──
    const dx = await docApi('PUT', `/encounters/${encounterId}/diagnoses`, { diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' }] });
    const enc = (await docApi('GET', `/encounters/${encounterId}/consultation`)).body;
    const done = await docApi('POST', `/encounters/${encounterId}/complete`, { version: enc?.encounter?.version ?? 2 });
    check('dữ liệu thử: hoàn tất khám', dx.status === 200 && done.status === 200, JSON.stringify(dx.error ?? done.error ?? ''));
    await page.waitForTimeout(1200);
    await openImagesTab();
    await page.getByText(`a-${stamp}.png`).first().waitFor({ timeout: 15000 });
    check('lượt khám đã hoàn tất: ảnh đính trước đó KHÔNG ghi "Bổ sung"', !/Bổ sung/.test(await bodyText()));
    await page.getByRole('button', { name: 'Đính ảnh' }).first().click();
    const dlg2 = page.getByRole('dialog', { name: 'Đính ảnh vào lượt khám' });
    await dlg2.waitFor({ timeout: 10000 });
    await dlg2.getByLabel('Chọn tệp').setInputFiles([{ name: `muon-${stamp}.png`, mimeType: 'image/png', buffer: png('m') }]);
    await dlg2.locator('#doc-up-category').click();
    await page.getByRole('option', { name: 'Khác' }).click();
    await dlg2.getByRole('button', { name: 'Đính 1 tệp' }).click();
    await dlg2.waitFor({ state: 'detached', timeout: 20000 });
    await page.getByText(`muon-${stamp}.png`).first().waitFor({ timeout: 15000 });
    const supplementTiles = await page.locator('button[title]').filter({ hasText: /Bổ sung/ }).count();
    check('lượt khám đã hoàn tất vẫn đính thêm được, ảnh mới ghi "Bổ sung" và đúng loại Khác', supplementTiles === 1 && /Khác\s*1/.test(await bodyText()), `ô bổ sung: ${supplementTiles}`);
    await shot('04-bo-sung.png');

    // ── Chỉ có quyền xem: nút mờ ──
    await page.route(`**/api/v1/patients/${patient.id}/documents?*`, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data?.access) json.data.access.clinical.upload = false;
      await route.fulfill({ response: res, json });
    });
    await openImagesTab();
    await page.getByText(`a-${stamp}.png`).first().waitFor({ timeout: 15000 });
    const roBtn = page.getByRole('button', { name: 'Đính ảnh' }).first();
    check('chỉ có quyền xem: nút Đính ảnh mờ, có chú thích "Bạn chỉ có quyền xem"', (await roBtn.isDisabled()) && (await roBtn.getAttribute('title')) === 'Bạn chỉ có quyền xem');
    await page.unroute(`**/api/v1/patients/${patient.id}/documents?*`);

    // ── Lỗi tải danh sách: hiện thông báo tiếng Việt + Thử lại, không lộ mã lỗi ──
    await page.route(`**/api/v1/patients/${patient.id}/documents?*`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await tablist().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    const tabBtn = tablist().getByRole('button', { name: /^Hình ảnh/ });
    if ((await tabBtn.count()) === 0) await tablist().getByRole('button', { name: /^Thêm/ }).click().then(() => page.getByRole('menuitem', { name: /Hình ảnh/ }).click());
    else await tabBtn.click();
    await page.getByRole('button', { name: 'Thử lại' }).first().waitFor({ timeout: 40000 });
    const errBlock = await page.locator('main').last().innerText();
    await shot('05b-loi-tai.png');
    check('lỗi tải danh sách: thông báo tiếng Việt + nút Thử lại, không lộ mã lỗi', !FORBIDDEN.test(errBlock) && /Thử lại/.test(errBlock), errBlock.replace(/\n/g, ' | ').slice(-220));
    await page.unroute(`**/api/v1/patients/${patient.id}/documents?*`);
    await page.getByRole('button', { name: 'Thử lại' }).first().click();
    await page.getByText(`a-${stamp}.png`).first().waitFor({ timeout: 15000 });
    check('bấm Thử lại: danh sách tải lại được', true);

    // ── Lỗi khi đính: hộp còn mở, tệp đã chọn còn nguyên ──
    await page.getByRole('button', { name: 'Đính ảnh' }).first().click();
    const dlg3 = page.getByRole('dialog', { name: 'Đính ảnh vào lượt khám' });
    await dlg3.waitFor({ timeout: 10000 });
    await dlg3.getByLabel('Chọn tệp').setInputFiles([{ name: `loi-${stamp}.png`, mimeType: 'image/png', buffer: png('l') }]);
    await page.route(`**/api/v1/patients/${patient.id}/documents`, (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_FILE', message: 'File is not allowed' } }) }) : route.continue()));
    await dlg3.getByRole('button', { name: 'Đính 1 tệp' }).click();
    await page.waitForTimeout(1200);
    const failText = await dlg3.innerText().catch(() => '');
    check('lỗi khi đính: hộp còn mở, tệp còn nguyên, không lộ mã lỗi tiếng Anh', failText.includes(`loi-${stamp}.png`) && !FORBIDDEN.test(failText) && !/File is not allowed/.test(failText), failText.slice(0, 200).replace(/\n/g, ' | '));
    await page.unroute(`**/api/v1/patients/${patient.id}/documents`);
    await shot('05-loi-dinh.png');
    await page.keyboard.press('Escape');

    // ── Công tắc tắt: ẩn tab ──
    await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: false });
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await tablist().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const tabsWhenOff = await tablist().innerText();
    check('công tắc Hình ảnh & Tài liệu tắt: màn khám không còn tab Hình ảnh', !/Hình ảnh/.test(tabsWhenOff));
    await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: docsEnabledBefore !== false });

    check('không có lỗi JavaScript trên trang', jsErrors.length === 0, jsErrors.join(' || ').slice(0, 300));
  } finally {
    await browser.close();
    await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: docsEnabledBefore !== false });
    const list = (await api('GET', '/users?pageSize=200')).body?.items ?? [];
    for (const u of list.filter((x) => typeof x.username === 'string' && x.username.startsWith('kiemimg.bs.'))) {
      const r = await api('PATCH', `/users/${u.id}`, { isActive: false, version: u.version });
      if (r.status !== 200) console.log('CẢNH BÁO không khoá được', u.username, r.status);
    }
    if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: true });
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nTổng: ${results.length - failed}/${results.length} đạt. Ảnh ở ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('LỖI chạy script:', e.message);
  process.exit(1);
});
