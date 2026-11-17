/* global require, process, console, window, document, fetch, Buffer */
// KIỂM chế độ DICOM tuỳ chọn (docs/DECISIONS.md #299 bổ sung 6) trên Chrome thật qua IP LAN HTTP: công tắc "Dùng tệp DICOM" (tắt = như cũ), khối "Tệp DICOM gốc" ở màn nhập kết quả
// (đính, giới hạn 4 tệp/50 MB, cảnh báo thiếu ảnh in, gỡ), trình xem (vẽ ảnh thật, công cụ, nhiều khung), tên khác hồ sơ, kiểu nén chưa đọc được, tệp hỏng, ảnh lớn, mất mạng + Thử lại,
// kết quả đã duyệt (Xem + Tải về), tệp hiện ở tab Hình ảnh của màn khám và xem được ở đó.
// Dựng tệp DICOM tổng hợp ngay trong script (không cần phim thật). Tiền tố KIEMDCM; cuối chạy khoá bác sĩ thử và trả công tắc như cũ.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/dicom-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'dicom-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack|UnprocessableEntity|1\.2\.840/;
const stamp = String(Date.now()).slice(-7);
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

// ---- Dựng DICOM tổng hợp (Part 10, VR tường minh Little Endian) ----
const enc = new TextEncoder();
const even = (b, pad) => (b.length % 2 === 0 ? b : Uint8Array.from([...b, pad]));
function el(group, e, vr, value, long = false) {
  const head = long ? 12 : 8;
  const out = new Uint8Array(head + value.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, e, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, value.length, true);
  else dv.setUint16(6, value.length, true);
  out.set(value, head);
  return out;
}
const str = (g, e, vr, v) => el(g, e, vr, even(enc.encode(v), 0x20));
const us = (g, e, v) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return el(g, e, 'US', b);
};
const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
function dicom({ rows, cols, bits = 16, frames = 1, patientName, ts = '1.2.840.10008.1.2.1', modality = 'CR', studyDate = '20261117', studyTime = '084100', spacing = '0.143\\0.143' }) {
  const meta = str(0x0002, 0x0010, 'UI', ts);
  const metaLen = new Uint8Array(4);
  new DataView(metaLen.buffer).setUint32(0, meta.length, true);
  const px = bits === 16 ? new Uint16Array(rows * cols * frames) : new Uint8Array(rows * cols * frames);
  const max = bits === 16 ? 4000 : 250;
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dx = x - cols / 2 - f * 4;
        const dy = y - rows / 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        px[f * rows * cols + y * cols + x] = Math.round(max * Math.max(0, 1 - r / (Math.min(rows, cols) / 2.2)) + max * 0.1 * ((x + y) % 7) / 7);
      }
    }
  }
  const parts = [str(0x0008, 0x0020, 'DA', studyDate), str(0x0008, 0x0030, 'TM', studyTime), str(0x0008, 0x0060, 'CS', modality)];
  if (patientName) parts.push(str(0x0010, 0x0010, 'PN', patientName), str(0x0010, 0x0020, 'LO', 'BN-KIEMDCM'));
  parts.push(us(0x0028, 0x0002, 1), str(0x0028, 0x0004, 'CS', 'MONOCHROME2'));
  if (frames > 1) parts.push(str(0x0028, 0x0008, 'IS', String(frames)));
  parts.push(us(0x0028, 0x0010, rows), us(0x0028, 0x0011, cols), str(0x0028, 0x0030, 'DS', spacing), us(0x0028, 0x0100, bits), us(0x0028, 0x0101, bits), us(0x0028, 0x0102, bits - 1), us(0x0028, 0x0103, 0));
  parts.push(el(0x7fe0, 0x0010, bits === 16 ? 'OW' : 'OB', new Uint8Array(px.buffer), true));
  return Buffer.from(cat([new Uint8Array(128), enc.encode('DICM'), el(0x0002, 0x0000, 'UL', metaLen), meta, ...parts]));
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
  const dicomBefore = settings?.dicomEnabled === true;
  const docsBefore = settings?.patientDocumentsEnabled !== false;
  if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: false });
  await api('PATCH', '/clinic-settings', { patientDocumentsEnabled: true, dicomEnabled: false });
  const roles = (await api('GET', '/roles')).body?.items ?? [];
  const doctorRole = roles.find((r) => r.name === 'doctor');
  const docUser = `kiemdcm.bs.${stamp}`;
  const docPass = 'Kiem@Dcm123!';
  const docCreated = await api('POST', '/users', { username: docUser, password: docPass, fullName: `KIEMDCM Bác sĩ ${stamp}`, displayName: `BS. KIEMDCM ${stamp}`, roleIds: [doctorRole.id] });
  check('dữ liệu thử: bác sĩ thử', docCreated.status === 200, JSON.stringify(docCreated.error ?? ''));
  const doctor = docCreated.body;
  const docLogin = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: docUser, password: docPass }) });
  const docApi = apiWith((await docLogin.json()).data.accessToken);

  const svc = await api('POST', '/technical-services', { name: `KIEMDCM X-quang ${stamp}`, serviceKind: 'IMAGING', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2020-01-01' }] });
  const patientName = `KIEMDCM ${stamp}`;
  const patient = (await api('POST', '/patients', { fullName: patientName, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
  const checkIn = await api('POST', '/reception/direct', {
    patientId: patient.id, doctorId: doctor.id, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150000, quantity: 1 }],
    receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString(),
  });
  const encounterId = checkIn.body?.id;
  const started = await docApi('POST', `/encounters/${encounterId}/start`, { version: 1 });
  const ordered = await docApi('PUT', `/encounters/${encounterId}/clinical-orders`, { items: [{ performance: 'IN_HOUSE', technicalServiceId: svc.body.id, quantity: 1 }] });
  const itemId = ordered.body?.order?.items?.[0]?.id;
  const inv = (await api('GET', `/billing/invoices/${encounterId}`)).body;
  const paid = await api('POST', `/billing/invoices/${encounterId}/pay`, { method: 'CASH', version: inv.version });
  const called = await api('POST', '/paraclinical/imaging/start', { itemIds: [itemId] });
  check('dữ liệu thử: lượt khám + chỉ định X-quang đã thu tiền và gọi vào phòng', checkIn.status === 200 && started.status === 200 && ordered.status === 200 && paid.status === 200 && called.status === 200, JSON.stringify([checkIn.error, started.error, ordered.error, paid.error, called.error].filter(Boolean)));

  const goodFile = dicom({ rows: 256, cols: 256, patientName: `KIEMDCM^${stamp}` });
  const mismatchFile = dicom({ rows: 64, cols: 64, patientName: 'NGUYEN^VAN^B' });
  const multiFile = dicom({ rows: 64, cols: 64, bits: 8, frames: 12, patientName: `KIEMDCM^${stamp}`, modality: 'US' });
  const j2kFile = dicom({ rows: 8, cols: 8, patientName: `KIEMDCM^${stamp}`, ts: '1.2.840.10008.1.2.4.90' });
  const corruptFile = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from('đây không phải dữ liệu DICOM hợp lệ '.repeat(10))]);
  const bigFile = dicom({ rows: 3000, cols: 3000, bits: 8, patientName: `KIEMDCM^${stamp}` });

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const resultUrl = `${WEB}/paraclinical/imaging/items/${itemId}`;
  const block = () => page.getByLabel('Tệp DICOM gốc', { exact: true });

  // Số điểm ảnh sáng trong canvas của trình xem: ảnh thật phải có cả vùng tối lẫn vùng sáng.
  const canvasStats = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Ảnh DICOM"]');
      if (!c) return null;
      const ctx2 = c.getContext('2d');
      const d = ctx2.getImageData(0, 0, c.width, c.height).data;
      let bright = 0;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        if (d[i] > 150) bright++;
        else if (d[i] < 30) dark++;
      }
      return { bright, dark };
    });

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ── Công tắc TẮT (mặc định): như hiện nay ──
    await page.goto(resultUrl);
    await page.getByText('Hình ảnh đính kèm').first().waitFor({ timeout: 20000 }).catch(async (e) => {
      await shot('00-loi-mo-man-nhap.png');
      console.log('Nội dung trang:', (await bodyText()).split('\n').join(' | ').slice(0, 400));
      throw e;
    });
    check('công tắc tắt: màn nhập kết quả KHÔNG có khối "Tệp DICOM gốc"', (await block().count()) === 0);
    const offUp = await api('POST', `/paraclinical/imaging/items/${itemId}/dicom`);
    check('công tắc tắt: máy chủ từ chối đính DICOM (không tạo gì)', offUp.status === 409 || offUp.status === 400, String(offUp.status));

    // ── Bật công tắc ở Cấu hình chung ──
    await page.goto(`${WEB}/admin/system-config`);
    await page.getByRole('button', { name: /Cấu hình chung/ }).first().click();
    const sw = page.getByRole('checkbox', { name: 'Dùng tệp DICOM' });
    await sw.waitFor({ state: 'attached', timeout: 20000 });
    const swText = await bodyText();
    check('Cấu hình chung: có dòng "Dùng tệp DICOM" với mô tả ngắn, đang tắt', /Dùng tệp DICOM/.test(swText) && /Đính DICOM vào kết quả cận lâm sàng và xem ngay trong hệ thống/.test(swText) && !(await sw.isChecked()));
    await shot('01-cau-hinh.png');
    await sw.locator('xpath=ancestor::label').click();
    await page.waitForTimeout(1200);
    check('Cấu hình chung: bật công tắc → máy chủ ghi nhận', (await api('GET', '/clinic-settings/dicom-enabled')).body?.enabled === true);

    // ── Màn nhập kết quả ──
    await page.goto(resultUrl);
    await block().waitFor({ timeout: 20000 });
    check('công tắc bật: có khối "Tệp DICOM gốc" và nút "Thêm tệp DICOM"', (await block().getByText('Thêm tệp DICOM').count()) >= 1);
    const input = block().getByLabel('Thêm tệp DICOM');
    await input.setInputFiles({ name: `nguc-${stamp}.dcm`, mimeType: 'application/dicom', buffer: goodFile });
    await block().getByText(`nguc-${stamp}.dcm`).waitFor({ timeout: 20000 });
    check('đính 1 tệp: hiện tên + dung lượng + nút Xem', /Xem/.test(await block().innerText()) && /KB|MB/.test(await block().innerText()), (await block().innerText()).replace(/\n/g, ' | '));
    check('chỉ có DICOM, chưa có ảnh JPG/PNG: cảnh báo vàng "Phiếu in sẽ không có ảnh"', /Phiếu in sẽ không có ảnh/.test(await block().innerText()));
    await shot('02-nhap-ket-qua.png');

    // ── Trình xem: ảnh thật, công cụ ──
    await block().getByRole('button', { name: 'Xem' }).first().click();
    const viewer = page.getByRole('dialog', { name: `nguc-${stamp}.dcm` });
    await viewer.waitFor({ timeout: 15000 });
    await viewer.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const stats = await canvasStats();
    check('trình xem: vẽ ảnh thật (có cả vùng sáng lẫn tối, không phải khung trắng/đen)', !!stats && stats.bright > 20 && stats.dark > 20, JSON.stringify(stats));
    const vText = await viewer.innerText();
    check('trình xem: lớp thông tin bốn góc lấy từ tệp + cột chi tiết', /KIEMDCM/.test(vText) && /CR/.test(vText) && /17\/11\/2026 08:41/.test(vText) && /256 × 256/.test(vText) && /0,143 mm\/điểm ảnh/.test(vText) && /Phóng 100%/.test(vText) && /W \d+ · L \d+/.test(vText), vText.replace(/\n/g, ' | ').slice(0, 260));
    check('trình xem: tên trong tệp khớp hồ sơ', /Tên trong tệp khớp hồ sơ/.test(vText));
    check('trình xem: ghi chú "Chuỗi ảnh trong tệp" + "1 khung"', /Chuỗi ảnh trong tệp/.test(vText) && /1 khung/.test(vText));
    const before = await canvasStats();
    await viewer.getByRole('button', { name: 'Đảo màu' }).click();
    await page.waitForTimeout(400);
    const inverted = await canvasStats();
    check('công cụ Đảo màu: vùng sáng/tối đổi chỗ', !!before && !!inverted && inverted.bright !== before.bright, `${before?.bright}→${inverted?.bright}`);
    await viewer.getByRole('button', { name: 'Đảo màu' }).click();
    const cv = viewer.locator('canvas[aria-label="Ảnh DICOM"]');
    const box = await cv.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    check('cuộn chuột phóng to ảnh', !/Phóng 100%/.test(await viewer.innerText()), (await viewer.innerText()).match(/Phóng \d+%/)?.[0]);
    await viewer.getByRole('button', { name: 'Đặt lại' }).click();
    check('nút Đặt lại: về 100%', /Phóng 100%/.test(await viewer.innerText()));
    await viewer.getByRole('button', { name: 'Sáng, tương phản' }).click();
    const w1 = (await viewer.innerText()).match(/W (\d+)/)?.[1];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const w2 = (await viewer.innerText()).match(/W (\d+)/)?.[1];
    check('công cụ Sáng/tương phản: kéo ngang đổi W', w1 !== undefined && w2 !== undefined && w1 !== w2, `${w1}→${w2}`);
    await shot('03-trinh-xem.png');
    await page.keyboard.press('Escape');
    check('Esc đóng trình xem', (await viewer.count()) === 0);

    // ── Tên khác hồ sơ ──
    await input.setInputFiles({ name: `khac-ten-${stamp}.dcm`, mimeType: 'application/dicom', buffer: mismatchFile });
    await block().getByText(`khac-ten-${stamp}.dcm`).waitFor({ timeout: 20000 });
    await block().locator('li', { hasText: `khac-ten-${stamp}.dcm` }).getByRole('button', { name: 'Xem' }).click();
    const v2 = page.getByRole('dialog', { name: `khac-ten-${stamp}.dcm` });
    await v2.getByText('Kiểm tra trước khi dùng').waitFor({ timeout: 15000 });
    const warn = await v2.innerText();
    check('tên khác hồ sơ: cảnh báo vàng nêu cả hai tên, có "Vẫn xem" và "Tải về", chưa hiện ảnh', /NGUYEN VAN B/.test(warn) && warn.includes(patientName) && (await v2.getByRole('button', { name: 'Vẫn xem' }).count()) === 1 && (await v2.locator('canvas[aria-label="Ảnh DICOM"]').count()) === 0);
    await shot('04-khac-ten.png');
    await v2.getByRole('button', { name: 'Vẫn xem' }).click();
    await v2.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 10000 });
    check('bấm "Vẫn xem": hiện ảnh, cột chi tiết vẫn nhắc tên khác hồ sơ', /Tên trong tệp khác hồ sơ/.test(await v2.innerText()));
    await page.keyboard.press('Escape');

    // ── Nhiều khung ──
    await input.setInputFiles({ name: `sieu-am-${stamp}.dcm`, mimeType: 'application/dicom', buffer: multiFile });
    await block().getByText(`sieu-am-${stamp}.dcm`).waitFor({ timeout: 20000 });
    await block().locator('li', { hasText: `sieu-am-${stamp}.dcm` }).getByRole('button', { name: 'Xem' }).click();
    const v3 = page.getByRole('dialog', { name: `sieu-am-${stamp}.dcm` });
    await v3.getByText('Khung 1/12').waitFor({ timeout: 15000 });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    check('nhiều khung: thanh chọn khung, phím ↓ sang khung 2', /Khung 2\/12/.test(await v3.innerText()) && (await v3.getByLabel('Chọn khung').count()) === 1);
    await page.keyboard.press('Escape');

    // ── Giới hạn 4 tệp (3 tệp đã đính; thêm tệp thứ 4 được, tệp thứ 5 bị chặn ngay ở trình duyệt) ──
    await input.setInputFiles({ name: `nen-j2k-${stamp}.dcm`, mimeType: 'application/dicom', buffer: j2kFile });
    await block().getByText(`nen-j2k-${stamp}.dcm`).waitFor({ timeout: 20000 });
    check('đủ 4 tệp: nút "Thêm tệp DICOM" biến mất', (await block().getByText('Thêm tệp DICOM').count()) === 0);
    // Tệp > 50 MB: báo ngay tại trình duyệt (gỡ 1 tệp để còn chỗ rồi thử).
    await block().getByRole('button', { name: `Gỡ tệp nen-j2k-${stamp}.dcm` }).click();
    await block().getByText(`nen-j2k-${stamp}.dcm`).waitFor({ state: 'detached', timeout: 15000 });
    const tooBigPath = path.join(OUT, `qua-lon-${stamp}.dcm`);
    fs.writeFileSync(tooBigPath, Buffer.alloc(51 * 1024 * 1024, 1));
    await block().getByLabel('Thêm tệp DICOM').setInputFiles(tooBigPath);
    fs.rmSync(tooBigPath, { force: true });
    await page.waitForTimeout(500);
    check('tệp quá 50 MB: báo tiếng Việt ngay, không gửi lên', /vượt quá 50 MB/.test(await block().innerText()) && !FORBIDDEN.test(await block().innerText()));
    await block().getByLabel('Thêm tệp DICOM').setInputFiles({ name: `nen-j2k-${stamp}.dcm`, mimeType: 'application/dicom', buffer: j2kFile });
    await block().getByText(`nen-j2k-${stamp}.dcm`).waitFor({ timeout: 20000 });

    // ── Kiểu nén chưa đọc được ──
    await block().locator('li', { hasText: `nen-j2k-${stamp}.dcm` }).getByRole('button', { name: 'Xem' }).click();
    const v4 = page.getByRole('dialog', { name: `nen-j2k-${stamp}.dcm` });
    await v4.getByText('Chưa xem được tệp này').waitFor({ timeout: 15000 });
    const ut = await v4.innerText();
    check('kiểu nén chưa đọc được: nêu tên kiểu nén (không lộ mã), có "Tải về"', /JPEG 2000/.test(ut) && !FORBIDDEN.test(ut) && (await v4.getByRole('button', { name: 'Tải về' }).count()) >= 1, ut.replace(/\n/g, ' | ').slice(0, 220));
    await shot('05-khong-doc-duoc.png');
    await page.keyboard.press('Escape');

    // ── Mất mạng khi tải tệp: Thử lại ──
    await page.route('**/api/v1/files/**', (route) => route.abort('failed'));
    await block().locator('li', { hasText: `nguc-${stamp}.dcm` }).getByRole('button', { name: 'Xem' }).click();
    const v5 = page.getByRole('dialog', { name: `nguc-${stamp}.dcm` });
    await v5.getByText('Mất kết nối khi tải tệp').waitFor({ timeout: 15000 });
    check('mất mạng: thông báo tiếng Việt + nút Thử lại, không lộ mã lỗi', (await v5.getByRole('button', { name: 'Thử lại' }).count()) === 1 && !FORBIDDEN.test(await v5.innerText()));
    await page.unroute('**/api/v1/files/**');
    await v5.getByRole('button', { name: 'Thử lại' }).click();
    await v5.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 15000 });
    check('Thử lại khi có mạng: xem được ảnh', true);
    await page.keyboard.press('Escape');

    // ── Gỡ tệp ──
    await block().getByRole('button', { name: `Gỡ tệp nen-j2k-${stamp}.dcm` }).click();
    await block().getByText(`nen-j2k-${stamp}.dcm`).waitFor({ state: 'detached', timeout: 15000 });
    check('gỡ tệp: biến khỏi danh sách', true);

    // ── Duyệt (chỉ có DICOM) rồi xem chỉ đọc ──
    const approve = await docApi('POST', `/paraclinical/imaging/items/${itemId}/result/approve`, { sections: [{ itemId, values: [], descriptionText: 'Phổi sáng.', conclusionText: 'Không tổn thương.' }] });
    check('dữ liệu thử: duyệt kết quả chỉ có DICOM (vẫn duyệt được)', approve.status === 200, JSON.stringify(approve.error ?? ''));
    await page.goto(resultUrl);
    await block().waitFor({ timeout: 20000 });
    const roText = await block().innerText();
    check('kết quả đã duyệt: mỗi tệp có Xem + Tải về, không có nút gỡ/thêm/cảnh báo in', (await block().getByRole('button', { name: 'Tải về' }).count()) >= 1 && (await block().getByRole('button', { name: /^Gỡ tệp/ }).count()) === 0 && !/Thêm tệp DICOM/.test(roText) && !/Phiếu in sẽ không có ảnh/.test(roText));
    await shot('06-da-duyet.png');

    // ── Tab Hình ảnh của màn khám: DICOM hiện dạng tham chiếu, bấm xem được khi công tắc bật ──
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').getByRole('button', { name: /^Hình ảnh/ }).click();
    await page.getByText(`nguc-${stamp}.dcm`).first().waitFor({ timeout: 20000 });
    check('tab Hình ảnh của màn khám: tệp DICOM của kết quả hiện dạng tham chiếu chỉ đọc', /Từ kết quả CLS/.test(await bodyText()));
    await page.getByRole('button', { name: new RegExp(`nguc-${stamp}`) }).first().click();
    const v6 = page.getByRole('dialog', { name: new RegExp(`nguc-${stamp}`) });
    await v6.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 15000 });
    check('tab Hình ảnh: bấm tệp DICOM mở trình xem (công tắc bật)', true);
    await page.keyboard.press('Escape');

    // ── Hộp "Xem" kết quả ở màn khám: dải "Tệp DICOM gốc" nằm ngoài tờ phiếu ──
    const openResultView = async () => {
      await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').getByRole('button', { name: /^Kết quả cận lâm sàng/ }).click();
      await page.getByRole('button', { name: 'Xem', exact: true }).first().click();
      const dlg = page.getByRole('dialog', { name: 'Xem kết quả cận lâm sàng' });
      await dlg.waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      return dlg;
    };
    const rv = await openResultView();
    const strip = rv.getByLabel('Tệp DICOM gốc', { exact: true });
    await strip.waitFor({ timeout: 15000 });
    const stripText = await strip.innerText();
    check('hộp Xem kết quả: dải "Tệp DICOM gốc" liệt kê tệp kèm dung lượng, Xem và Tải về', stripText.includes('nguc-' + stamp + '.dcm') && /KB|MB/.test(stripText) && (await strip.getByRole('button', { name: 'Xem' }).count()) >= 1 && (await strip.getByRole('button', { name: 'Tải về' }).count()) >= 1, stripText.split('\n').join(' | ').slice(0, 160));
    check('hộp Xem kết quả: dải nằm ngoài tờ phiếu (không lẫn vào bản in)', (await rv.locator('.print-preview-shrink').getByText('Tệp DICOM gốc').count()) === 0);
    await shot('06b-hop-xem-ket-qua.png');
    await strip.locator('li', { hasText: 'nguc-' + stamp + '.dcm' }).getByRole('button', { name: 'Xem' }).click();
    const rvViewer = page.getByRole('dialog', { name: 'nguc-' + stamp + '.dcm' });
    await rvViewer.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 15000 });
    check('hộp Xem kết quả: bấm Xem mở trình xem DICOM, vẽ được ảnh', true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Esc trong trình xem chỉ đóng trình xem, hộp xem kết quả bên dưới vẫn mở', (await rvViewer.count()) === 0 && (await rv.count()) === 1);
    await page.keyboard.press('Escape');

    // ── Công tắc tắt lại: tệp đã đính vẫn giữ, nhưng chỉ tải về ──
    await api('PATCH', '/clinic-settings', { dicomEnabled: false });
    await page.waitForTimeout(300);
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').getByRole('button', { name: /^Hình ảnh/ }).click();
    await page.getByRole('button', { name: new RegExp(`nguc-${stamp}`) }).first().click();
    const v7 = page.getByRole('dialog', { name: new RegExp(`nguc-${stamp}`) });
    await v7.waitFor({ timeout: 10000 });
    check('công tắc tắt lại: tệp đã đính còn đó nhưng không có trình xem (chỉ tải về như cũ)', /Chưa xem được tệp DICOM trong hệ thống/.test(await v7.innerText()) && (await v7.locator('canvas').count()) === 0);
    await page.keyboard.press('Escape');
    await page.goto(WEB + '/encounters/' + encounterId);
    await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const rvOff = await openResultView();
    check('công tắc tắt lại: hộp Xem kết quả không có dải DICOM', (await rvOff.getByLabel('Tệp DICOM gốc', { exact: true }).count()) === 0);
    await page.keyboard.press('Escape');
    await page.goto(resultUrl);
    await page.getByText('Hình ảnh đính kèm').first().waitFor({ timeout: 20000 });
    check('công tắc tắt lại: màn nhập kết quả không còn khối DICOM', (await block().count()) === 0);

    // ── Tệp hỏng và ảnh lớn qua tab hồ sơ bệnh nhân (bật lại công tắc) ──
    await api('PATCH', '/clinic-settings', { dicomEnabled: true });
    await page.goto(`${WEB}/patients/${patient.id}`);
    await page.getByRole('button', { name: 'Hình ảnh & Tài liệu' }).click();
    for (const [name, buffer] of [[`hong-${stamp}.dcm`, corruptFile], [`lon-${stamp}.dcm`, bigFile]]) {
      await page.getByRole('button', { name: /Tải lên/ }).first().click();
      const up = page.getByRole('dialog', { name: 'Tải lên hình ảnh và tài liệu' });
      await up.getByLabel('Chọn tệp').setInputFiles({ name, mimeType: 'application/dicom', buffer });
      await up.getByRole('button', { name: /^Tải lên \d+ tệp/ }).click();
      await up.waitFor({ state: 'detached', timeout: 30000 });
    }
    await page.getByText(`hong-${stamp}.dcm`).first().waitFor({ timeout: 20000 });
    await page.getByText(`hong-${stamp}.dcm`).first().click();
    const v8 = page.getByRole('dialog', { name: new RegExp(`hong-${stamp}`) });
    await v8.getByText('Tệp bị lỗi').waitFor({ timeout: 15000 });
    check('tệp hỏng: "Tệp bị lỗi" + lối ra Tải về, không lộ lỗi thô', (await v8.getByRole('button', { name: 'Tải về' }).count()) >= 1 && !FORBIDDEN.test(await v8.innerText()));
    await page.keyboard.press('Escape');
    await page.getByText(`lon-${stamp}.dcm`).first().click();
    const v9 = page.getByRole('dialog', { name: new RegExp(`lon-${stamp}`) });
    await v9.locator('canvas[aria-label="Ảnh DICOM"]').waitFor({ timeout: 30000 });
    check('ảnh lớn (3000 × 3000): thông báo thu nhỏ khi xem, vẫn vẽ được', /sẽ được thu nhỏ khi xem/.test(await v9.innerText()) && /Bản tải về vẫn là bản gốc/.test(await v9.innerText()));
    await shot('07-anh-lon.png');
    await page.keyboard.press('Escape');

    check('không có lỗi JavaScript trên trang', jsErrors.length === 0, jsErrors.join(' || ').slice(0, 300));
  } finally {
    await browser.close();
    await api('PATCH', '/clinic-settings', { dicomEnabled: dicomBefore, patientDocumentsEnabled: docsBefore });
    const list = (await api('GET', '/users?pageSize=200')).body?.items ?? [];
    for (const u of list.filter((x) => typeof x.username === 'string' && x.username.startsWith('kiemdcm.bs.'))) {
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
