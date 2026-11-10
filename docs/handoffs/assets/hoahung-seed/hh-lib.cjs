/* global process, console, fetch */
// Thư viện dùng chung cho các script dựng dữ liệu phòng khám Hòa Hưng (chỉ qua HTTP API chính thức, không SQL).
const API = process.env.HH_API || 'http://localhost:3001/api/v1';
const TENANT = '01a1c100-5884-7bdb-8558-0981f8cbf306';
const state = { token: '' };

async function raw(method, path, body, token = state.token) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, json, data: json && json.data !== undefined ? json.data : json };
}
async function call(method, path, body, token) {
  const r = await raw(method, path, body, token);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 2500)}`);
  return r.data;
}
async function login(username, password) {
  const r = await raw('POST', '/auth/login', { tenantId: TENANT, username, password }, '');
  if (r.status !== 200) throw new Error(`đăng nhập ${username} → ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.data;
}
module.exports = { API, TENANT, state, raw, call, login };
