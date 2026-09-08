import { ClipboardText } from '@phosphor-icons/react';
import type { PatientConditionItem, PatientFamilyHistoryItem } from '@nexamed/shared';
import { isHabitConditionCode } from './patient-form.utils';

function AddChipButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="rounded-full border border-dashed border-blue-400 px-3 py-1 text-sm font-semibold text-blue-600 hover:bg-blue-50"
    >
      + Thêm
    </button>
  );
}

/**
 * Thẻ "Tiền sử bản thân & gia đình" của trang "Hồ sơ bệnh nhân" — đúng mockup đã duyệt (Artifact
 * "Hồ Sơ Bệnh Nhân NEXAMed", Phương án 4 ★): 1 thẻ GỘP (khác `PersonalHistoryCard`/`FamilyHistoryCard`
 * — 2 khung compact riêng biệt đang dùng ở `EncounterConsultationPage.tsx`, KHÔNG đổi màn hình đó).
 * Chung logic phân loại thói quen/bệnh lý nền qua `isHabitConditionCode` (patient-form.utils.ts).
 */
export function PatientHistorySummaryCard({
  conditions,
  familyHistoryRows,
  personalHistory,
  onAdd,
}: {
  conditions: PatientConditionItem[];
  familyHistoryRows: PatientFamilyHistoryItem[];
  personalHistory: string | null;
  onAdd: () => void;
}) {
  const diseaseConditions = conditions.filter((c) => !isHabitConditionCode(c.icd10Code));
  const habitConditions = conditions.filter((c) => isHabitConditionCode(c.icd10Code));

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <ClipboardText size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
          Tiền sử bản thân & gia đình
        </h2>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">Bệnh lý nền</div>
            <div className="flex flex-wrap gap-1.5">
              {diseaseConditions.map((c) => (
                <span key={c.icd10Code} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700">
                  {c.icd10Name}
                </span>
              ))}
              <AddChipButton onAdd={onAdd} />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">Thói quen / lối sống</div>
            <div className="flex flex-wrap gap-1.5">
              {habitConditions.map((c) => (
                <span key={c.icd10Code} className="rounded-full border border-amber-500 bg-amber-500 px-3 py-1 text-sm font-medium text-white">
                  {c.icd10Name}
                </span>
              ))}
              <AddChipButton onAdd={onAdd} />
            </div>
          </div>
        </div>

        <div className="h-5" />

        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">Tiền sử gia đình</div>
        {familyHistoryRows.length > 0 && (
          <div className="mb-2 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Quan hệ</th>
                  <th className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Bệnh</th>
                  <th className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Tuổi khởi phát</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {familyHistoryRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-center font-medium text-slate-800">{row.relationLabel}</td>
                    <td className="px-3 py-2 text-center font-medium text-slate-800">{row.icd10Name}</td>
                    <td className="px-3 py-2 text-center font-medium text-slate-700">{row.ageOfOnsetYears !== null ? `${row.ageOfOnsetYears} tuổi` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" onClick={onAdd} className="text-sm font-semibold text-blue-600 hover:underline">
          + Thêm dòng tiền sử gia đình
        </button>

        <div className="h-5" />

        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">Ghi chú tiền sử bản thân</div>
        <p className={`rounded-md bg-slate-50 p-3 text-sm leading-relaxed ${personalHistory ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
          {personalHistory || 'Chưa ghi nhận.'}
        </p>
      </div>
    </section>
  );
}
