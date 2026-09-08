import { Heartbeat } from '@phosphor-icons/react';
import type { PatientVitalSignHistoryItem } from '@nexamed/shared';
import { classifyBmi } from '../encounter/clinical-display';

const TEMPERATURE_WARNING_C = 38.5;

/**
 * `measuredAt` (ISO UTC) → `DD/MM/YYYY` giờ Việt Nam (UTC+7) — cùng kỹ thuật cộng offset cố định đã
 * dùng ở `EncounterHistoryDetailDialog.tsx`/`DoctorEndShiftDialog.tsx` (không import được
 * `packages/core` từ `apps/web`, mỗi nơi tự viết bản nhỏ ổn định — chấp nhận trùng thay vì đổi kiến
 * trúc, cùng lý do `calculateAgeYears` ở `patient-form.utils.ts`).
 */
function formatVisitDate(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

function computeBmi(weightGram: number | null, heightMm: number | null): number | null {
  if (weightGram === null || heightMm === null || heightMm === 0) return null;
  return weightGram / 1000 / (heightMm / 1000) ** 2;
}

function Cell({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'muted' }) {
  return <td className={`px-3 py-2.5 text-center font-medium ${tone === 'muted' ? 'text-slate-400' : 'text-slate-700'}`}>{children}</td>;
}

/**
 * Bảng "Sinh hiệu theo lượt khám" (trang "Hồ sơ bệnh nhân") — CHỈ XEM, dùng lại đúng
 * `recentVitalSigns` đã fetch một lần (không gọi API riêng). Sinh hiệu luôn ghi tại lượt khám, sửa
 * ở đây không có ý nghĩa (đúng thiết kế đã duyệt).
 */
export function PatientVitalHistoryTable({ vitalSigns }: { vitalSigns: PatientVitalSignHistoryItem[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Heartbeat size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
          Sinh hiệu theo lượt khám
        </h2>
        <span className="text-[11px] font-medium text-slate-400">Chỉ xem — ghi nhận tại từng lượt khám</span>
      </div>

      {vitalSigns.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-400">Chưa có sinh hiệu nào được ghi nhận.</p>
      ) : (
        <div className="scroll-hover overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Ngày khám</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Cân nặng</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Chiều cao</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">BMI</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Huyết áp</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Nhiệt độ</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Mạch</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">SpO2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vitalSigns.map((v) => {
                const bmi = computeBmi(v.weightGram, v.heightMm);
                const bmiClass = bmi !== null ? classifyBmi(bmi) : null;
                const bmiBadgeClass = bmiClass?.tier === 'danger' ? 'bg-rose-600' : bmiClass?.tier === 'caution' ? 'bg-amber-500' : 'bg-emerald-500';
                const feverish = v.temperatureC !== null && v.temperatureC >= TEMPERATURE_WARNING_C;
                return (
                  <tr key={v.id}>
                    <td className="px-3 py-2.5 text-center font-medium text-slate-900">{formatVisitDate(v.measuredAt)}</td>
                    <Cell tone={v.weightGram === null ? 'muted' : 'default'}>{v.weightGram !== null ? `${(v.weightGram / 1000).toFixed(1)} kg` : '—'}</Cell>
                    <Cell tone={v.heightMm === null ? 'muted' : 'default'}>{v.heightMm !== null ? `${Math.round(v.heightMm / 10)} cm` : '—'}</Cell>
                    <td className="px-3 py-2.5 text-center">
                      {bmi !== null && bmiClass ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${bmiBadgeClass}`}>
                          {bmi.toFixed(1)} · {bmiClass.label}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <Cell tone={v.bpSystolic === null || v.bpDiastolic === null ? 'muted' : 'default'}>
                      {v.bpSystolic !== null && v.bpDiastolic !== null ? `${v.bpSystolic}/${v.bpDiastolic}` : '—'}
                    </Cell>
                    <td className="px-3 py-2.5 text-center">
                      {v.temperatureC !== null ? (
                        feverish ? (
                          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white">{v.temperatureC}°C</span>
                        ) : (
                          <span className="font-medium text-slate-700">{v.temperatureC}°C</span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <Cell tone={v.pulse === null ? 'muted' : 'default'}>{v.pulse !== null ? `${v.pulse} lần/p` : '—'}</Cell>
                    <Cell tone={v.spo2 === null ? 'muted' : 'default'}>{v.spo2 !== null ? `${v.spo2}%` : '—'}</Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
