/**
 * S6-06 (ADM-05) — sinh chuỗi HTML cho "Xuất bệnh án PDF" của MỘT bệnh nhân, gồm thông tin hành
 * chính + tiền sử + toàn bộ lượt khám COMPLETED theo thời gian. Hàm THUẦN (không I/O, không
 * Prisma/NestJS) — `apps/api` gọi hàm này rồi đưa chuỗi HTML qua `PdfRendererPort` để in ra PDF
 * thật (Puppeteer/Chromium). Không dùng lại các component React của `apps/web` (những component
 * đó render trong TRÌNH DUYỆT NGƯỜI DÙNG qua `window.print()`; ở đây HTML chạy trong Chromium nội
 * bộ không tải Tailwind, nên phải tự chứa toàn bộ CSS).
 *
 * Nhãn/phân loại lặp lại một phần nhỏ so với `apps/web/src/features/encounter/clinical-display.tsx`
 * (loại chẩn đoán, tên 6 mục SOAP, phân loại BMI) — CỐ Ý không trích xuất dùng chung: hai nơi render
 * hoàn toàn khác công nghệ (JSX/Tailwind chạy trong trình duyệt người dùng vs. chuỗi HTML tĩnh chạy
 * trong Chromium nội bộ của server), không phải cùng một "component" theo nghĩa CLAUDE.md.
 */

export type MedicalRecordDiagnosisType = 'PRIMARY' | 'SECONDARY';

export interface MedicalRecordVitalSigns {
  measuredAt: string;
  pulse: number | null;
  temperatureC: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  weightGram: number | null;
  heightMm: number | null;
}

export interface MedicalRecordDiagnosis {
  icd10Code: string;
  icd10Name: string;
  type: MedicalRecordDiagnosisType;
  note: string | null;
}

export interface MedicalRecordClinicalNoteSection {
  label: string;
  content: string;
}

export interface MedicalRecordPrescriptionItem {
  drugName: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
}

export interface MedicalRecordEncounterEntry {
  encounterNo: string;
  checkedInAt: string;
  doctorName: string | null;
  chiefComplaint: string | null;
  vitalSigns: MedicalRecordVitalSigns | null;
  diagnoses: MedicalRecordDiagnosis[];
  clinicalNoteSections: MedicalRecordClinicalNoteSection[];
  prescriptionItems: MedicalRecordPrescriptionItem[];
  signedAt: string | null;
}

export interface MedicalRecordPatientInfo {
  patientCode: string;
  fullName: string;
  dob: string;
  genderLabel: string;
  phone: string;
  address: string | null;
  nationalId: string | null;
  occupation: string | null;
  ethnicity: string | null;
  nationality: string | null;
  personalHistory: string | null;
  allergenNames: string[];
  conditionNames: string[];
  familyHistoryLines: string[];
}

export interface PatientMedicalRecordDocument {
  clinic: { name: string; address: string | null; phone: string | null };
  patient: MedicalRecordPatientInfo;
  encounters: MedicalRecordEncounterEntry[];
  generatedAt: string;
  reason: string;
}

const DIAGNOSIS_TYPE_LABEL: Record<MedicalRecordDiagnosisType, string> = { PRIMARY: 'Bệnh chính', SECONDARY: 'Bệnh kèm theo' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function renderVitalSigns(v: MedicalRecordVitalSigns | null): string {
  if (!v) return '<p class="muted">Chưa có sinh hiệu ghi nhận cho lượt khám này.</p>';
  const bmi =
    v.weightGram && v.heightMm ? v.weightGram / 1000 / ((v.heightMm / 1000) * (v.heightMm / 1000)) : null;
  const cells = [
    ['Mạch', v.pulse != null ? `${v.pulse} lần/phút` : '—'],
    ['Nhiệt độ', v.temperatureC != null ? `${v.temperatureC.toFixed(1)} °C` : '—'],
    ['Huyết áp', v.bpSystolic != null && v.bpDiastolic != null ? `${v.bpSystolic}/${v.bpDiastolic} mmHg` : '—'],
    ['Nhịp thở', v.respiratoryRate != null ? `${v.respiratoryRate} lần/phút` : '—'],
    ['SpO2', v.spo2 != null ? `${v.spo2}%` : '—'],
    ['Cân nặng', v.weightGram != null ? `${(v.weightGram / 1000).toFixed(1)} kg` : '—'],
    ['Chiều cao', v.heightMm != null ? `${(v.heightMm / 10).toFixed(1)} cm` : '—'],
    ['BMI', bmi != null ? bmi.toFixed(1) : '—'],
  ];
  return `<table class="vitals"><tbody>${cells
    .map(([label, value]) => `<tr><td class="vitals-label">${label}</td><td class="vitals-value">${value}</td></tr>`)
    .join('')}</tbody></table>`;
}

function renderDiagnoses(items: MedicalRecordDiagnosis[]): string {
  if (items.length === 0) return '<p class="muted">Không có chẩn đoán.</p>';
  return `<table class="data-table"><thead><tr><th>Loại</th><th>Mã ICD-10</th><th>Tên bệnh</th><th>Ghi chú</th></tr></thead><tbody>${items
    .map(
      (d) =>
        `<tr><td>${DIAGNOSIS_TYPE_LABEL[d.type]}</td><td>${escapeHtml(d.icd10Code)}</td><td>${escapeHtml(d.icd10Name)}</td><td>${d.note ? escapeHtml(d.note) : '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function renderClinicalNote(sections: MedicalRecordClinicalNoteSection[]): string {
  const withContent = sections.filter((s) => s.content.trim().length > 0);
  if (withContent.length === 0) return '<p class="muted">Chưa có ghi chú khám.</p>';
  return withContent.map((s) => `<p class="note-section"><strong>${escapeHtml(s.label)}:</strong> ${escapeHtml(s.content)}</p>`).join('');
}

function renderPrescription(items: MedicalRecordPrescriptionItem[]): string {
  if (items.length === 0) return '<p class="muted">Không kê đơn thuốc.</p>';
  return `<table class="data-table"><thead><tr><th>Thuốc</th><th>Liều dùng</th><th>Tần suất</th><th>Số ngày</th><th>SL</th><th>Cách dùng</th></tr></thead><tbody>${items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.drugName)}</td><td>${escapeHtml(i.dose)}</td><td>${escapeHtml(i.frequency)}</td><td>${i.durationDays}</td><td>${i.quantity}</td><td>${i.instruction ? escapeHtml(i.instruction) : '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function renderEncounter(entry: MedicalRecordEncounterEntry, index: number): string {
  return `
    <section class="encounter${index > 0 ? ' page-break' : ''}">
      <h2>Lượt khám #${index + 1} — ${formatDateTime(entry.checkedInAt)}</h2>
      <p class="meta">Mã lượt khám: ${escapeHtml(entry.encounterNo)} · Bác sĩ: ${entry.doctorName ? escapeHtml(entry.doctorName) : '—'}${
        entry.signedAt ? ` · Đã ký lúc ${formatDateTime(entry.signedAt)}` : ''
      }</p>
      <p class="meta">Lý do khám: ${entry.chiefComplaint ? escapeHtml(entry.chiefComplaint) : '—'}</p>
      <h3>Sinh hiệu</h3>
      ${renderVitalSigns(entry.vitalSigns)}
      <h3>Chẩn đoán</h3>
      ${renderDiagnoses(entry.diagnoses)}
      <h3>Ghi chú khám</h3>
      ${renderClinicalNote(entry.clinicalNoteSections)}
      <h3>Đơn thuốc</h3>
      ${renderPrescription(entry.prescriptionItems)}
    </section>`;
}

export function renderPatientMedicalRecordHtml(doc: PatientMedicalRecordDocument): string {
  const history: [string, string][] = [
    ['Tiền sử dị ứng', doc.patient.allergenNames.length > 0 ? doc.patient.allergenNames.join(', ') : 'Không ghi nhận'],
    ['Bệnh lý nền', doc.patient.conditionNames.length > 0 ? doc.patient.conditionNames.join(', ') : 'Không ghi nhận'],
    ['Tiền sử gia đình', doc.patient.familyHistoryLines.length > 0 ? doc.patient.familyHistoryLines.join('; ') : 'Không ghi nhận'],
    ['Tiền sử bản thân', doc.patient.personalHistory ?? 'Không ghi nhận'],
  ];

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Bệnh án — ${escapeHtml(doc.patient.fullName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 6px; border-bottom: 2px solid #1d4ed8; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 10px 0 4px; color: #1e3a8a; }
  .clinic-header { text-align: center; margin-bottom: 16px; border-bottom: 1px solid #cbd5e1; padding-bottom: 10px; }
  .clinic-header .clinic-name { font-size: 15px; font-weight: 700; }
  .clinic-header .clinic-meta { font-size: 11px; color: #475569; }
  .doc-title { text-align: center; font-size: 16px; font-weight: 700; margin: 12px 0; text-transform: uppercase; }
  .patient-info { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .patient-info td { padding: 3px 6px; vertical-align: top; }
  .patient-info td.label { font-weight: 600; width: 140px; color: #334155; }
  .history-list td.label { font-weight: 600; width: 160px; color: #334155; vertical-align: top; }
  .history-list td { padding: 3px 6px; }
  table.vitals, table.data-table, table.history-list, table.patient-info { width: 100%; border-collapse: collapse; }
  table.vitals td, table.data-table th, table.data-table td { border: 1px solid #cbd5e1; padding: 4px 6px; font-size: 11px; }
  table.data-table th { background: #eff6ff; text-align: left; }
  .vitals-label { font-weight: 600; background: #f8fafc; width: 90px; }
  .note-section { margin: 2px 0; }
  .meta { color: #475569; font-size: 11px; margin: 2px 0; }
  .muted { color: #94a3b8; font-style: italic; }
  .encounter { margin-top: 14px; }
  .page-break { page-break-before: always; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style>
</head>
<body>
  <div class="clinic-header">
    <div class="clinic-name">${escapeHtml(doc.clinic.name)}</div>
    <div class="clinic-meta">${[doc.clinic.address, doc.clinic.phone].filter((v): v is string => Boolean(v)).map(escapeHtml).join(' · ')}</div>
  </div>
  <div class="doc-title">Bệnh án bệnh nhân</div>

  <table class="patient-info">
    <tbody>
      <tr><td class="label">Họ và tên</td><td>${escapeHtml(doc.patient.fullName)}</td><td class="label">Mã bệnh nhân</td><td>${escapeHtml(doc.patient.patientCode)}</td></tr>
      <tr><td class="label">Ngày sinh</td><td>${formatDate(doc.patient.dob)}</td><td class="label">Giới tính</td><td>${escapeHtml(doc.patient.genderLabel)}</td></tr>
      <tr><td class="label">Điện thoại</td><td>${escapeHtml(doc.patient.phone)}</td><td class="label">CCCD</td><td>${doc.patient.nationalId ? escapeHtml(doc.patient.nationalId) : '—'}</td></tr>
      <tr><td class="label">Địa chỉ</td><td colspan="3">${doc.patient.address ? escapeHtml(doc.patient.address) : '—'}</td></tr>
      <tr><td class="label">Nghề nghiệp</td><td>${doc.patient.occupation ? escapeHtml(doc.patient.occupation) : '—'}</td><td class="label">Dân tộc / Quốc tịch</td><td>${[doc.patient.ethnicity, doc.patient.nationality].filter((v): v is string => Boolean(v)).map(escapeHtml).join(' / ') || '—'}</td></tr>
    </tbody>
  </table>

  <h2>Tiền sử</h2>
  <table class="history-list"><tbody>
    ${history.map(([label, value]) => `<tr><td class="label">${label}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
  </tbody></table>

  ${
    doc.encounters.length > 0
      ? doc.encounters.map((e, i) => renderEncounter(e, i)).join('')
      : '<p class="muted" style="margin-top:16px;">Bệnh nhân chưa có lượt khám nào đã hoàn tất.</p>'
  }

  <div class="footer">Xuất lúc ${formatDateTime(doc.generatedAt)} · Lý do xuất: ${escapeHtml(doc.reason)}</div>
</body>
</html>`;
}
