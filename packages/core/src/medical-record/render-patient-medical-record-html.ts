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

/** Đơn pháp lý mang mã chuẩn Bộ Y tế (#242) — nhãn loại đơn lặp lại cố ý như các nhãn khác của file này (file không import gói nào). */
export interface MedicalRecordPrescriptionDocument {
  kind: 'C' | 'N' | 'H' | 'Y';
  nationalCode: string;
}
const PRESCRIPTION_KIND_TEXT: Record<MedicalRecordPrescriptionDocument['kind'], string> = { C: 'thông thường', N: 'gây nghiện', H: 'hướng thần', Y: 'y học cổ truyền' };

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
  /** Chuỗi "Sáng 1 - Chiều 1..." đã format sẵn (docs/DECISIONS.md #196) — resolve ở
   * `EncounterService` bằng `formatDoseSummary()` (`@nexamed/shared`), `packages/core` không import
   * `@nexamed/shared` để tránh phụ thuộc ngược không cần thiết. */
  doseSummary: string;
  /** `null` khi dòng kiểu "Khi cần" (#267) — in dấu gạch ngang. */
  durationDays: number | null;
  quantity: number;
  unitCode: string | null;
  instruction: string | null;
}

/** 1 chỉ số trong kết quả xét nghiệm đã duyệt — `abnormal` (vượt khoảng tham chiếu) in ĐẬM + GẠCH CHÂN, đúng quy ước phiếu kết quả (docs/DECISIONS.md #214). */
export interface MedicalRecordParaclinicalIndicator {
  name: string;
  valueText: string | null;
  referenceText: string;
  unit: string | null;
  abnormal: boolean;
}

/**
 * 1 kết quả cận lâm sàng ĐÃ DUYỆT (bản ký còn hiệu lực — bản đính chính thay bản cũ) của lượt khám, để in vào bệnh án PDF. Kết quả chưa duyệt/đang đính chính không có mặt
 * (chưa phải hồ sơ chính thức). Ảnh đính kèm không nhúng vào PDF — chỉ ghi số lượng, xem ảnh trong hệ thống.
 */
export interface MedicalRecordParaclinicalResult {
  /** Id dòng chỉ định cận lâm sàng — để tab "Hồ sơ bệnh án" (#269) mở đúng phiếu kết quả; bản in PDF không dùng. */
  itemId?: string;
  serviceName: string;
  serviceKind: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  signedAt: string;
  indicators: MedicalRecordParaclinicalIndicator[];
  descriptionText: string | null;
  conclusionText: string | null;
  imageCount: number;
}

/**
 * Điều trị & Hẹn tái khám của lượt khám (docs/DECISIONS.md #222) — in thành mục "Điều trị" sau ghi chú khám; chỉ in dòng nào có nội dung, không có dòng nào thì bỏ cả mục.
 * `followUpDateLabel` đã định dạng sẵn ("Thứ Năm, 15/10/2026").
 */
export interface MedicalRecordTreatment {
  directionLabels: string[];
  content: string;
  advice: string;
  followUpDateLabel: string | null;
}

/** Thẻ BHYT của một lượt khám để in (đã giải mã số thẻ). `selfPay=true` thì các trường thẻ đều `null`. */
export interface MedicalRecordInsurance {
  selfPay: boolean;
  cardNo: string | null;
  /** Khoá mã hoá lệch dữ liệu (#262): có thẻ nhưng không giải mã được → không in dòng BHYT (không được in nhầm "Tự chi trả"). */
  cardNoUnreadable: boolean;
  /** Kiểu thẻ tính ra từ số thẻ (`NEW_12` = thẻ mới 12 số, `OLD_15` = thẻ cũ 15 ký tự). */
  kind: 'NEW_12' | 'OLD_15' | 'UNKNOWN' | null;
  validFrom: string | null;
  validTo: string | null;
  benefitRate: number | null;
  facilityName: string | null;
}

export interface MedicalRecordEncounterEntry {
  encounterNo: string;
  checkedInAt: string;
  doctorName: string | null;
  chiefComplaint: string | null;
  vitalSigns: MedicalRecordVitalSigns | null;
  diagnoses: MedicalRecordDiagnosis[];
  clinicalNoteSections: MedicalRecordClinicalNoteSection[];
  /** Hướng điều trị, nội dung điều trị, lời dặn, hẹn tái khám (bỏ trống = không in mục này). */
  treatment?: MedicalRecordTreatment;
  /** Kết quả cận lâm sàng đã duyệt của lượt khám (bỏ trống/rỗng = không in mục này). */
  paraclinicalResults?: MedicalRecordParaclinicalResult[];
  prescriptionItems: MedicalRecordPrescriptionItem[];
  /** Các đơn pháp lý đã cấp mã chuẩn Bộ Y tế (#242) — bỏ trống/rỗng = không in dòng "Mã đơn" (đơn ký trước ngày bật chế độ chuẩn). */
  prescriptionDocuments?: MedicalRecordPrescriptionDocument[];
  /** Thẻ BHYT đã chụp lúc khám (S2-04, #243) — `null`/bỏ trống = công tắc "Áp dụng BHYT" tắt, không in dòng nào. */
  insurance?: MedicalRecordInsurance | null;
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

/**
 * Tuỳ chọn trình bày lấy từ bản mẫu in `MEDICAL_RECORD` ("Quản lý mẫu in", docs/DECISIONS.md #211) — khai báo cục bộ
 * (không import `@nexamed/shared`, đúng nguyên tắc ở đầu file). Bỏ trống = bố cục mặc định như trước khi có Quản lý mẫu in.
 */
export interface MedicalRecordPrintOptions {
  header: { showClinicName: boolean; showAddress: boolean; showPhone: boolean; showTaxCode: boolean; showDivider: boolean };
  /** Tiêu đề thay cho "Bệnh án bệnh nhân" — `null`/rỗng = giữ mặc định. */
  title: string | null;
  /** Dòng ghi chú cuối bệnh án — `null`/rỗng = không in. */
  footerNote: string | null;
  /** Dòng "Thẻ BHYT" từng lượt khám (ô tích của bản mẫu `MEDICAL_RECORD`, S2-04) — vắng = không in. */
  insurance?: { show: boolean; whenSelfPay: 'hide' | 'selfPay' };
}

const DEFAULT_PRINT_OPTIONS: MedicalRecordPrintOptions = {
  header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true },
  title: null,
  footerNote: null,
};

export interface PatientMedicalRecordDocument {
  clinic: { name: string; address: string | null; phone: string | null; taxCode?: string | null };
  patient: MedicalRecordPatientInfo;
  encounters: MedicalRecordEncounterEntry[];
  generatedAt: string;
  reason: string;
}

const DIAGNOSIS_TYPE_LABEL: Record<MedicalRecordDiagnosisType, string> = { PRIMARY: 'Bệnh chính', SECONDARY: 'Bệnh kèm theo' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Giờ Việt Nam là UTC+7 cố định (không có giờ mùa hè). Mọi mốc thời gian in ra giấy phải theo giờ này — `timestamptz` lưu UTC, chỉ đổi ở tầng hiển thị. */
const VN_OFFSET_MS = 7 * 60 * 60_000;

function formatDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
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

const PARACLINICAL_KIND_LABEL: Record<MedicalRecordParaclinicalResult['serviceKind'], string> = {
  LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh',
  FUNCTIONAL: 'Thăm dò chức năng',
};

function renderTreatment(t: MedicalRecordTreatment | undefined): string {
  if (!t) return '';
  const lines = [
    t.directionLabels.length > 0 ? `<p class="note-section"><strong>Hướng điều trị:</strong> ${t.directionLabels.map(escapeHtml).join('; ')}</p>` : '',
    t.content.trim() ? `<p class="note-section"><strong>Nội dung điều trị:</strong> ${escapeHtml(t.content)}</p>` : '',
    t.advice.trim() ? `<p class="note-section"><strong>Lời dặn bác sĩ:</strong> ${escapeHtml(t.advice)}</p>` : '',
    t.followUpDateLabel ? `<p class="note-section"><strong>Hẹn tái khám:</strong> ${escapeHtml(t.followUpDateLabel)}</p>` : '',
  ].join('');
  return lines ? `<h3>Điều trị</h3>${lines}` : '';
}

function renderParaclinicalResult(r: MedicalRecordParaclinicalResult): string {
  const indicators =
    r.indicators.length > 0
      ? `<table class="data-table"><thead><tr><th>Chỉ số</th><th>Kết quả</th><th>Khoảng tham chiếu</th><th>Đơn vị</th></tr></thead><tbody>${r.indicators
          .map(
            (i) =>
              `<tr><td>${escapeHtml(i.name)}</td><td${i.abnormal ? ' class="abnormal"' : ''}>${i.valueText ? escapeHtml(i.valueText) : '—'}</td><td>${i.referenceText ? escapeHtml(i.referenceText) : '—'}</td><td>${i.unit ? escapeHtml(i.unit) : '—'}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
  const narrative = [
    r.descriptionText ? `<p class="note-section"><strong>${r.indicators.length > 0 ? 'Mô tả' : 'Mô tả hình ảnh'}:</strong> ${escapeHtml(r.descriptionText)}</p>` : '',
    r.conclusionText ? `<p class="note-section"><strong>${r.indicators.length > 0 ? 'Nhận xét' : 'Kết luận'}:</strong> ${escapeHtml(r.conclusionText)}</p>` : '',
    r.imageCount > 0 ? `<p class="meta">Có ${r.imageCount} hình ảnh đính kèm — xem trong hệ thống.</p>` : '',
  ].join('');
  return `<div class="paraclinical-result"><p class="meta"><strong>${escapeHtml(r.serviceName)}</strong> (${PARACLINICAL_KIND_LABEL[r.serviceKind]}) · Duyệt lúc ${formatDateTime(r.signedAt)}</p>${indicators}${narrative}</div>`;
}

function renderParaclinicalResults(results: MedicalRecordParaclinicalResult[] | undefined): string {
  if (!results || results.length === 0) return '';
  return `<h3>Cận lâm sàng</h3>${results.map(renderParaclinicalResult).join('')}`;
}

function renderPrescription(items: MedicalRecordPrescriptionItem[], documents: MedicalRecordPrescriptionDocument[] = []): string {
  if (items.length === 0) return '<p class="muted">Không kê đơn thuốc.</p>';
  const codes =
    documents.length > 0
      ? `<p class="meta">Mã đơn: ${documents.map((d) => `<strong>${escapeHtml(d.nationalCode)}</strong> (${PRESCRIPTION_KIND_TEXT[d.kind]})`).join(' · ')}</p>`
      : '';
  return `${codes}<table class="data-table"><thead><tr><th>Thuốc</th><th>Liều dùng</th><th>Số ngày</th><th>SL</th><th>Cách dùng</th></tr></thead><tbody>${items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.drugName)}</td><td>${escapeHtml(i.doseSummary)}</td><td>${i.durationDays ?? '—'}</td><td>${i.quantity}${i.unitCode ? ` ${escapeHtml(i.unitCode)}` : ''}</td><td>${i.instruction ? escapeHtml(i.instruction) : '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function formatInsuranceLine(insurance: MedicalRecordInsurance | null | undefined, whenSelfPay: 'hide' | 'selfPay'): string | null {
  if (!insurance) return null;
  if (insurance.cardNoUnreadable) return null;
  if (insurance.selfPay || !insurance.cardNo) return whenSelfPay === 'selfPay' ? 'Số thẻ BHYT: Tự chi trả' : null;
  const kindText = insurance.kind === 'NEW_12' ? ' (thẻ mới)' : insurance.kind === 'OLD_15' ? ' (thẻ cũ)' : '';
  const parts = [`Số thẻ BHYT: ${insurance.cardNo}${kindText}`];
  if (insurance.validFrom && insurance.validTo) parts.push(`hiệu lực ${formatDate(insurance.validFrom)} – ${formatDate(insurance.validTo)}`);
  else if (insurance.validTo) parts.push(`đến ${formatDate(insurance.validTo)}`);
  else if (insurance.validFrom) parts.push(`từ ${formatDate(insurance.validFrom)}, chưa rõ hạn`);
  if (insurance.benefitRate !== null) parts.push(`hưởng ${insurance.benefitRate}%`);
  if (insurance.facilityName) parts.push(`nơi ĐK KCB: ${insurance.facilityName}`);
  return parts.join(' · ');
}

function renderEncounter(entry: MedicalRecordEncounterEntry, index: number, insuranceOption: MedicalRecordPrintOptions['insurance']): string {
  const insuranceLine = insuranceOption?.show ? formatInsuranceLine(entry.insurance, insuranceOption.whenSelfPay) : null;
  return `
    <section class="encounter${index > 0 ? ' page-break' : ''}">
      <h2>Lượt khám #${index + 1} — ${formatDateTime(entry.checkedInAt)}</h2>
      <p class="meta">Mã lượt khám: ${escapeHtml(entry.encounterNo)} · Bác sĩ: ${entry.doctorName ? escapeHtml(entry.doctorName) : '—'}${
        entry.signedAt ? ` · Đã ký lúc ${formatDateTime(entry.signedAt)}` : ''
      }</p>
      <p class="meta">Lý do khám: ${entry.chiefComplaint ? escapeHtml(entry.chiefComplaint) : '—'}</p>
      ${insuranceLine ? `<p class="meta">${escapeHtml(insuranceLine)}</p>` : ''}
      <h3>Sinh hiệu</h3>
      ${renderVitalSigns(entry.vitalSigns)}
      <h3>Chẩn đoán</h3>
      ${renderDiagnoses(entry.diagnoses)}
      <h3>Ghi chú khám</h3>
      ${renderClinicalNote(entry.clinicalNoteSections)}
      ${renderParaclinicalResults(entry.paraclinicalResults)}
      ${renderTreatment(entry.treatment)}
      <h3>Đơn thuốc</h3>
      ${renderPrescription(entry.prescriptionItems, entry.prescriptionDocuments)}
    </section>`;
}

export function renderPatientMedicalRecordHtml(doc: PatientMedicalRecordDocument, options: MedicalRecordPrintOptions = DEFAULT_PRINT_OPTIONS): string {
  const { header } = options;
  const clinicMeta = [
    header.showAddress ? doc.clinic.address : null,
    header.showPhone ? doc.clinic.phone : null,
    header.showTaxCode && doc.clinic.taxCode ? `MST: ${doc.clinic.taxCode}` : null,
  ].filter((v): v is string => Boolean(v));
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
  .note-section { margin: 2px 0; white-space: pre-line; }
  .paraclinical-result { margin: 4px 0 8px; page-break-inside: avoid; }
  td.abnormal { font-weight: 700; text-decoration: underline; }
  .meta { color: #475569; font-size: 11px; margin: 2px 0; }
  .muted { color: #94a3b8; font-style: italic; }
  .encounter { margin-top: 14px; }
  .page-break { page-break-before: always; }
  .footer-note { margin-top: 18px; font-style: italic; border-left: 2px solid #94a3b8; padding-left: 8px; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style>
</head>
<body>
  <div class="clinic-header"${header.showDivider ? '' : ' style="border-bottom: none;"'}>
    ${header.showClinicName ? `<div class="clinic-name">${escapeHtml(doc.clinic.name)}</div>` : ''}
    <div class="clinic-meta">${clinicMeta.map(escapeHtml).join(' · ')}</div>
  </div>
  <div class="doc-title">${escapeHtml(options.title?.trim() || 'Bệnh án bệnh nhân')}</div>

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
      ? doc.encounters.map((e, i) => renderEncounter(e, i, options.insurance)).join('')
      : '<p class="muted" style="margin-top:16px;">Bệnh nhân chưa có lượt khám nào đã hoàn tất.</p>'
  }

  ${options.footerNote?.trim() ? `<p class="footer-note">${escapeHtml(options.footerNote.trim())}</p>` : ''}
  <div class="footer">Xuất lúc ${formatDateTime(doc.generatedAt)} · Lý do xuất: ${escapeHtml(doc.reason)}</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bộ hồ sơ bệnh án của MỘT LƯỢT KHÁM (docs/DECISIONS.md #269) — "In bộ hồ sơ" ở tab "Hồ sơ bệnh án": tờ khám theo mẫu bệnh án ngoại trú (QĐ 4069/2001, mục I–X), rồi từng phiếu
// kết quả cận lâm sàng đã duyệt, rồi đơn thuốc, trong MỘT tệp PDF. Khác `renderPatientMedicalRecordHtml` (gộp MỌI lượt khám của bệnh nhân, "Xuất toàn bộ bệnh án").
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EncounterMedicalRecordDocument {
  clinic: { name: string; address: string | null; phone: string | null; taxCode?: string | null };
  patient: MedicalRecordPatientInfo & {
    /** "Khi cần báo tin cho" đã ghép sẵn ("Trần Văn Khoa (chồng) — 0908…"); `null` = chưa có. */
    relative: string | null;
  };
  record: {
    /** "Số bệnh án" (#269); `null` với lượt khám hoàn tất trước khi có tính năng. */
    recordNo: string | null;
    encounterNo: string;
    checkedInAt: string;
    doctorName: string | null;
    departmentName: string | null;
    /** Chỉ có khi công ty có từ 2 chi nhánh; `null` = không in dòng Chi nhánh. */
    branchName: string | null;
    signedAt: string | null;
  };
  insurance?: MedicalRecordInsurance | null;
  vitalSigns: MedicalRecordVitalSigns | null;
  diagnoses: MedicalRecordDiagnosis[];
  notes: { reason: string; illness: string; preliminaryDiagnosis: string; generalExam: string; regionalExam: string; summary: string; prognosis: string; advice: string };
  /** Hướng điều trị + nội dung điều trị + hẹn tái khám (lời dặn nằm ở `notes.advice`, in ở mục X). */
  treatment?: MedicalRecordTreatment;
  paraclinicalResults: MedicalRecordParaclinicalResult[];
  prescriptionItems: MedicalRecordPrescriptionItem[];
  prescriptionDocuments?: MedicalRecordPrescriptionDocument[];
  generatedAt: string;
  reason: string;
}

/** Tuổi (năm) tại thời điểm khám, tính theo ngày Việt Nam — chưa tới sinh nhật trong năm thì chưa tăng tuổi. `dob` là `YYYY-MM-DD`. */
function ageAtYears(dob: string, atIso: string): number {
  const born = new Date(dob);
  const at = new Date(new Date(atIso).getTime() + VN_OFFSET_MS);
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  if (at.getUTCMonth() < born.getUTCMonth() || (at.getUTCMonth() === born.getUTCMonth() && at.getUTCDate() < born.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

function recordProse(text: string): string {
  return text.trim() ? `<p class="note-section">${escapeHtml(text.trim())}</p>` : '<p class="muted">Chưa ghi.</p>';
}

/** Một MỤC của tờ khám: hàng có cột tiêu đề bên trái (số La Mã + tên mục) và nội dung bên phải — cùng khuôn tab "Hồ sơ bệnh án" trên màn hình. */
function recordSection(numeral: string, title: string, body: string): string {
  return `<table class="rec-sec"><tbody><tr><th class="rec-rail"><span class="rec-num">${numeral}</span> ${escapeHtml(title)}</th><td class="rec-body">${body}</td></tr></tbody></table>`;
}

function recordAdminTable(doc: EncounterMedicalRecordDocument, insuranceOption: MedicalRecordPrintOptions['insurance']): string {
  const { patient, record } = doc;
  const insuranceLine = insuranceOption?.show ? formatInsuranceLine(doc.insurance, insuranceOption.whenSelfPay) : null;
  const age = ageAtYears(patient.dob, record.checkedInAt);
  const cell = (label: string, value: string | null | undefined, colspan = 1): string =>
    `<td class="label">${label}</td><td${colspan > 1 ? ` colspan="${colspan}"` : ''}>${value && value.trim() ? escapeHtml(value) : '—'}</td>`;
  return `<table class="patient-info"><tbody>
    <tr>${cell('Số bệnh án', record.recordNo)}${cell('Mã lượt khám', record.encounterNo)}</tr>
    <tr>${cell('Họ và tên', patient.fullName)}${cell('Mã bệnh nhân', patient.patientCode)}</tr>
    <tr>${cell('Năm sinh · Tuổi', `${new Date(patient.dob).getUTCFullYear()} · ${age} tuổi`)}${cell('Giới tính', patient.genderLabel)}</tr>
    <tr>${cell('Nghề nghiệp', patient.occupation)}${cell('Dân tộc / Quốc tịch', [patient.ethnicity, patient.nationality].filter((v): v is string => Boolean(v)).join(' / '))}</tr>
    <tr>${cell('Số CCCD', patient.nationalId)}${cell('Điện thoại', patient.phone)}</tr>
    <tr>${cell('Địa chỉ', patient.address, 3)}</tr>
    <tr>${cell('Khi cần báo tin cho', patient.relative, 3)}</tr>
    ${insuranceLine ? `<tr><td class="label">Thẻ BHYT</td><td colspan="3">${escapeHtml(insuranceLine.replace(/^Số thẻ BHYT:\s*/, ''))}</td></tr>` : ''}
    <tr>${cell('Khoa · Phòng', record.departmentName)}${cell('Bác sĩ khám', record.doctorName)}</tr>
    <tr>${cell('Vào khám lúc', formatDateTime(record.checkedInAt))}${record.branchName ? cell('Chi nhánh', record.branchName) : '<td></td><td></td>'}</tr>
  </tbody></table>`;
}

function recordHistory(doc: EncounterMedicalRecordDocument): string {
  const rows: [string, string][] = [
    ['Bản thân', [doc.patient.conditionNames.join(', '), doc.patient.personalHistory ?? ''].filter(Boolean).join('. ') || 'Không ghi nhận'],
    ['Gia đình', doc.patient.familyHistoryLines.length > 0 ? doc.patient.familyHistoryLines.join('; ') : 'Không ghi nhận'],
    ['Dị ứng', doc.patient.allergenNames.length > 0 ? doc.patient.allergenNames.join(', ') : 'Không ghi nhận'],
  ];
  return `<table class="history-list"><tbody>${rows.map(([label, value]) => `<tr><td class="label">${label}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`;
}

function recordClsSummary(results: MedicalRecordParaclinicalResult[]): string {
  if (results.length === 0) return '<p class="muted">Không có kết quả cận lâm sàng.</p>';
  return `<table class="data-table"><thead><tr><th>Dịch vụ</th><th>Nhận xét / Kết luận</th><th>Duyệt lúc</th></tr></thead><tbody>${results
    .map((r) => `<tr><td>${escapeHtml(r.serviceName)}</td><td>${escapeHtml(r.conclusionText ?? r.descriptionText ?? '—')}</td><td>${formatDateTime(r.signedAt)}</td></tr>`)
    .join('')}</tbody></table><p class="meta">Phiếu kết quả đầy đủ kèm theo ở các trang sau.</p>`;
}

function recordDiagnoses(items: MedicalRecordDiagnosis[]): string {
  if (items.length === 0) return '<p class="muted">Không có chẩn đoán.</p>';
  const ordered = [...items].sort((a, b) => Number(b.type === 'PRIMARY') - Number(a.type === 'PRIMARY'));
  return `<table class="data-table"><thead><tr><th>Loại</th><th>Mã ICD-10</th><th>Tên bệnh</th></tr></thead><tbody>${ordered
    .map((d) => `<tr><td>${DIAGNOSIS_TYPE_LABEL[d.type]}</td><td>${escapeHtml(d.icd10Code)}</td><td>${escapeHtml(d.icd10Name)}${d.note ? ` — ${escapeHtml(d.note)}` : ''}</td></tr>`)
    .join('')}</tbody></table>`;
}

function recordTreatment(doc: EncounterMedicalRecordDocument): string {
  const t = doc.treatment;
  const parts = [
    t && t.directionLabels.length > 0 ? `<p class="note-section"><strong>Hướng điều trị:</strong> ${t.directionLabels.map(escapeHtml).join('; ')}</p>` : '',
    t && t.content.trim() ? `<p class="note-section"><strong>Nội dung điều trị:</strong> ${escapeHtml(t.content.trim())}</p>` : '',
    doc.prescriptionItems.length > 0 ? `<p class="note-section"><strong>Đơn thuốc:</strong> ${doc.prescriptionItems.length} loại thuốc, xem đơn thuốc kèm theo.</p>` : '',
  ].join('');
  return parts || '<p class="muted">Chưa ghi.</p>';
}

export function renderEncounterMedicalRecordHtml(doc: EncounterMedicalRecordDocument, options: MedicalRecordPrintOptions = DEFAULT_PRINT_OPTIONS): string {
  const { header } = options;
  const clinicMeta = [
    header.showAddress ? doc.clinic.address : null,
    header.showPhone ? doc.clinic.phone : null,
    header.showTaxCode && doc.clinic.taxCode ? `MST: ${doc.clinic.taxCode}` : null,
  ].filter((v): v is string => Boolean(v));
  const clinicHeader = `<div class="clinic-header"${header.showDivider ? '' : ' style="border-bottom: none;"'}>
    ${header.showClinicName ? `<div class="clinic-name">${escapeHtml(doc.clinic.name)}</div>` : ''}
    <div class="clinic-meta">${clinicMeta.map(escapeHtml).join(' · ')}</div>
  </div>`;
  const patientLine = `${escapeHtml(doc.patient.fullName)} · Mã BN ${escapeHtml(doc.patient.patientCode)} · Số bệnh án ${escapeHtml(doc.record.recordNo ?? '—')}`;
  const followUp = doc.treatment?.followUpDateLabel ?? null;

  const sheet = `
  ${clinicHeader}
  <div class="doc-title">${escapeHtml(options.title?.trim() || 'Bệnh án ngoại trú')}</div>
  ${recordSection('I', 'Hành chính', recordAdminTable(doc, options.insurance))}
  ${recordSection('II', 'Lý do đến khám', recordProse(doc.notes.reason))}
  ${recordSection(
    'III',
    'Hỏi bệnh',
    `<p class="sub">Quá trình bệnh lý</p>${recordProse(doc.notes.illness)}<p class="sub">Tiền sử</p>${recordHistory(doc)}`,
  )}
  ${recordSection(
    'IV',
    'Khám bệnh',
    `${renderVitalSigns(doc.vitalSigns)}<p class="sub">Toàn thân</p>${recordProse(doc.notes.generalExam)}<p class="sub">Các bộ phận</p>${recordProse(doc.notes.regionalExam)}`,
  )}
  ${recordSection('V', 'Các xét nghiệm cận lâm sàng', recordClsSummary(doc.paraclinicalResults))}
  ${recordSection('VI', 'Tóm tắt bệnh án', recordProse(doc.notes.summary))}
  ${recordSection('VII', 'Chẩn đoán', `<p class="sub">Chẩn đoán sơ bộ</p>${recordProse(doc.notes.preliminaryDiagnosis)}<p class="sub">Chẩn đoán (ICD-10)</p>${recordDiagnoses(doc.diagnoses)}`)}
  ${recordSection('VIII', 'Điều trị', recordTreatment(doc))}
  ${recordSection('IX', 'Tiên lượng', recordProse(doc.notes.prognosis))}
  ${recordSection('X', 'Lời dặn · Hẹn tái khám', `${recordProse(doc.notes.advice)}<p class="note-section"><strong>Hẹn tái khám:</strong> ${followUp ? escapeHtml(followUp) : 'Không hẹn'}</p>`)}
  <table class="sign"><tbody><tr><td></td><td class="sign-box"><div class="meta">Bác sĩ khám bệnh</div><div class="sign-space"></div><strong>${doc.record.doctorName ? escapeHtml(doc.record.doctorName) : '—'}</strong>${
    doc.record.signedAt ? `<div class="meta">${formatDateTime(doc.record.signedAt)}</div>` : ''
  }</td></tr></tbody></table>`;

  const clsSheets = doc.paraclinicalResults
    .map(
      (r) => `<section class="page-break">
    ${clinicHeader}
    <div class="doc-title">Phiếu kết quả ${escapeHtml(PARACLINICAL_KIND_LABEL[r.serviceKind].toLowerCase())}</div>
    <p class="meta">${patientLine}</p>
    ${renderParaclinicalResult(r)}
  </section>`,
    )
    .join('');

  const prescriptionSheet =
    doc.prescriptionItems.length > 0
      ? `<section class="page-break">
    ${clinicHeader}
    <div class="doc-title">Đơn thuốc</div>
    <p class="meta">${patientLine}</p>
    <p class="meta">Chẩn đoán: ${doc.diagnoses.length > 0 ? doc.diagnoses.map((d) => `${escapeHtml(d.icd10Code)} ${escapeHtml(d.icd10Name)}`).join('; ') : '—'}</p>
    ${renderPrescription(doc.prescriptionItems, doc.prescriptionDocuments)}
    ${doc.notes.advice.trim() ? `<p class="note-section"><strong>Lời dặn:</strong> ${escapeHtml(doc.notes.advice.trim())}</p>` : ''}
    ${followUp ? `<p class="note-section"><strong>Hẹn tái khám:</strong> ${escapeHtml(followUp)}</p>` : ''}
  </section>`
      : '';

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Hồ sơ bệnh án — ${escapeHtml(doc.patient.fullName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 24px; }
  .clinic-header { text-align: center; margin-bottom: 12px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
  .clinic-header .clinic-name { font-size: 15px; font-weight: 700; }
  .clinic-header .clinic-meta { font-size: 11px; color: #475569; }
  .doc-title { text-align: center; font-size: 16px; font-weight: 700; margin: 10px 0 12px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  table.rec-sec { border: 1px solid #94a3b8; margin-top: -1px; page-break-inside: avoid; }
  .rec-rail { width: 150px; background: #f1f5f9; border-right: 1px solid #94a3b8; padding: 7px 9px; text-align: left; vertical-align: top; font-size: 12px; font-weight: 700; }
  .rec-num { display: inline-block; min-width: 20px; padding: 0 4px; margin-right: 4px; border-radius: 3px; background: #1d4ed8; color: #fff; text-align: center; font-size: 11px; }
  .rec-body { padding: 7px 10px; vertical-align: top; }
  .rec-body .sub { font-weight: 600; color: #334155; margin: 6px 0 2px; }
  .rec-body .sub:first-child { margin-top: 0; }
  table.patient-info td { padding: 2px 6px; vertical-align: top; }
  table.patient-info td.label { font-weight: 600; width: 120px; color: #334155; }
  table.history-list td { padding: 2px 6px; vertical-align: top; }
  table.history-list td.label { font-weight: 600; width: 80px; color: #334155; }
  table.vitals td, table.data-table th, table.data-table td { border: 1px solid #cbd5e1; padding: 4px 6px; font-size: 11px; }
  table.data-table th { background: #eff6ff; text-align: left; }
  .vitals-label { font-weight: 600; background: #f8fafc; width: 90px; }
  .note-section { margin: 2px 0; white-space: pre-line; }
  .paraclinical-result { margin: 4px 0 8px; page-break-inside: avoid; }
  td.abnormal { font-weight: 700; text-decoration: underline; }
  .meta { color: #475569; font-size: 11px; margin: 2px 0; }
  .muted { color: #94a3b8; font-style: italic; margin: 2px 0; }
  table.sign { margin-top: 14px; page-break-inside: avoid; }
  table.sign td.sign-box { width: 220px; text-align: center; }
  .sign-space { height: 36px; }
  .page-break { page-break-before: always; }
  .footer-note { margin-top: 18px; font-style: italic; border-left: 2px solid #94a3b8; padding-left: 8px; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style>
</head>
<body>
  ${sheet}
  ${clsSheets}
  ${prescriptionSheet}
  ${options.footerNote?.trim() ? `<p class="footer-note">${escapeHtml(options.footerNote.trim())}</p>` : ''}
  <div class="footer">Xuất lúc ${formatDateTime(doc.generatedAt)} · Lý do xuất: ${escapeHtml(doc.reason)}</div>
</body>
</html>`;
}
