// Đo thời gian MÁY CHỦ của các endpoint đọc nghi chậm (gọi thẳng API, bỏ giao diện): lần đầu (nguội) và các lần sau, kèm dung lượng phản hồi. Chỉ GET.
// Dùng: node scripts/ui-audit/api-endpoint-timing.cjs [chuỗi-lọc]. Biến môi trường: API (mặc định http://127.0.0.1:3001/api/v1), UI_AUDIT_TENANT, UI_AUDIT_USER, UI_AUDIT_PASS,
// FROM, TO (khoảng ngày của báo cáo, mặc định 2026-09-01..hôm nay), MONTH (mặc định tháng hiện tại).
// Lưu ý: Windows có sàn đo ~15 ms (độ phân giải đồng hồ) nên chỉ tin các số lớn hơn ~30 ms.
const BASE = process.env.API || 'http://127.0.0.1:3001/api/v1';
const TENANT = process.env.UI_AUDIT_TENANT || '01a0cc3c-8626-746b-9d2a-5ea0268ec19f';
const today = new Date().toISOString().slice(0, 10);
const FROM = process.env.FROM || '2026-09-01', TO = process.env.TO || today, MONTH = process.env.MONTH || today.slice(0, 7);
const FILTER = process.argv[2] || '';
const range = `from=${FROM}&to=${TO}`;
const ENDPOINTS = [
  `/reports/revenue/by-period?${range}&groupBy=month`, `/reports/revenue/by-period?${range}&groupBy=day`, `/reports/revenue/by-service?${range}`, `/reports/revenue/by-method?${range}`,
  `/reports/revenue/unpaid?${range}`, `/reports/revenue/by-cashier?${range}`, `/reports/system/overview?${range}`, `/reports/daily?date=${TO}`,
  `/reports/dashboard/owner`, `/reports/quality/incomplete`, `/reports/operations/visit-book?${range}`, `/reports/pharmacy/dispensed?${range}`,
  `/inventory/dispense-queue`, `/inventory/dispense-queue?includeOlder=true`, `/users`, `/work-shift-assignments?month=${MONTH}`, `/inventory/balances`,
  `/inventory/reports/stock-ledger?${range}`, `/drugs`, `/supplier-debt/summaries`, `/cash-book/ledger/accounts`, `/patients?limit=50`,
].filter((e) => !FILTER || e.includes(FILTER));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  const lg = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: process.env.UI_AUDIT_USER || 'dev.admin', password: process.env.UI_AUDIT_PASS || 'Dev@12345' }) });
  const body = await lg.json();
  const cookies = (lg.headers.getSetCookie ? lg.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  const token = body.data && (body.data.accessToken || body.data.token);
  const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookies ? { Cookie: cookies } : {}) };
  console.log(`${'Endpoint'.padEnd(62)} ${'nguội'.padStart(7)} ${'trung vị'.padStart(9)} ${'KB'.padStart(6)} mã`);
  for (const e of ENDPOINTS) {
    const times = []; let kb = 0, status = 0;
    for (let i = 0; i < 6; i++) { const t = performance.now(); const r = await fetch(BASE + e, { headers }); const b = await r.arrayBuffer(); times.push(performance.now() - t); kb = Math.round(b.byteLength / 1024); status = r.status; }
    console.log(`${e.slice(0, 62).padEnd(62)} ${times[0].toFixed(0).padStart(6)}ms ${med(times.slice(1)).toFixed(0).padStart(7)}ms ${String(kb).padStart(6)} ${status}`);
  }
})().catch((e) => { console.error('LỖI', e); process.exit(1); });
