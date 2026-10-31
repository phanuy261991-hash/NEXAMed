/* global require, process, console, __dirname, fetch */
// QUÉT QUYỀN THEO VAI TRÒ trên Chrome thật (docs/DECISIONS.md #260): tìm trang mà người dùng VÀO ĐƯỢC (không phải trang "Không có quyền truy cập") nhưng bên trong lại gặp API trả 403/5xx hoặc
// khung lỗi "Không tải được…" — lớp lỗi "menu/route cho vào nhưng API từ chối theo phạm vi/quyền" (vd. lễ tân có `cashier_shift.read` ở phạm vi cá nhân nhưng danh sách phiếu chốt ca chỉ cho quản lý).
// Ba phần (chọn bằng UI_AUDIT_SECTIONS, mặc định chạy cả ba):
//   default — 7 vai trò mặc định (`rl.<vai trò>`) × MỌI route tĩnh; mỗi trang còn bấm lần lượt từng "pill" (thanh thẻ của trang cấu hình), từng "tab" (role="tab") và từng nút chuyển kiểu xem ("toggle", SegmentedToggle) bên trong.
//   params  — cùng 7 vai trò × các route CÓ THAM SỐ (`/patients/:id`, `/inventory/receipts/:id`...): tự lấy một id mẫu qua API bằng quản trị; route nào không có dữ liệu mẫu thì ghi "bỏ qua".
//   custom  — VAI TRÒ TUỲ BIẾN: với mỗi route khai quyền đơn giản ở router, tạo một vai trò chỉ có quyền của route + các quyền ĐI KÈM (`PERMISSION_COMPANIONS`, #208) ở phạm vi toàn bộ, một tài khoản
//             `sw.<n>`, đăng nhập và mở trang. Phát hiện bảng quyền đi kèm bị thiếu/lỗi thời. Dọn xong: ẩn vai trò `sw-sweep-*` và khoá tài khoản `sw.*` (lọc ĐÚNG tiền tố, in danh sách trước khi sửa).
// Chuẩn bị: công ty có sẵn tài khoản `rl.<vai trò>` mật khẩu 12345678 (xem DECISIONS #260) — dựng bằng stack on-prem thử hoặc `pnpm dev`. Biến môi trường:
//   UI_AUDIT_WEB (mặc định http://localhost:5173), PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_ROLES ("receptionist,doctor,..."), UI_AUDIT_PASS (12345678), UI_AUDIT_ONLY (lọc route chứa chuỗi),
//   UI_AUDIT_SECTIONS ("default,params,custom"), UI_AUDIT_CUSTOM_LIMIT (số route tối đa ở phần custom, mặc định không giới hạn).
// Chạy: node scripts/ui-audit/role-access-sweep.cjs   → in bảng lỗi; thoát 1 nếu còn điểm lỗi.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const PASS = process.env.UI_AUDIT_PASS || '12345678';
const ROLES = (process.env.UI_AUDIT_ROLES || 'receptionist,doctor,nurse,lab_technician,imaging_technician,clinic_admin,system_admin').split(',');
const ONLY = process.env.UI_AUDIT_ONLY || '';
const SECTIONS = (process.env.UI_AUDIT_SECTIONS || 'default,params,custom').split(',');
const CUSTOM_LIMIT = Number(process.env.UI_AUDIT_CUSTOM_LIMIT || 0);
const SWEEP_ROLE_PREFIX = 'sw-sweep-';
const SWEEP_USER_PREFIX = 'sw.';
// Mã lần chạy: tên vai trò/tài khoản đã dùng (kể cả bị ẩn/khoá) vẫn chiếm chỗ (409), nên mỗi lần chạy phải dùng tên mới.
const RUN_ID = Date.now().toString(36).slice(-6);

const src = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/router.tsx'), 'utf8');
const SKIP = ['/login', '/change-password', '/choose-branch', '/'];
const allPaths = [...src.matchAll(/path: '([^':*]+)'/g)].map((m) => m[1]).filter((p) => !SKIP.includes(p));
const staticRoutes = [...new Set(allPaths.map((p) => (p.startsWith('/') ? p : '/' + p)))].filter((r) => !ONLY || r.includes(ONLY));
// Route có tham số: giữ nguyên mẫu `x/:id`.
const paramPatterns = [...new Set([...src.matchAll(/path: '([^'*]*:[^'*]+)'/g)].map((m) => m[1]))].filter((p) => !ONLY || p.includes(ONLY));
// Quyền đơn giản của route: `path: 'x', element: <RequirePermissionRoute module="m" action="a" [minScope="s"]>` (route gộp nhiều quyền dùng RequireAnyPermissionRoute thì bỏ qua ở phần custom).
const guardByRoute = new Map();
for (const m of src.matchAll(/path: '([^']+)',\s*element:\s*<RequirePermissionRoute module="([^"]+)" action="([^"]+)"/g)) {
  guardByRoute.set('/' + m[1].replace(/^\//, ''), { module: m[2], action: m[3] });
}

// Giới hạn cứng: các lời gọi `page.evaluate`/`$eval` của Playwright KHÔNG có timeout mặc định, trang đang đứng hình thì script treo vô hạn (lần chạy 27/10/2026 treo 14 phút).
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`QUÁ GIỜ ${ms / 1000}s: ${label}`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
// Số thẻ/tab tối đa bấm mỗi trang: `/admin/catalog` có 122 thẻ danh mục (mỗi thẻ ~2 giây) nên bấm hết mất > 3 phút. Các thẻ cùng gọi một API theo mã danh mục, bấm 40 thẻ đầu là đủ phủ quyền.
const MAX_TABS_PER_PAGE = Number(process.env.UI_AUDIT_MAX_PILLS || 150);
const ROUTE_TIMEOUT_MS = Number(process.env.UI_AUDIT_ROUTE_TIMEOUT_MS || 90000);

const ERROR_TEXT = /Không tải được|Không thể tải|Đã xảy ra lỗi|Tải dữ liệu thất bại/;

// ----------------------------------------------------------------- API (chỉ để chuẩn bị dữ liệu, KHÔNG phải để kiểm)
let TENANT = null;
async function api(p, { method = 'GET', token, json } = {}) {
  const res = await fetch(`${WEB}/api/v1${p}`, {
    method,
    headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body && body.data !== undefined ? body.data : body, body };
}
async function apiLogin(username, password) {
  const r = await api('/auth/login', { method: 'POST', json: { tenantId: TENANT, username, password } });
  if (r.status !== 200) throw new Error(`đăng nhập API ${username} lỗi ${r.status}`);
  return r.data.accessToken;
}
const firstId = (data) => {
  const list = Array.isArray(data) ? data : (data && (data.items || data.data || data.rows)) || [];
  return Array.isArray(list) && list[0] ? list[0].id ?? list[0].itemId ?? list[0].encounterId : undefined;
};

// Lấy id mẫu cho từng mẫu route có tham số (thử nhiều điểm cuối; không có dữ liệu thì để trống → bỏ qua).
async function resolveParamRoutes(token) {
  const out = [];
  const candidates = {
    'patients/:id': ['/patients?limit=1&page=1', '/patients?limit=1'],
    'encounters/:id': ['/reception/today?limit=1', '/encounters?limit=1'],
    'billing/:encounterId': ['/billing/invoices?limit=1'],
    'paraclinical/lab/items/:itemId': ['/paraclinical/lab/queue?limit=1'],
    'paraclinical/imaging/items/:itemId': ['/paraclinical/imaging/queue?limit=1'],
    'inventory/receipts/:id': ['/inventory/receipts?limit=1'],
    'inventory/issues/manual/:id': ['/inventory/issues?limit=1', '/inventory/issues/manual?limit=1'],
    'inventory/counts/:id': ['/inventory/counts?limit=1'],
    'inventory/transfers/:id': ['/inventory/transfers?limit=1'],
    'admin/price-lists/:priceListId': ['/price-lists?limit=1'],
    'suppliers/:id': ['/suppliers?limit=1'],
  };
  for (const pattern of paramPatterns) {
    const key = pattern.replace(/^\//, '');
    let id;
    for (const endpoint of candidates[key] || []) {
      const r = await api(endpoint, { token });
      if (r.status === 200) {
        id = firstId(r.data);
        if (id) break;
      }
    }
    if (!id) {
      // Công ty thử chưa có dữ liệu: dùng id GIẢ (hợp lệ dạng UUID, không tồn tại). Kiểm được cổng quyền của route và cách trang xử lý "bản ghi không tồn tại" (phải ra màn "Không có quyền xem nội dung này",
      // không phải banner lỗi), nhưng KHÔNG kiểm nội dung trang có dữ liệu thật — muốn kiểm sâu hơn thì tạo dữ liệu mẫu trước.
      id = '019f0000-0000-7000-8000-00000000fa4e';
      console.log(`[params] ${pattern}: chưa có dữ liệu mẫu, dùng id giả`);
    }
    // Mẫu id: `invoices/:encounterId` đi theo lượt khám; ở đây dùng đúng id lấy được.
    out.push('/' + key.replace(/:[A-Za-z]+/, id));
  }
  return out;
}

// ----------------------------------------------------------------- Trình duyệt
const findings = [];

async function login(browser, username) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  const state = { current: null, bad: new Map() };
  page.on('response', (res) => {
    const url = res.url();
    if (!state.current || !url.includes('/api/v1/')) return;
    const s = res.status();
    if (s === 403 || s >= 500) {
      const p = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '').split('?')[0];
      state.bad.set(`${res.request().method()} ${p} -> ${s}`, true);
    }
  });
  await page.goto(WEB + '/login');
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  } catch {
    await ctx.close();
    return null;
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return { ctx, page, state };
}

// Đọc trạng thái trang: API 403/5xx đã thu trong `state.bad`, chữ lỗi, khung cảnh báo.
async function inspect(session, who, route, label, menuHrefs) {
  const { page, state } = session;
  // Bỏ khung báo tĩnh `#boot-fallback` (luôn nằm sẵn trong trang, ẩn; chứa chữ "Không tải được ứng dụng") — nếu không mọi trang đều bị báo nhầm.
  const text = await page.evaluate(() => {
    const clone = (document.querySelector('main') || document.body).cloneNode(true);
    clone.querySelectorAll('#boot-fallback').forEach((e) => e.remove());
    return clone.innerText ?? clone.textContent ?? '';
  });
  const banner = ERROR_TEXT.exec(text)?.[0] ?? null;
  const alerts = await page.$$eval('[role=alert]', (els) => els.filter((e) => !e.closest('#boot-fallback')).map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 90)));
  if (state.bad.size > 0 || banner || alerts.length > 0) {
    findings.push({ who, route: label ? `${route} [${label}]` : route, inMenu: menuHrefs ? menuHrefs.has(route) : false, apis: [...state.bad.keys()], banner: banner ?? alerts[0] ?? '' });
  }
}

async function menuLinks(page) {
  // Mở hết nhóm trong thanh bên để biết những liên kết nào thật sự hiện cho tài khoản này
  for (let i = 0; i < 3; i += 1) {
    const toggles = page.locator('nav button[aria-expanded="false"]');
    const n = await toggles.count();
    for (let k = 0; k < n; k += 1) await toggles.nth(k).click({ timeout: 1000 }).catch(() => {});
  }
  return new Set(await page.$$eval('nav a[href]', (as) => as.map((a) => new URL(a.href).pathname)));
}

// Mở một route, kiểm trang chính rồi bấm lần lượt từng pill và từng tab bên trong. Trả về false nếu route chặn đúng cách bằng trang "Không có quyền".
async function visit(session, who, route, menuHrefs) {
  const { page, state } = session;
  state.bad.clear();
  state.current = route;
  await page.goto(WEB + route, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(500);
  if ((await page.locator('#access-denied-title').count()) > 0) return false;
  await inspect(session, who, route, '', menuHrefs);

  // Thanh "pill" của trang cấu hình (ConfigScreenShell) và tab (role="tab") — mỗi cái là một màn hình con có API riêng.
  for (const [kind, selector] of [
    ['pill', 'main button.rounded-full'],
    ['tab', 'main [role=tab]'],
    // Nút chuyển kiểu xem (SegmentedToggle) — mỗi kiểu có thể gọi API riêng; chỉ trong role=group để KHÔNG bấm nhầm công tắc có tác dụng ghi.
    ['toggle', 'main [role=group] button[aria-pressed]'],
  ]) {
    const labels = await page.$$eval(selector, (bs) => bs.map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()));
    if (labels.length > MAX_TABS_PER_PAGE) console.log(`[quét] ${route}: ${labels.length} ${kind} — chỉ bấm ${MAX_TABS_PER_PAGE} đầu (UI_AUDIT_MAX_PILLS)`);
    for (let k = 0; k < Math.min(labels.length, MAX_TABS_PER_PAGE); k += 1) {
      if (labels[k] === '') continue; // nút tròn không nhãn (nút biểu tượng trong bảng) — không phải thẻ chuyển màn, bấm vào chỉ tốn 2 giây chờ hết hạn
      state.bad.clear();
      const btn = page.locator(selector).nth(k);
      const selected = (await btn.getAttribute('aria-selected', { timeout: 1000 }).catch(() => null)) ?? (await btn.getAttribute('aria-pressed', { timeout: 1000 }).catch(() => null));
      if (selected === 'true' || (kind === 'pill' && k === 0)) continue; // mục đang mở sẵn đã kiểm ở trên
      const tStep = Date.now();
      await btn.click({ timeout: 2000 }).catch(() => {});
      const tClick = Date.now() - tStep;
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      const tIdle = Date.now() - tStep - tClick;
      await page.waitForTimeout(400);
      await inspect(session, who, route, `${kind}: ${labels[k]}`, menuHrefs);
      if (process.env.UI_AUDIT_TRACE) console.log(`[trace] ${route} ${kind} ${k + 1}/${labels.length} "${labels[k]}": click ${tClick}ms, idle ${tIdle}ms, tổng ${Date.now() - tStep}ms`);
    }
  }
  return true;
}

(async () => {
  const cfg = await (await fetch(WEB + '/config.json')).json().catch(() => ({}));
  TENANT = cfg.tenantId || process.env.UI_AUDIT_TENANT;
  if (!TENANT) throw new Error('Không biết mã công ty: đặt UI_AUDIT_TENANT hoặc để /config.json trả tenantId');

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const skipped = [];
  let customRoutesChecked = 0;
  let customRoutesSkipped = 0;

  // ---------------------------------------------------------------- default + params
  if (SECTIONS.includes('default') || SECTIONS.includes('params')) {
    let paramRoutes = [];
    if (SECTIONS.includes('params')) {
      const adminToken = await apiLogin('rl.clinic_admin', PASS);
      paramRoutes = await resolveParamRoutes(adminToken);
    }
    const routes = [...(SECTIONS.includes('default') ? staticRoutes : []), ...paramRoutes];
    for (const role of ROLES) {
      const session = await login(browser, `rl.${role}`);
      if (!session) {
        console.log(`[${role}] KHÔNG đăng nhập được — bỏ qua`);
        continue;
      }
      const menuHrefs = await menuLinks(session.page);
      let done = 0;
      for (const route of routes) {
        await visit(session, role, route, menuHrefs);
        done += 1;
        if (done % 15 === 0) console.log(`[${role}] ${done}/${routes.length} route (${new Date().toLocaleTimeString('vi-VN')})`);
      }
      console.log(`[${role}] xong ${routes.length} route`);
      await session.ctx.close();
    }
  }

  // ---------------------------------------------------------------- custom
  if (SECTIONS.includes('custom')) {
    let adminToken = await apiLogin('rl.clinic_admin', PASS);
    const call = async (p, opts = {}) => {
      let r = await api(p, { ...opts, token: adminToken });
      if (r.status === 401) {
        adminToken = await apiLogin('rl.clinic_admin', PASS);
        r = await api(p, { ...opts, token: adminToken });
      }
      return r;
    };
    // Dọn lần chạy trước còn sót (lọc ĐÚNG tiền tố).
    const staleRoles = ((await call('/roles')).data.items || []).filter((r) => r.name.startsWith(SWEEP_ROLE_PREFIX) && !r.isHidden);
    const staleUsers = (await listAllUsers(call)).filter((u) => u.username.startsWith(SWEEP_USER_PREFIX) && u.isActive);
    console.log(`[custom] dọn trước: ${staleUsers.length} tài khoản ${SWEEP_USER_PREFIX}*, ${staleRoles.length} vai trò ${SWEEP_ROLE_PREFIX}* còn sót`);
    await cleanup(call, staleUsers, staleRoles);

    let entries = [...guardByRoute.entries()].filter(([route]) => !ONLY || route.includes(ONLY));
    if (CUSTOM_LIMIT > 0) entries = entries.slice(0, CUSTOM_LIMIT);
    const created = { roles: [], users: [] };
    let n = 0;
    for (const [route, guard] of entries) {
      n += 1;
      const roleName = `${SWEEP_ROLE_PREFIX}${RUN_ID}-${n}`;
      const username = `${SWEEP_USER_PREFIX}${RUN_ID}${n}`;
      const roleRes = await call('/roles', { method: 'POST', json: { name: roleName } });
      if (roleRes.status !== 200) {
        console.log(`[custom] ${route}: không tạo được vai trò (${roleRes.status})`);
        continue;
      }
      const roleId = roleRes.data.id;
      created.roles.push({ id: roleId, version: roleRes.data.version, name: roleName });
      const matrix = (await call(`/roles/${roleId}/permissions`)).data;
      const key = `${guard.module}.${guard.action}`;
      const want = new Set([key]);
      const own = matrix.permissions.find((p) => `${p.module}.${p.action}` === key);
      if (!own) {
        customRoutesSkipped += 1;
        skipped.push(`${route}: quyền ${key} không có trong danh mục`);
        continue;
      }
      for (const c of own.companions) want.add(c);
      const body = { version: matrix.role.version, entries: matrix.permissions.filter((p) => want.has(`${p.module}.${p.action}`)).map((p) => ({ permissionId: p.permissionId, dataScope: 'global' })) };
      const put = await call(`/roles/${roleId}/permissions`, { method: 'PUT', json: body });
      if (put.status !== 200) {
        console.log(`[custom] ${route}: không gán được quyền (${put.status})`);
        continue;
      }
      const userRes = await call('/users', { method: 'POST', json: { username, password: PASS, fullName: `Sweep ${n}`, displayName: `Sweep ${n}`, roleIds: [roleId] } });
      if (userRes.status !== 200) {
        console.log(`[custom] ${route}: không tạo được tài khoản (${userRes.status} ${JSON.stringify(userRes.body).slice(0, 120)})`);
        continue;
      }
      created.users.push({ id: userRes.data.id, version: userRes.data.version, username });
      const session = await login(browser, username);
      if (!session) {
        console.log(`[custom] ${route}: tài khoản ${username} không đăng nhập được`);
        continue;
      }
      customRoutesChecked += 1;
      if (customRoutesChecked % 10 === 0) console.log(`[custom] ${customRoutesChecked}/${entries.length} vai trò (${new Date().toLocaleTimeString('vi-VN')})`);
      const who = `tuỳ biến(${key}+đi kèm: ${[...want].filter((k) => k !== key).join(',') || 'không'})`;
      try {
        await withTimeout(visit(session, who, route, null), ROUTE_TIMEOUT_MS, route);
      } catch (e) {
        // Một trang đứng hình quá hạn là phát hiện thật (hoặc lỗi môi trường) — ghi lại và đi tiếp, không treo cả lượt quét.
        console.log(`[custom] ${route}: ${e.message}`);
        findings.push({ who, route, inMenu: false, apis: [], banner: e.message });
      }
      await withTimeout(session.ctx.close(), 15000, 'đóng ngữ cảnh trình duyệt').catch(() => {});
    }
    const usersNow = (await listAllUsers(call)).filter((u) => u.username.startsWith(SWEEP_USER_PREFIX) && u.isActive);
    const rolesNow = ((await call('/roles')).data.items || []).filter((r) => r.name.startsWith(SWEEP_ROLE_PREFIX) && !r.isHidden);
    await cleanup(call, usersNow, rolesNow);
  }
  await browser.close();

  if (skipped.length) console.log(`\nBỏ qua (${skipped.length}):\n- ${skipped.join('\n- ')}`);
  if (SECTIONS.includes('custom')) console.log(`\n[custom] đã kiểm ${customRoutesChecked} vai trò tuỳ biến (route khai quyền đơn giản); ${guardByRoute.size} route có quyền đơn giản, route gộp nhiều quyền (RequireAnyPermissionRoute) không phủ.`);

  // Phần custom mà không kiểm được vai trò nào thì KHÔNG được báo ĐẠT (lần chạy 27/10/2026 từng "đạt" suông vì mọi vai trò đều lỗi 409).
  if (SECTIONS.includes('custom') && customRoutesChecked === 0) {
    console.log('LỖI KỊCH BẢN: phần custom không kiểm được vai trò nào — kết quả không có giá trị.');
    process.exitCode = 2;
    return;
  }
  if (findings.length === 0) {
    console.log(`\nKhông trang nào vừa cho vào vừa lỗi quyền. ĐẠT.`);
    return;
  }
  console.log(`\nCÓ ${findings.length} điểm CHO VÀO nhưng gặp lỗi quyền/máy chủ:\n`);
  for (const f of findings) {
    console.log(`- [${f.who}] ${f.route}${f.inMenu ? '  (CÓ trong thanh bên)' : ''}`);
    for (const a of f.apis) console.log(`      ${a}`);
    if (f.banner) console.log(`      khung lỗi: ${f.banner}`);
  }
  process.exitCode = 1;
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e.message);
  process.exit(2);
});

// Khoá tài khoản `sw.*` và ẩn vai trò `sw-sweep-*` (không xoá cứng). Danh sách đã được lọc ĐÚNG tiền tố trước khi gọi; in ra trước khi sửa.
// Duyệt hết các trang của GET /users (phân trang theo cursor, limit tối đa 100; trước đây chỉ thấy 20 tài khoản đầu nên không dọn hết).
async function listAllUsers(call) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const r = await call(`/users?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    all.push(...(r.data.items || []));
    cursor = r.data.nextCursor;
    if (!cursor) break;
  }
  return all;
}

async function cleanup(call, users, roles) {
  if (users.length) console.log(`[custom] khoá tài khoản: ${users.map((u) => u.username).join(', ')}`);
  for (const u of users) {
    if (!u.username.startsWith(SWEEP_USER_PREFIX)) continue;
    const fresh = (await call(`/users/${u.id}`)).data;
    await call(`/users/${u.id}`, { method: 'PATCH', json: { isActive: false, version: fresh.version } });
  }
  // API từ chối ẩn vai trò còn gán cho tài khoản, kể cả tài khoản đã khoá (409 ROLE_IN_USE) — trước đây lỗi này bị nuốt nên vai trò `sw-sweep-*` dồn lại mỗi lần chạy (41 → 161).
  // Gán các tài khoản `sw.*` (đã khoá) sang vai trò hệ thống ÍT quyền nhất trước rồi mới ẩn. Danh sách lọc ĐÚNG tiền tố.
  const allRoles = (await call('/roles')).data.items || [];
  const fallback = allRoles.find((r) => r.isSystemDefault && r.name === 'receptionist') || allRoles.find((r) => r.isSystemDefault);
  const sweepUsers = (await listAllUsers(call)).filter((u) => u.username.startsWith(SWEEP_USER_PREFIX));
  if (fallback) {
    for (const u of sweepUsers) {
      const fresh = (await call(`/users/${u.id}`)).data;
      await call(`/users/${u.id}`, { method: 'PATCH', json: { roleIds: [fallback.id], version: fresh.version } });
    }
  }
  const sweepRoles = allRoles.filter((r) => r.name.startsWith(SWEEP_ROLE_PREFIX));
  if (sweepRoles.length) console.log(`[custom] ẩn ${sweepRoles.length} vai trò ${SWEEP_ROLE_PREFIX}*`);
  let hideFailed = 0;
  for (const r of sweepRoles) {
    const res = await call(`/roles/${r.id}/hide`, { method: 'POST', json: { version: r.version } });
    if (res.status >= 400) hideFailed += 1;
  }
  if (hideFailed) console.log(`[custom] CẢNH BÁO: ${hideFailed} vai trò không ẩn được`);
}
