import type { PatientFamilyHistoryItem } from '@nexamed/shared';
import { HistoryBoxCard } from './AllergyBanner';

/**
 * Khung "Tiền sử gia đình" — trích xuất từ `EncounterConsultationPage.tsx` (2026-09-08, lần dùng
 * thứ 2 là trang "Hồ sơ bệnh nhân"), đúng nguyên tắc CLAUDE.md "trùng lặp lần 2 → trích xuất ra
 * dùng chung".
 */
export function FamilyHistoryCard({ familyHistoryRows, onAdd }: { familyHistoryRows: PatientFamilyHistoryItem[]; onAdd: () => void }) {
  return (
    <HistoryBoxCard title="Tiền sử gia đình" onAdd={onAdd}>
      {familyHistoryRows.length === 0 ? (
        <p className="text-[13px] text-slate-400">Chưa ghi nhận.</p>
      ) : (
        <ul className="space-y-1">
          {familyHistoryRows.map((row) => (
            <li key={row.id} className="text-[12.5px] font-semibold text-slate-800">
              {row.relationLabel}: <span className="font-normal text-slate-600">{row.icd10Name}</span>
              {row.ageOfOnsetYears !== null && <span className="font-normal text-slate-400"> ({row.ageOfOnsetYears} tuổi)</span>}
            </li>
          ))}
        </ul>
      )}
    </HistoryBoxCard>
  );
}
