/* global require, process, console, window, document, fetch */
// KIỂM thanh tab màn khám KHÔNG CUỘN NGANG (docs/DECISIONS.md #300, mockup Cách 2) trên Chrome thật qua IP LAN HTTP:
// ở nhiều cỡ màn hình thanh tab không có thanh cuộn, hết chỗ thì tab ưu tiên thấp vào nút "Thêm", chọn tab trong menu thì tab hiện lên thanh,
// tab đang chọn luôn hiện, chấm xanh trên "Thêm" khi trong menu có tab có số, Esc đóng menu.
// Tạo dữ liệu thử có tiền tố KIEMTAB ở công ty thử cố định, cuối chạy khoá tài khoản thử.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/consultation-tabs-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'consultation-tabs-check');
fs.mkdirSync(OUT, { recursive: true });
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

  const settings = (await api('GET', '/clinic-settings')).body;
  const hadShiftRule = settings?.requirePreviousShiftClosed === true;
  if (hadShiftRule) await api('PATCH', '/clinic-settings', { requirePreviousShiftClosed: false });
  const roles = (await api('GET', '/roles')).body?.items ?? [];
  const doctorRole = roles.find((r) => r.name === 'doctor');
  const docUser = `kiemtab.bs.${stamp}`;
  const docPass = 'Kiem@Tab123!';
  const docCreated = await api('POST', '/users', { username: docUser, password: docPass, fullName: `KIEMTAB Bác sĩ ${stamp}`, displayName: `BS. KIEMTAB ${stamp}`, roleIds: [doctorRole.id] });
  check('dữ liệu thử: bác sĩ thử', docCreated.status === 200, JSON.stringify(docCreated.error ?? ''));
  const doctor = docCreated.body;
  const docLogin = await fetch(`${WEB}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: docUser, password: docPass }) });
  const docApi = apiWith((await docLogin.json()).data.accessToken);

  const svc = await api('POST', '/technical-services', { name: `KIEMTAB Siêu âm ${stamp}`, serviceKind: 'IMAGING', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2020-01-01' }] });
  const patient = (await api('POST', '/patients', { fullName: `KIEMTAB ${stamp}`, dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) })).body;
  const checkIn = await api('POST', '/reception/direct', {
    patientId: patient.id, doctorId: doctor.id, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150000, quantity: 1 }],
    receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString(),
  });
  const encounterId = checkIn.body?.id;
  const started = await docApi('POST', `/encounters/${encounterId}/start`, { version: 1 });
  const ordered = await docApi('PUT', `/encounters/${encounterId}/clinical-orders`, { items: [{ performance: 'IN_HOUSE', technicalServiceId: svc.body.id, quantity: 1 }] });
  check('dữ liệu thử: lượt khám đang khám có 1 chỉ định', checkIn.status === 200 && started.status === 200 && ordered.status === 200, JSON.stringify(checkIn.error ?? started.error ?? ordered.error ?? ''));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  // Đọc trạng thái thanh tab: nhãn hiện, có nút Thêm, có thanh cuộn ngang/dọc không.
  const readBar = () =>
    page.evaluate(() => {
      const list = document.querySelector('[role="tablist"][aria-label="Các phần của màn khám"]');
      if (!list) return null;
      const bar = list.parentElement;
      const btns = Array.from(list.children[0] ? list.querySelectorAll(':scope > button, :scope > div > button') : []).filter((b) => !b.closest('[aria-hidden="true"]'));
      const more = btns.find((b) => b.getAttribute('aria-haspopup') === 'menu');
      const tabs = btns.filter((b) => b !== more).map((b) => ({ name: (b.getAttribute('aria-label') || b.textContent || '').trim(), current: b.getAttribute('aria-current') === 'true' }));
      return {
        tabs,
        hasMore: !!more,
        moreDot: !!more && !!more.querySelector('span.rounded-full'),
        scrollsX: bar.scrollWidth > bar.clientWidth + 1 || list.scrollWidth > list.clientWidth + 1,
        scrollsY: bar.scrollHeight > bar.clientHeight + 1,
        overflowX: getComputedStyle(bar).overflowX,
        barRight: Math.round(bar.getBoundingClientRect().right),
        lastRight: Math.round(Math.max(...btns.map((b) => b.getBoundingClientRect().right))),
      };
    });

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    const sizes = [
      [1280, 720],
      [1366, 657],
      [1440, 900],
      [1536, 730],
      [1920, 969],
      [2560, 1300],
    ];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${WEB}/encounters/${encounterId}`);
      await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').waitFor({ timeout: 20000 });
      await page.waitForTimeout(500);
      const bar = await readBar();
      check(`${w}×${h}: thanh tab không cuộn ngang/dọc, không tràn khung`, !!bar && !bar.scrollsX && !bar.scrollsY && bar.overflowX !== 'auto' && bar.overflowX !== 'scroll' && bar.lastRight <= bar.barRight, JSON.stringify(bar && { x: bar.scrollsX, y: bar.scrollsY, ox: bar.overflowX, last: bar.lastRight, bar: bar.barRight }));
      check(`${w}×${h}: tab đang chọn (Khám & Chẩn đoán) luôn hiện`, !!bar && bar.tabs.some((t) => t.current && /Khám & Chẩn đoán/.test(t.name)), JSON.stringify(bar?.tabs.map((t) => t.name)));
      console.log(`      ${w}: hiện ${bar?.tabs.length} tab${bar?.hasMore ? ' + Thêm' : ''}: ${bar?.tabs.map((t) => t.name).join(' | ')}`);
      await shot(`tabs-${w}.png`);
      if (w >= 1920) check(`${w}×${h}: màn lớn hiện đủ tab, không có nút Thêm`, !!bar && !bar.hasMore && bar.tabs.length === 6, `hiện ${bar?.tabs.length}`);
    }

    // ── Tương tác ở 1000: menu Thêm ──
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.goto(`${WEB}/encounters/${encounterId}`);
    await page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    let bar = await readBar();
    check('1000: có nút "Thêm" khi hết chỗ', !!bar?.hasMore);
    const moreBtn = page.locator('[role="tablist"][aria-label="Các phần của màn khám"]').getByRole('button', { name: /^Thêm/ });
    await moreBtn.click();
    const menu = page.getByRole('menu');
    check('1000: bấm "Thêm" mở menu có tên tab đầy đủ', (await menu.count()) === 1 && /Vật tư đã dùng|Điều trị & Hẹn tái khám/.test(await menu.innerText()), (await menu.innerText().catch(() => '')).replace(/\n/g, ' | '));
    await shot('tabs-1000-menu.png');
    await page.keyboard.press('Escape');
    check('1000: Esc đóng menu', (await page.getByRole('menu').count()) === 0);
    await moreBtn.click();
    const items = await page.getByRole('menuitem').allInnerTexts();
    const pick = items.find((t) => /Điều trị/.test(t)) ?? items[0];
    await page.getByRole('menuitem', { name: pick.trim() }).first().click();
    await page.waitForTimeout(300);
    bar = await readBar();
    check(`1000: chọn "${pick.trim()}" trong menu thì tab đó hiện trên thanh và đang chọn`, !!bar && bar.tabs.some((t) => t.current && pick.includes(t.name.replace(/ & Tái khám/, ' & Hẹn tái khám'))) , JSON.stringify(bar?.tabs));
    check('1000: sau khi đổi chỗ vẫn không cuộn', !!bar && !bar.scrollsX && !bar.scrollsY);
    await shot('tabs-1000-after-pick.png');

    // ── Rất hẹp: vẫn không cuộn ──
    await page.setViewportSize({ width: 760, height: 700 });
    await page.waitForTimeout(500);
    bar = await readBar();
    check('760: rất hẹp vẫn không cuộn, tab đang chọn còn hiện', !!bar && !bar.scrollsX && bar.tabs.some((t) => t.current), JSON.stringify(bar));

    check('không có lỗi JavaScript trên trang', jsErrors.length === 0, jsErrors.join(' || ').slice(0, 300));
  } finally {
    await browser.close();
    // Dọn: khoá bác sĩ thử (PATCH isActive=false) và trả cài đặt như cũ.
    const list = (await api('GET', '/users?pageSize=200')).body?.items ?? [];
    for (const u of list.filter((x) => typeof x.username === 'string' && x.username.startsWith('kiemtab.bs.'))) {
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
