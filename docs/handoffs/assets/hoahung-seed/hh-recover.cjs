/* global console */
// Hoàn tất các lượt khám có 2 dịch vụ xét nghiệm cùng phiếu (phải gửi kết quả của cả nhóm trong MỘT lần).
const V = require('./hh-visit.cjs');
const RESULTS = {
  WBC: [7.2, 8.6], RBC: [4.8, 4.5], HGB: [142, 128], HCT: [43, 41], PLT: [265, 310], GLU: [5.4, 7.8], HbA1c: [5.6, 7.2], AST: [28, 36], ALT: [24, 41],
  UREA: [4.8, 5.6], CREA: [82, 94], CHOL: [4.9, 6.1], TG: [1.4, 2.6], HDL: [1.3, 1.1], LDL: [2.8, 3.9],
};
(async () => {
  const ctx = await V.context();
  const byId = Object.fromEntries(Object.values(ctx.services).map((s) => [s.id, s]));
  const l = await V.api('letan.thuha', 'GET', '/reception/list');
  const encs = (l.items || l).filter((e) => e.status === 'IN_CONSULTATION');
  let fixed = 0;
  for (const e of encs) {
    const doctor = Object.values(ctx.users).find((u) => u.id === e.doctorId).username;
    const co = await V.api(doctor, 'GET', `/encounters/${e.encounterId}/clinical-orders`).catch(() => null);
    const order = co && (co.order || co);
    const items = (order && order.items) || [];
    const open = items.filter((i) => i.status === 'IN_PROGRESS');
    if (open.length === 0) continue;
    console.log('xử lý', e.fullName, open.length, 'dịch vụ');
    const sections = [];
    for (const item of open) {
      const svc = byId[item.technicalServiceId];
      const detail = await V.api('hoangnam', 'GET', `/technical-services/${svc.id}`);
      const values = (detail.indicators || []).map((ind) => {
        const abbr = ind.abbreviation || ind.indicatorAbbreviation;
        const base = RESULTS[abbr];
        const v = base ? base[0] : 'Âm tính';
        return { indicatorId: ind.indicatorId || ind.id, valueText: typeof v === 'number' ? String(v.toFixed(ind.decimals ?? 1)).replace('.', ',') : v };
      });
      sections.push({ itemId: item.id, values });
    }
    const body = { sections, submit: true };
    await V.api('xn.minhkhang', 'PUT', `/paraclinical/lab/items/${open[0].id}/result`, body);
    await V.api(doctor, 'POST', `/paraclinical/lab/items/${open[0].id}/result/approve`, body);
    await V.complete(doctor, e.encounterId);
    fixed += 1;
  }
  console.log('đã hoàn tất', fixed, 'lượt');
})().catch((e) => { console.error('LỖI', e.message.slice(0, 600)); process.exit(1); });
