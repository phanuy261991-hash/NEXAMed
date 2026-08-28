import type { DiagnosisType, SaveClinicalNoteRequest } from '@nexamed/shared';

/**
 * Nhãn hiển thị dùng chung cho dữ liệu lâm sàng của một lượt khám — trích từ `EncounterConsultationPage.tsx`
 * (2026-08-29) vì `EncounterHistoryDetailDialog.tsx` (xem chi tiết đợt khám cũ, chỉ đọc) cần đúng
 * NHÃN/PHÂN LOẠI giống hệt màn khám đang chỉnh sửa — tránh 2 nguồn sự thật lệch nhau về câu chữ.
 */
export const DIAGNOSIS_TYPE_LABEL: Record<DiagnosisType, string> = { PRIMARY: 'Bệnh chính', SECONDARY: 'Bệnh kèm theo' };

export type ClinicalKey = keyof SaveClinicalNoteRequest;

export const CLINICAL_SECTION_LABEL: Record<ClinicalKey, string> = {
  reasonForVisit: 'Lý do khám',
  illnessProgress: 'Quá trình bệnh lý',
  preliminaryDiagnosis: 'Chẩn đoán',
  generalExam: 'Kết quả khám toàn thân',
  regionalExam: 'Kết quả khám bộ phận',
  plan: 'Kế hoạch',
};

export type VitalTier = 'normal' | 'caution' | 'danger';

export const TIER_TEXT_CLASS: Record<VitalTier, string> = {
  normal: 'text-slate-900',
  caution: 'text-amber-600',
  danger: 'text-rose-600',
};

/** Chấm trạng thái cạnh nhãn — không chỉ dựa màu chữ (quy tắc "Color Only" trong bộ UX checklist). */
export const TIER_DOT_CLASS: Record<VitalTier, string> = {
  normal: 'bg-emerald-500',
  caution: 'bg-amber-500',
  danger: 'bg-rose-600',
};

/**
 * Phân loại BMI (chuẩn WHO khu vực Châu Á - Thái Bình Dương, chốt 2026-08-20 theo yêu cầu chủ dự
 * án): <18.5 Thiếu cân, 18.5–22.9 Bình thường, 23–24.9 Thừa cân, 25–29.9 Béo phì độ I, ≥30 Béo phì
 * độ II. Chỉ "Bình thường" là `normal` — thiếu cân/thừa cân ở mức `caution` (amber), 2 mức béo phì
 * ở `danger` (rose), đúng "Tín hiệu Y tế" mục 2.1 ui-guidelines.md.
 */
export function classifyBmi(bmi: number): { label: string; tier: VitalTier } {
  if (bmi < 18.5) return { label: 'Thiếu cân', tier: 'caution' };
  if (bmi < 23.0) return { label: 'Bình thường', tier: 'normal' };
  if (bmi < 25.0) return { label: 'Thừa cân', tier: 'caution' };
  if (bmi < 30.0) return { label: 'Béo phì độ I', tier: 'danger' };
  return { label: 'Béo phì độ II', tier: 'danger' };
}

/**
 * Nhãn + giá trị (kèm đơn vị/phân loại BMI) trên CÙNG một dòng. Giá trị bất thường đổi màu (đúng
 * "Tín hiệu Y tế" mục 2.1 ui-guidelines.md), kèm chấm trạng thái cạnh nhãn (`TIER_DOT_CLASS`).
 * Container cha (nơi gọi component này) dùng `divide-x` để vẽ đường kẻ dọc phân cách rõ giữa từng ô.
 */
export function VitalChip({
  label,
  value,
  unit,
  tier = 'normal',
  sublabel,
}: {
  label: string;
  value: string | number | null | undefined;
  unit: string;
  tier?: VitalTier;
  sublabel?: string;
}) {
  const hasValue = value != null;
  const effectiveTier = hasValue ? tier : 'normal';
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 text-center">
      <span className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${TIER_DOT_CLASS[effectiveTier]}`} aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </span>
      <span className={`whitespace-nowrap text-sm font-bold ${TIER_TEXT_CLASS[effectiveTier]}`}>
        {value ?? '—'}
        {hasValue && unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
        {hasValue && sublabel && <span className="ml-1.5 text-xs font-semibold">{sublabel}</span>}
      </span>
    </div>
  );
}