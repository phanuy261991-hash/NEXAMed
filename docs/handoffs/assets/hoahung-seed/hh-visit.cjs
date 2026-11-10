/* global console */
// Thư viện lượt khám cho Phòng khám Hòa Hưng: tiếp nhận → thu tiền → khám → kê đơn → cận lâm sàng → hoàn tất. Mỗi vai trò dùng token của đúng người thật.
const { call, raw, login } = require('./hh-lib.cjs');
const PASS = 'HoaHung@2026';
const tokens = {};
async function as(username) {
  if (!tokens[username]) tokens[username] = (await login(username, username === 'hoangnam' ? 'HoaHung@2026' : PASS)).accessToken;
  return tokens[username];
}
const api = async (user, method, path, body) => call(method, path, body, await as(user));
const list = async (user, p) => { const d = await api(user, 'GET', p); return d.items || d; };

async function context() {
  const exam = await list('hoangnam', '/reference-catalog/EXAM_TYPE');
  const rec = await list('hoangnam', '/reference-catalog/RECEPTION_TYPE');
  const form = await list('hoangnam', '/reference-catalog/EXAM_FORM');
  const src = await list('hoangnam', '/reference-catalog/PATIENT_SOURCE');
  const users = await list('hoangnam', '/users');
  const drugs = await list('hoangnam', '/drugs?limit=200');
  const services = await list('hoangnam', '/technical-services?limit=100');
  const lượt = (await list('hoangnam', '/reference-catalog/UNIT')).find((u) => u.name === 'Lượt').code;
  return { exam: Object.fromEntries(exam.map((e) => [e.name, e])), rec: Object.fromEntries(rec.map((e) => [e.name, e.code])), form: Object.fromEntries(form.map((e) => [e.name, e.code])), src: Object.fromEntries(src.map((e) => [e.name, e.code])), users: Object.fromEntries(users.map((u) => [u.username, u])), drugs: Object.fromEntries(drugs.map((d) => [d.code, d])), services: Object.fromEntries(services.map((s) => [s.name, s])), lượt };
}

/** Tiếp nhận trực tiếp + thu tiền khám. `pay`: 'CASH' | 'BANK_TRANSFER' | null (chưa thu). */
async function receive(ctx, { receptionist, patient, doctor, examName, complaint, vitals = {}, pay = 'CASH', receptionType = 'Khám mới', source = 'Tự đến' }) {
  const ex = ctx.exam[examName];
  const price = { 'Khám Nội tổng quát': 150000, 'Khám Nhi': 150000, 'Khám Tai Mũi Họng': 150000, 'Tái khám': 80000 }[examName];
  const enc = await api(receptionist, 'POST', '/reception/direct', {
    patientId: patient.id, doctorId: ctx.users[doctor].id, checkedInAt: new Date().toISOString(), chiefComplaint: complaint,
    receptionTypeCode: ctx.rec[receptionType], examFormCode: ctx.form['Khám thường'], patientSourceCode: ctx.src[source],
    services: [{ examTypeCode: ex.code, examTypeName: ex.name, examTypePrice: price, priceTypeCode: 'THUONG', unitCode: ctx.lượt, quantity: 1 }], ...vitals,
  });
  if (pay) await payInvoice(receptionist, enc.id, pay);
  return enc;
}
async function payInvoice(receptionist, encounterId, method) {
  // Thu hoá đơn chính rồi mọi hoá đơn phát sinh riêng (cận lâm sàng, thuốc) còn chưa thu.
  let inv = await api(receptionist, 'GET', `/billing/invoices/${encounterId}`);
  if (inv.status !== 'PAID') inv = await api(receptionist, 'POST', `/billing/invoices/${encounterId}/pay`, { method, version: inv.version });
  const main = await api(receptionist, 'GET', `/billing/invoices/${encounterId}`);
  for (const other of main.otherInvoices || []) {
    if (other.status === 'PAID') continue;
    const detail = await api(receptionist, 'GET', `/billing/invoices/${encounterId}?invoiceId=${other.invoiceId}`);
    await api(receptionist, 'POST', `/billing/invoices/${encounterId}/pay`, { invoiceId: other.invoiceId, method, version: detail.version });
  }
  return main;
}
async function consult(doctor, encounterId) { return api(doctor, 'GET', `/encounters/${encounterId}/consultation`); }
async function start(doctor, encounterId) {
  const c = await consult(doctor, encounterId);
  const v = c.encounter ? c.encounter.version : c.version;
  return api(doctor, 'POST', `/encounters/${encounterId}/start`, { version: v });
}
async function note(doctor, encounterId, n) {
  const sec = (content) => ({ content });
  return api(doctor, 'PUT', `/encounters/${encounterId}/clinical-note`, {
    reasonForVisit: sec(n.reason), illnessProgress: sec(n.progress), preliminaryDiagnosis: sec(n.preliminary), generalExam: sec(n.general), regionalExam: sec(n.regional), plan: sec(n.plan),
    ...(n.advice ? { doctorAdvice: sec(n.advice) } : {}),
  });
}
const diagnoses = (doctor, encounterId, list2) => api(doctor, 'PUT', `/encounters/${encounterId}/diagnoses`, { diagnoses: list2 });
async function prescribe(doctor, encounterId, ctx, rows, advice) {
  const items = rows.map(([code, qty, days, morning, noon, afternoon, evening, instruction]) => ({ drugId: ctx.drugs[code].id, quantity: qty, durationDays: days, doseMorning: morning, doseNoon: noon, doseAfternoon: afternoon, doseEvening: evening, ...(instruction ? { instruction } : {}) }));
  const saved = await api(doctor, 'PUT', `/encounters/${encounterId}/prescription-items`, { items, ...(advice ? { doctorAdvice: advice } : {}) });
  return saved;
}
async function sign(doctor, encounterId, version) { return api(doctor, 'POST', `/encounters/${encounterId}/prescription/sign`, { version }); }
async function complete(doctor, encounterId) {
  const c = await consult(doctor, encounterId);
  return api(doctor, 'POST', `/encounters/${encounterId}/complete`, { version: c.encounter ? c.encounter.version : c.version });
}
module.exports = { as, api, list, context, receive, payInvoice, consult, start, note, diagnoses, prescribe, sign, complete };
