import type { PatientConditionItem } from '@nexamed/shared';
import { HistoryBoxCard } from './AllergyBanner';

/** Thói quen/lối sống dùng CHUNG mảng `patient.conditions` với bệnh lý nền, mã hoá ICD-10 Chương XXI (Z72.x) — xem `PatientHistoryDialog.tsx`. */
function isHabitConditionCode(icd10Code: string): boolean {
  return icd10Code.startsWith('Z72');
}

/**
 * Khung "Tiền sử bản thân" (bệnh lý nền + thói quen/lối sống + ghi chú tự do) — trích xuất từ
 * `EncounterConsultationPage.tsx` (2026-09-08, lần dùng thứ 2 là trang "Hồ sơ bệnh nhân"), đúng
 * nguyên tắc CLAUDE.md "trùng lặp lần 2 → trích xuất ra dùng chung". Nhận subset dữ liệu đã xác
 * nhận cả `ConsultationPatient` (màn khám) lẫn `PatientDetail` (hồ sơ bệnh nhân) đều có đủ.
 */
export function PersonalHistoryCard({
  conditions,
  personalHistory,
  onAdd,
}: {
  conditions: PatientConditionItem[];
  personalHistory: string | null;
  onAdd: () => void;
}) {
  const diseaseConditions = conditions.filter((c) => !isHabitConditionCode(c.icd10Code));
  const habitConditions = conditions.filter((c) => isHabitConditionCode(c.icd10Code));

  return (
    <HistoryBoxCard title="Tiền sử bản thân" onAdd={onAdd}>
      {diseaseConditions.length === 0 && habitConditions.length === 0 && !personalHistory ? (
        <p className="text-[13px] text-slate-400">Chưa ghi nhận.</p>
      ) : (
        <div className="space-y-2">
          {diseaseConditions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {diseaseConditions.map((c) => (
                <span key={c.icd10Code} className="rounded-full border border-brand-teal bg-brand-teal-tint px-2.5 py-1 text-[12px] font-semibold text-brand-teal-active">
                  {c.icd10Name}
                </span>
              ))}
            </div>
          )}
          {habitConditions.length > 0 && (
            <p className="text-[12.5px]">
              <span className="font-semibold text-slate-700">Thói quen: </span>
              <span className="text-slate-600">{habitConditions.map((c) => c.icd10Name).join(' / ')}</span>
            </p>
          )}
          {personalHistory && (
            <p className="text-[12.5px]">
              <span className="font-semibold text-slate-700">Ghi chú: </span>
              <span className="text-slate-600">{personalHistory}</span>
            </p>
          )}
        </div>
      )}
    </HistoryBoxCard>
  );
}
