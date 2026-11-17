/* global require, process, console, document, fetch, Buffer, Blob, FormData */
// KIỂM tab "Hình ảnh & Tài liệu" GIAI ĐOẠN 3 (docs/DECISIONS.md #299 bổ sung 4) trên Chrome thật qua IP LAN HTTP: Cấu hình chung có công tắc + dòng "Dung lượng đã dùng" (số liệu thật,
// thanh phần trăm, lỗi tải kèm Thử lại), tắt công tắc thì tab biến mất ở hồ sơ bệnh nhân và máy chủ trả 409, bật lại thì có đủ tệp cũ, ảnh tải lên có ảnh thu nhỏ nhẹ hơn nhiều so với ảnh
// gốc (lưới dùng ảnh thu nhỏ, xem lớn dùng ảnh gốc). Dữ liệu thử tiền tố KIEMGD3 (tạo qua API; không xoá cứng).
//   PLAYWRIGHT_CORE=<thư mục tạm>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP LAN>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/patient-document-settings-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
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
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'patient-document-settings-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|PATIENT_DOCUMENT/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

/** PNG RGB nhiễu ngẫu nhiên (không nén được): ảnh gốc nặng cỡ vài MB, trình duyệt giải mã bình thường. */
function noisePng(w, h) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = w * 3 + 1;
  const raw = crypto.randomBytes(row * h);
  for (let y = 0; y < h; y++) raw[y * row] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

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
  const apiUpload = uploadWith(adminToken);

  const settingsBefore = (await api('GET', '/clinic-settings')).body;
  const hadEnabled = settingsBefore?.patientDocumentsEnabled !== false;
  await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: true });

  const roles = (await api('GET', '/roles?limit=200')).body.items;
  const recRole = roles.find((r) => r.name === 'receptionist');
  const recUser = `kiemgd3.lt.${stamp}`;
  const recPass = 'KiemGd3Rec!45';
  const rec = await api('POST', '/users', { username: recUser, password: recPass, fullName: `KIEMGD3 Lễ tân ${stamp}`, displayName: `LT. KIEMGD3 ${stamp}`, roleIds: [recRole.id] });
  check('dữ liệu thử: tài khoản lễ tân', rec.status === 200, JSON.stringify(rec.error ?? ''));
  const patient = (await api('POST', '/patients', { fullName: `KIEMGD3 ${stamp}`, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
  check('dữ liệu thử: bệnh nhân', !!patient?.id);
  const usageBefore = (await api('GET', '/patient-documents/usage')).body;

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
  const openTabButton = (page) => page.getByRole('button', { name: 'Hình ảnh & Tài liệu' });
  const openPatient = async (page) => {
    await page.goto(`${WEB}/patients/${patient.id}`);
    await page.getByRole('button', { name: 'Thông tin cá nhân' }).waitFor({ timeout: 20000 });
  };
  const openGeneralConfig = async (page) => {
    await page.goto(`${WEB}/admin/system-config`);
    await page.getByRole('button', { name: /Cấu hình chung/ }).first().click();
    await page.getByText('Dùng Hình ảnh & Tài liệu', { exact: true }).first().waitFor({ timeout: 20000 });
  };

  let page;
  try {
    page = await openSession(USER, PASS);

    // ── Cấu hình chung: khối "Hình ảnh & Tài liệu" ──
    await openGeneralConfig(page);
    await page.getByText(/tệp$/).first().waitFor({ timeout: 20000 });
    const cfg = await text(page);
    check('Cấu hình chung: có tiêu đề khối, công tắc và mô tả', /Hình ảnh & Tài liệu/.test(cfg) && /Bật để hồ sơ bệnh nhân có tab lưu phim chụp, ảnh và giấy tờ/.test(cfg));
    check('Cấu hình chung: dòng "Dung lượng đã dùng" kèm mô tả nguồn', /Dung lượng đã dùng/.test(cfg) && /Gồm cả ảnh kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện\./.test(cfg));
    const usageText = await page.getByText(/\d.* · [\d.]+ tệp$/).first().innerText();
    check('Cấu hình chung: số liệu dạng "12,4 GB · 4.310 tệp"', /^[\d.,]+ (B|KB|MB|GB) · [\d.]+ tệp$/.test(usageText), usageText);
    check('Cấu hình chung: có thanh phần trăm theo ổ chứa kho', (await page.getByRole('img', { name: /Ổ chứa kho đã đầy/ }).count()) === 1);
    const toggle = page.getByRole('checkbox', { name: 'Dùng Hình ảnh & Tài liệu' });
    check('Cấu hình chung: công tắc đang BẬT (mặc định)', await toggle.isChecked());
    await page.getByText('Dung lượng đã dùng', { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, '01-cau-hinh-chung');
    await noRaw(page, 'Cấu hình chung');

    // ── Lỗi tải dung lượng: thông báo cụ thể + Thử lại, công tắc vẫn dùng được ──
    const blockUsage = (route) => route.abort('failed');
    await page.route(/\/api\/v1\/patient-documents\/usage/, blockUsage);
    await openGeneralConfig(page);
    await page.getByText('Không tải được dung lượng đã dùng.').waitFor({ timeout: 20000 });
    check('Dung lượng lỗi mạng: hiện câu cụ thể kèm "Thử lại", không lộ mã', (await page.getByRole('button', { name: /Thử lại/ }).count()) >= 1 && !FORBIDDEN.test(await text(page)));
    await shot(page, '02-dung-luong-loi');
    await page.unroute(/\/api\/v1\/patient-documents\/usage/, blockUsage);
    await page.getByRole('button', { name: /Thử lại/ }).first().click();
    await page.getByText(/\d.* · [\d.]+ tệp$/).first().waitFor({ timeout: 20000 });
    check('Dung lượng: bấm "Thử lại" tải được số liệu', true);

    // ── Ảnh thu nhỏ: tải ảnh nhiễu ~2 MB qua giao diện, lưới dùng ảnh thu nhỏ, xem lớn dùng ảnh gốc ──
    await openPatient(page);
    await openTabButton(page).click();
    await page.getByText('Chưa có hình ảnh hay tài liệu').waitFor({ timeout: 20000 });
    const original = noisePng(900, 700); // ~1,9 MB
    await page.getByRole('button', { name: /Tải lên/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Tải lên hình ảnh và tài liệu' });
    await dialog.waitFor();
    await dialog.getByLabel('Chọn tệp').setInputFiles([{ name: 'anh-nhieu.png', mimeType: 'image/png', buffer: original }]);
    await dialog.getByText(/sẵn sàng/).waitFor({ timeout: 20000 });
    const uploadResponse = page.waitForResponse((r) => r.url().includes('/documents') && r.request().method() === 'POST', { timeout: 30000 });
    await dialog.getByRole('button', { name: /Tải lên 1 tệp/ }).click();
    const response = await uploadResponse;
    const uploaded = (await response.json()).data;
    check('tải lên ảnh nhiễu: máy chủ trả thumbnailUrl (trình duyệt đã gửi kèm ảnh thu nhỏ)', response.status() === 200 && typeof uploaded.thumbnailUrl === 'string', JSON.stringify(uploaded.thumbnailUrl));
    await dialog.waitFor({ state: 'detached', timeout: 20000 });

    await page.locator('button[title="anh-nhieu.png"] img').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button[title="anh-nhieu.png"] img')).some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    const tile = await page.evaluate(() => {
      const img = Array.from(document.querySelectorAll('button[title="anh-nhieu.png"] img')).find((i) => i.naturalWidth > 0);
      return img ? { w: img.naturalWidth, h: img.naturalHeight, src: img.currentSrc } : null;
    });
    check('lưới "Theo ngày": ô ảnh dùng ảnh thu nhỏ (cạnh dài ≤ 320 px, không phải ảnh gốc 900×700)', !!tile && Math.max(tile.w, tile.h) <= 320, JSON.stringify(tile && { w: tile.w, h: tile.h }));
    const tileBytes = Number((await (await fetch(tile.src)).arrayBuffer()).byteLength);
    check('ảnh thu nhỏ nhẹ hơn ảnh gốc nhiều lần', tileBytes < original.length / 5, `${tileBytes} B so với ${original.length} B`);
    await shot(page, '03-luoi-anh-thu-nho');
    await page.getByText('anh-nhieu.png').first().click();
    const viewer = page.getByRole('dialog', { name: /anh-nhieu/ });
    await viewer.waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] img')).some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    const big = await page.evaluate(() => {
      const img = Array.from(document.querySelectorAll('[role="dialog"] img')).find((i) => i.naturalWidth > 0);
      return img ? { w: img.naturalWidth } : null;
    });
    check('xem lớn: dùng ảnh GỐC (900 px), không phải ảnh thu nhỏ', !!big && big.w === 900, JSON.stringify(big));
    await page.keyboard.press('Escape');

    // ── Ảnh thu nhỏ BÙ (#299 bổ sung 5): tệp cũ (tải qua API, KHÔNG kèm ảnh thu nhỏ) → trình duyệt tự tạo và gửi lên → lần mở sau dùng ảnh nhỏ ──
    const oldImage = noisePng(900, 700);
    const oldDoc = await apiUpload(`/patients/${patient.id}/documents`, { category: 'CLINICAL_PHOTO' }, { buffer: oldImage, type: 'image/png', name: 'anh-cu.png' });
    check('dữ liệu thử: tệp ảnh cũ chưa có ảnh thu nhỏ', oldDoc.status === 200 && oldDoc.body.thumbnailUrl === null, JSON.stringify(oldDoc.error ?? ''));
    await openPatient(page);
    await openTabButton(page).click();
    await page.locator('button[title="anh-cu.png"] img').first().waitFor({ timeout: 20000 });
    let backfilled = false;
    for (let i = 0; i < 40 && !backfilled; i++) {
      await page.waitForTimeout(500);
      const docs = (await api('GET', `/patients/${patient.id}/documents`)).body.items;
      backfilled = !!docs.find((d) => d.id === oldDoc.body.id)?.thumbnailUrl;
    }
    check('ảnh bù: mở tab thì trình duyệt tự tạo và gửi ảnh thu nhỏ cho tệp cũ (máy chủ đã có thumbnailUrl)', backfilled);
    await openPatient(page);
    await openTabButton(page).click();
    await page.locator('button[title="anh-cu.png"] img').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button[title="anh-cu.png"] img')).some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    const oldTile = await page.evaluate(() => {
      const img = Array.from(document.querySelectorAll('button[title="anh-cu.png"] img')).find((i) => i.naturalWidth > 0);
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    check('ảnh bù: lần mở sau ô ảnh dùng ảnh thu nhỏ (cạnh dài ≤ 320 px), không còn tải ảnh gốc 900×700', !!oldTile && Math.max(oldTile.w, oldTile.h) <= 320, JSON.stringify(oldTile));

    // ── Dung lượng tăng sau khi tải ảnh ──
    const usageAfter = (await api('GET', '/patient-documents/usage')).body;
    check('dung lượng đã dùng tăng ít nhất bằng hai ảnh gốc, số tệp tăng đúng 2 (ảnh thu nhỏ không tính là tệp)', usageAfter.totalBytes - usageBefore.totalBytes >= original.length + oldImage.length && usageAfter.fileCount - usageBefore.fileCount === 2, `+${usageAfter.totalBytes - usageBefore.totalBytes} B, +${usageAfter.fileCount - usageBefore.fileCount} tệp`);

    // ── Tắt công tắc ở Cấu hình chung → tab biến mất ở hồ sơ; máy chủ 409; bật lại thì còn đủ tệp ──
    await openGeneralConfig(page);
    // Ô tích thật được ẩn bằng sr-only (chỉ còn nút trượt nhìn thấy): bấm vào nhãn bao ngoài như người dùng.
    await page.getByRole('checkbox', { name: 'Dùng Hình ảnh & Tài liệu' }).locator('xpath=ancestor::label').click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Dùng Hình ảnh & Tài liệu"]')?.checked === false, null, { timeout: 15000 });
    check('Cấu hình chung: bấm công tắc → TẮT và lưu được', (await api('GET', '/clinic-settings/patient-documents-enabled')).body.enabled === false);
    await shot(page, '04-cong-tac-tat');
    // Đọc lại công tắc ở một phiên mới để tránh bộ nhớ đệm của phiên đang mở.
    const adminOff = await openSession(USER, PASS);
    await openPatient(adminOff);
    await adminOff.waitForTimeout(1500);
    check('công tắc TẮT: hồ sơ bệnh nhân không còn tab "Hình ảnh & Tài liệu"', (await openTabButton(adminOff).count()) === 0);
    const disabled = await api('GET', `/patients/${patient.id}/documents`);
    check('công tắc TẮT: máy chủ trả 409 PATIENT_DOCUMENTS_DISABLED với câu tiếng Việt', disabled.status === 409 && disabled.error?.code === 'PATIENT_DOCUMENTS_DISABLED' && /Hình ảnh & Tài liệu/.test(disabled.error?.message ?? ''), JSON.stringify(disabled.error));
    await shot(adminOff, '05-ho-so-khong-tab');
    const recPage = await openSession(recUser, recPass);
    await openPatient(recPage);
    await recPage.waitForTimeout(1500);
    check('công tắc TẮT: lễ tân cũng không thấy tab', (await openTabButton(recPage).count()) === 0);

    await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: true });
    const adminOn = await openSession(USER, PASS);
    await openPatient(adminOn);
    await openTabButton(adminOn).waitFor({ timeout: 20000 });
    await openTabButton(adminOn).click();
    await adminOn.getByText('anh-nhieu.png').first().waitFor({ timeout: 20000 });
    check('bật lại: tab trở lại và còn đủ tệp đã tải trước đó', true);
    await noRaw(adminOn, 'sau khi bật lại');
    check('không lỗi JS trong các phiên quản trị', page.pageErrors.length === 0 && adminOff.pageErrors.length === 0 && adminOn.pageErrors.length === 0, [...page.pageErrors, ...adminOff.pageErrors, ...adminOn.pageErrors].join(' | '));
  } catch (e) {
    if (page) await shot(page, 'LOI-kich-ban').catch(() => undefined);
    throw e;
  } finally {
    await browser.close();
    await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: hadEnabled });
    // Khoá tài khoản thử (không xoá cứng): đọc phiên bản mới nhất rồi PATCH isActive=false.
    if (rec.body?.id) {
      const cur = (await api('GET', `/users/${rec.body.id}`)).body;
      if (cur) await api('PATCH', `/users/${rec.body.id}`, { version: cur.version, isActive: false });
    }
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} ĐẠT`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e);
  process.exit(2);
});
