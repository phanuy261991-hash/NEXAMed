const { state, call, raw } = require('./hh-lib.cjs');
const { TENANT } = require('./hh-lib.cjs');
(async () => {
  const r = await raw('POST', '/auth/login', { tenantId: TENANT, username: 'hoangnam', password: 'TamThoi@HoaHung1' }, '');
  if (r.status !== 200) { console.log('đăng nhập tạm thời không được (có thể đã đổi):', r.status); return; }
  const c = await raw('POST', '/auth/change-password', { currentPassword: 'TamThoi@HoaHung1', newPassword: 'HoaHung@2026' }, r.data.accessToken);
  console.log('đổi mật khẩu quản trị:', c.status);
})();
