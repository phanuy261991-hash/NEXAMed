/* global process, console, fetch */
// Dựng 7 tài khoản `rl.<vai trò>` (mật khẩu 12345678, mỗi tài khoản một vai trò mặc định) cho `role-access-sweep.cjs` — chỉ TẠO, không sửa/xoá gì có sẵn; chạy lại không tạo trùng
// (tài khoản `rl.*` đã có thì bỏ qua). Dùng API bằng quản trị (không SQL). KHÔNG dùng cho công ty thật: chỉ công ty thử/dev.
// Biến môi trường: UI_AUDIT_API (mặc định http://localhost:3001), UI_AUDIT_TENANT (bắt buộc nếu không đọc được /config.json), UI_AUDIT_ADMIN_USER/UI_AUDIT_ADMIN_PASS (mặc định dev.admin / Dev@12345).
const API = `${process.env.UI_AUDIT_API || 'http://localhost:3001'}/api/v1`;
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const PASS = process.env.UI_AUDIT_PASS || '12345678';
const ADMIN_USER = process.env.UI_AUDIT_ADMIN_USER || 'dev.admin';
const ADMIN_PASS = process.env.UI_AUDIT_ADMIN_PASS || 'Dev@12345';
const ROLE_CODES = ['receptionist', 'doctor', 'nurse', 'lab_technician', 'imaging_technician', 'clinic_admin', 'system_admin'];

async function call(path, { method = 'GET', token, json } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body && body.data !== undefined ? body.data : body, body };
}

(async () => {
  let tenantId = process.env.UI_AUDIT_TENANT;
  if (!tenantId) tenantId = (await (await fetch(`${WEB}/config.json`)).json().catch(() => ({}))).tenantId;
  if (!tenantId) throw new Error('Không biết mã công ty: đặt UI_AUDIT_TENANT');
  const login = await call('/auth/login', { method: 'POST', json: { tenantId, username: ADMIN_USER, password: ADMIN_PASS } });
  if (login.status !== 200) throw new Error(`Đăng nhập quản trị lỗi ${login.status}`);
  const token = login.data.accessToken;

  const roles = (await call('/roles?limit=200', { token })).data.items ?? [];
  const roleByCode = new Map(roles.map((r) => [r.code ?? r.name, r]));
  let created = 0;
  for (const code of ROLE_CODES) {
    const username = `rl.${code}`;
    const role = roleByCode.get(code) ?? roles.find((r) => String(r.name).toLowerCase() === code);
    if (!role) {
      console.log(`BỎ QUA  ${username}: không thấy vai trò "${code}" (có: ${roles.map((r) => r.code ?? r.name).join(', ')})`);
      continue;
    }
    const exists = await call('/auth/login', { method: 'POST', json: { tenantId, username, password: PASS } });
    if (exists.status === 200) {
      console.log(`CÓ SẴN  ${username}`);
      continue;
    }
    const res = await call('/users', { method: 'POST', token, json: { username, password: PASS, fullName: `Quét quyền ${code}`, displayName: `Quét quyền ${code}`, roleIds: [role.id] } });
    if (res.status === 200 || res.status === 201) {
      created += 1;
      console.log(`ĐÃ TẠO  ${username} (${role.name})`);
    } else {
      console.log(`LỖI     ${username}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    }
  }
  console.log(`Xong: tạo mới ${created}/${ROLE_CODES.length}.`);
})().catch((e) => { console.error('LỖI', e.message); process.exit(1); });
