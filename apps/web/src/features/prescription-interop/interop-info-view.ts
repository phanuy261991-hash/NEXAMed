import type { EncounterInteropKind, InteropKindInfoValue, InteropProblemDto, InteropSubmissionStatus, PrescriptionKind } from '@nexamed/shared';

/**
 * Logic THUẦN của khối "Thông tin liên thông đơn thuốc quốc gia" ở màn kê đơn (docs/DECISIONS.md #242 GĐ3, mockup 8a/8b) — tách khỏi component để test được.
 * Bản nháp ô nhập giữ dạng CHUỖI (đúng thứ người dùng gõ); `draftToValue` đổi sang giá trị gửi lên máy chủ.
 */
export interface KindDraft {
  treatmentFormCode: string;
  dosePeriodNumber: string;
  doseFrom: string;
  doseTo: string;
  herbalDoses: string;
  herbalInstruction: string;
}

export const EMPTY_KIND_DRAFT: KindDraft = { treatmentFormCode: '', dosePeriodNumber: '', doseFrom: '', doseTo: '', herbalDoses: '', herbalInstruction: '' };

/** Ô nào hiện với loại đơn nào (tài liệu QĐ 808): C = hình thức điều trị; N/H/Y = đợt dùng thuốc; Y = thêm số thang + cách sắc/uống. */
export function kindUsesTreatmentForm(kind: PrescriptionKind): boolean {
  return kind === 'C';
}
export function kindUsesDosePeriod(kind: PrescriptionKind): boolean {
  return kind !== 'C';
}
export function kindUsesHerbal(kind: PrescriptionKind): boolean {
  return kind === 'Y';
}

/** Bản nháp ban đầu: giá trị ĐÃ LƯU, ô đợt dùng thuốc chưa nhập thì lấy gợi ý tự điền (đúng cách máy chủ tính khi kiểm/gửi). */
export function draftFromKind(k: EncounterInteropKind): KindDraft {
  const useDose = kindUsesDosePeriod(k.kind);
  return {
    treatmentFormCode: k.info.treatmentFormCode ?? '',
    dosePeriodNumber: useDose ? String(k.info.dosePeriodNumber ?? k.suggested.dosePeriodNumber ?? '') : '',
    doseFrom: useDose ? (k.info.doseFrom ?? k.suggested.doseFrom ?? '') : '',
    doseTo: useDose ? (k.info.doseTo ?? k.suggested.doseTo ?? '') : '',
    herbalDoses: k.info.herbalDoses === null ? '' : String(k.info.herbalDoses),
    herbalInstruction: k.info.herbalInstruction ?? '',
  };
}

function toPositiveInt(value: string): number | null {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1 ? Number(value) : null;
}

/** Đổi bản nháp sang giá trị gửi lên máy chủ; ô không thuộc loại đơn thì để null (máy chủ cũng bỏ). */
export function draftToValue(kind: PrescriptionKind, draft: KindDraft): InteropKindInfoValue {
  const dose = kindUsesDosePeriod(kind);
  const herbal = kindUsesHerbal(kind);
  const text = draft.herbalInstruction.trim();
  return {
    treatmentFormCode: kindUsesTreatmentForm(kind) && draft.treatmentFormCode.trim() !== '' ? draft.treatmentFormCode.trim() : null,
    dosePeriodNumber: dose ? toPositiveInt(draft.dosePeriodNumber) : null,
    doseFrom: dose && draft.doseFrom !== '' ? draft.doseFrom : null,
    doseTo: dose && draft.doseTo !== '' ? draft.doseTo : null,
    herbalDoses: herbal ? toPositiveInt(draft.herbalDoses) : null,
    herbalInstruction: herbal && text !== '' ? text : null,
  };
}

/** Lỗi nhập liệu cục bộ trước khi gửi (máy chủ kiểm lại). `null` = hợp lệ. */
export function validateDraft(kind: PrescriptionKind, draft: KindDraft): string | null {
  if (kindUsesDosePeriod(kind)) {
    if (draft.dosePeriodNumber.trim() !== '' && toPositiveInt(draft.dosePeriodNumber) === null) return 'Đợt dùng thuốc phải là số từ 1 trở lên.';
    if (draft.doseFrom !== '' && draft.doseTo !== '' && draft.doseTo < draft.doseFrom) return '"Đến ngày" của đợt dùng thuốc không được trước "Từ ngày".';
  }
  if (kindUsesHerbal(kind) && draft.herbalDoses.trim() !== '' && toPositiveInt(draft.herbalDoses) === null) return 'Số thang thuốc phải là số từ 1 trở lên.';
  return null;
}

export function draftsEqual(a: KindDraft, b: KindDraft): boolean {
  return (Object.keys(EMPTY_KIND_DRAFT) as (keyof KindDraft)[]).every((key) => a[key] === b[key]);
}

export interface GuardianDraft {
  fullName: string;
  phone: string;
  address: string;
}

export function guardianDraftEqual(a: GuardianDraft, b: GuardianDraft): boolean {
  return a.fullName === b.fullName && a.phone === b.phone && a.address === b.address;
}

/** Vấn đề CHẶN gửi (cổng sẽ từ chối) — khác nhắc nhở không chặn (chứng chỉ hành nghề). */
export function requiredProblems(problems: InteropProblemDto[]): InteropProblemDto[] {
  return problems.filter((p) => p.required);
}

const SHORT_LABEL: Record<string, string> = {
  ITEMS_EMPTY: 'đơn chưa có thuốc',
  DRUG_NATIONAL_CODE_MISSING: 'mã thuốc quốc gia',
  DRUG_NATIONAL_CODE_INVALID: 'mã thuốc quốc gia sai độ dài',
  UNIT_MISSING: 'đơn vị tính của thuốc',
  TREATMENT_FORM_MISSING: 'hình thức điều trị',
  DOSE_PERIOD_MISSING: 'đợt dùng thuốc',
  DOSE_PERIOD_INVALID: 'đợt dùng thuốc (ngày ngược)',
  HERBAL_DOSES_MISSING: 'số thang thuốc',
  GUARDIAN_MISSING: 'thông tin người giám hộ',
  PATIENT_ADDRESS_MISSING: 'địa chỉ bệnh nhân',
  DIAGNOSIS_MISSING: 'chẩn đoán',
};

/** "Còn thiếu: hình thức điều trị (đơn C), mã thuốc quốc gia, …" — gộp theo mã vấn đề, kèm loại đơn khi vấn đề chỉ thuộc một loại. */
export function summarizeMissing(problems: InteropProblemDto[]): string {
  const required = requiredProblems(problems);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const p of required) {
    const sameCode = required.filter((x) => x.code === p.code);
    const label = SHORT_LABEL[p.code] ?? p.message;
    const kinds = [...new Set(sameCode.map((x) => x.kind))];
    const text = p.code === 'TREATMENT_FORM_MISSING' || p.code === 'DOSE_PERIOD_MISSING' || p.code === 'HERBAL_DOSES_MISSING' ? `${label} (đơn ${kinds.join(', ')})` : label;
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts.join(', ');
}

/** Nhãn trạng thái hàng chờ — bản chủ đích của `INTEROP_SUBMISSION_STATUS_LABEL` ở `packages/shared` (web chỉ `import type` từ shared, hằng giá trị không bundle được qua vite). */
export const SUBMISSION_STATUS_LABEL: Record<InteropSubmissionStatus, string> = {
  PENDING: 'Chờ gửi',
  SENT: 'Đã gửi',
  FAILED: 'Lỗi',
  AMENDED: 'Đính chính, chưa gửi',
};

export type InteropSubmissionStatusTone = 'neutral' | 'success' | 'danger' | 'warning';

export const SUBMISSION_STATUS_TONE: Record<'PENDING' | 'SENT' | 'FAILED' | 'AMENDED', InteropSubmissionStatusTone> = {
  PENDING: 'neutral',
  SENT: 'success',
  FAILED: 'danger',
  AMENDED: 'warning',
};
