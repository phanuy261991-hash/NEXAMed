import { useState, type ReactNode } from 'react';
import { Button } from '../../shared/ui/Button';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatDateTimeVn } from '../../shared/format/time';
import { useHasPermission } from '../auth/usePermission';
import { PrescriptionItemsTable } from '../encounter/PrescriptionPanel';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import type { ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import type { MedicalRecordView, ParaclinicalResult } from './medical-record-model';

const NOT_RECORDED = '— chưa ghi —';

const KIND_LABEL: Record<ParaclinicalResult['serviceKind'], string> = { LAB: 'XÉT NGHIỆM', IMAGING: 'HÌNH ẢNH', FUNCTIONAL: 'THĂM DÒ CN' };
const KIND_GROUP: Record<ParaclinicalResult['serviceKind'], ParaclinicalGroup> = { LAB: 'lab', IMAGING: 'imaging', FUNCTIONAL: 'imaging' };

/**
 * Một MỤC của phiếu bệnh án: một HÀNG có cột tiêu đề bên trái (nền xám nhạt: ô số La Mã + tên mục) và nội dung bên phải, các hàng ngăn nhau bằng đường kẻ suốt chiều rộng — đúng bố cục mockup
 * đã chốt (docs/DECISIONS.md #269). Dưới `md` cột tiêu đề chuyển lên trên nội dung. Tiêu đề căn theo đường chữ ở đỉnh cột (`items-baseline`) — cột kéo dài hết chiều cao của hàng nên căn giữa sẽ làm
 * tên mục trôi xuống giữa.
 */
export function RecordSection({ numeral, title, children, tone = 'blue' }: { numeral: string; title: string; children: ReactNode; /** `teal` cho các mục của nhóm "Tổng kết bệnh án". */ tone?: 'blue' | 'teal' }) {
  return (
    <section className="grid grid-cols-1 border-t border-slate-300 first:border-t-0 md:grid-cols-[224px_minmax(0,1fr)]">
      <h3 className="flex items-baseline gap-2.5 border-b border-slate-300 bg-slate-100 px-4 py-3.5 text-sm font-semibold leading-snug text-slate-900 md:border-b-0 md:border-r">
        <span className={`inline-flex h-[26px] min-w-[26px] shrink-0 items-center justify-center rounded-md ${tone === 'teal' ? 'bg-teal-600' : 'bg-blue-600'} px-1.5 text-xs font-semibold tabular-nums text-white`}>{numeral}</span>
        <span className="min-w-0">{title}</span>
      </h3>
      <div className="min-w-0 px-[18px] py-3.5">{children}</div>
    </section>
  );
}

/** Đoạn văn của mục — để trống thì hiện "— chưa ghi —" nghiêng, mờ (không để khoảng trắng làm người đọc tưởng lỗi tải). */
function Prose({ text }: { text: string }) {
  if (text === '') return <p className="text-[13.5px] italic text-slate-500">{NOT_RECORDED}</p>;
  return <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-slate-900">{text}</p>;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[12.5px] font-semibold text-slate-700">{children}</div>;
}

function CodeChip({ code, name }: { code: string; name: string }) {
  return (
    <span className="rounded-[5px] border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-900">
      <span className="font-semibold tabular-nums text-blue-700">{code}</span> {name}
    </span>
  );
}

function ParaclinicalCard({ result, canView, onView }: { result: ParaclinicalResult; canView: boolean; onView: () => void }) {
  const hasIndicators = result.indicators.length > 0;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{KIND_LABEL[result.serviceKind]}</span>
          <span className="truncate text-[13.5px] font-semibold text-slate-900">{result.serviceName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-xs tabular-nums text-slate-500">Duyệt {formatDateTimeVn(result.signedAt)}</span>
          {canView && (
            <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={onView}>
              Xem phiếu kết quả
            </Button>
          )}
        </span>
      </div>
      <div className="px-3 pb-2.5">
        {hasIndicators && (
          <table className="w-full border-collapse text-[13px]">
            <caption className="py-1.5 text-left text-xs text-slate-500">Chỉ số</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                <th scope="col" className="py-1">Tên</th>
                <th scope="col" className="w-28 px-2 py-1 text-right">Kết quả</th>
                <th scope="col" className="w-20 py-1">Đơn vị</th>
                <th scope="col" className="w-32 py-1">Tham chiếu</th>
              </tr>
            </thead>
            <tbody>
              {result.indicators.map((i, index) => (
                <tr key={`${i.name}-${index}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-900">{i.name}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${i.abnormal ? 'font-semibold text-slate-900 underline' : 'text-slate-900'}`}>{i.valueText ?? '—'}</td>
                  <td className="py-1.5 text-slate-600">{i.unit ?? ''}</td>
                  <td className="py-1.5 tabular-nums text-slate-600">{i.referenceText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result.descriptionText && (
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">
            <span className="text-slate-500">Mô tả hình ảnh:</span> {result.descriptionText}
          </p>
        )}
        {result.conclusionText && (
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">
            <span className="text-slate-500">{hasIndicators ? 'Nhận xét' : 'Kết luận'}:</span> {result.conclusionText}
          </p>
        )}
        {result.imageCount > 0 && <p className="mt-1.5 text-xs text-slate-500">{result.imageCount} ảnh đính kèm — xem trong phiếu kết quả.</p>}
      </div>
    </div>
  );
}

function DiagnosisList({ diagnoses }: { diagnoses: MedicalRecordView['diagnoses'] }) {
  if (diagnoses.length === 0) return <p className="text-[13.5px] italic text-slate-500">{NOT_RECORDED}</p>;
  return (
    <div className="flex flex-col gap-2">
      {diagnoses.map((d) => (
        <div key={d.code} className="flex flex-wrap items-baseline gap-2.5">
          <span className="shrink-0 rounded-[5px] border border-blue-200 bg-blue-50 px-2 py-0.5 text-[12.5px] font-semibold tabular-nums text-blue-700">{d.code}</span>
          <span className="min-w-0 text-[13.5px] text-slate-900">{d.name}</span>
          {d.primary ? (
            <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">Chính</span>
          ) : (
            <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10.5px] text-slate-600">Kèm theo</span>
          )}
        </div>
      ))}
    </div>
  );
}

function CodeCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * Phiếu bệnh án ngoại trú của MỘT lượt khám đã hoàn tất, theo mẫu MS 15/BV-01 (Thông tư 32/2023/TT-BYT, Phụ lục XXVIII): hàng mã đầu phiếu, mục I–IV, rồi nhóm "Tổng kết bệnh án" (docs/DECISIONS.md #269,
 * mockup đã chốt https://claude.ai/artifact/LwSZrKeS8SKqubKmynACyW). CHỈ ĐỌC: sửa vẫn phải qua đính chính ở màn khám.
 * `paraclinical` cho biết kết quả cận lâm sàng đang tải/lỗi/đã có (mục IV.3 hiện khung xương hoặc báo lỗi tại chỗ, các mục khác vẫn xem được).
 */
export function MedicalRecordSheet({
  view,
  patientId,
  paraclinical,
  onRetryParaclinical,
}: {
  view: MedicalRecordView;
  /** Mã bệnh nhân — để hộp xem phiếu kết quả đọc được kết quả của lượt khám ở chi nhánh khác (kết quả đi theo người bệnh, #234). */
  patientId: string;
  paraclinical: { state: 'loading' } | { state: 'error' } | { state: 'ready' };
  onRetryParaclinical: () => void;
}) {
  const canViewLab = useHasPermission('lab_result', 'read');
  const canViewImaging = useHasPermission('imaging_result', 'read');
  const [viewing, setViewing] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);
  const canView = (kind: ParaclinicalResult['serviceKind']): boolean => (KIND_GROUP[kind] === 'lab' ? canViewLab : canViewImaging);
  const printedPrescription = view.prescription && view.prescription.signedAt ? view.prescription : null;
  const branchName = view.admin.find((f) => f.label === 'Chi nhánh')?.value;
  // Tổng kết mục 1: ưu tiên "Tóm tắt bệnh án" bác sĩ viết; chưa viết thì dùng quá trình bệnh lý (cùng quy tắc bản in).
  const summaryText = view.summary !== '' ? view.summary : view.illness;

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-slate-300 px-[18px] py-3 xl:grid-cols-4">
        <CodeCell label="Số ngoại trú" value={view.encounterNo} />
        <CodeCell label="Số lưu trữ" value={view.archiveNo ?? '—'} />
        <CodeCell label="Mã bệnh nhân (hồ sơ)" value={view.patientCode} />
        {branchName && <CodeCell label="Chi nhánh" value={branchName} />}
      </dl>

      <RecordSection numeral="I" title="Hành chính">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 xl:grid-cols-4">
          {view.sheetAdmin.map((f) => (
            <div key={f.label} className={f.wide ? 'col-span-2' : undefined}>
              <dt className="mb-0.5 text-xs text-slate-500">{f.label}</dt>
              <dd className="text-[13.5px] tabular-nums text-slate-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      </RecordSection>

      <RecordSection numeral="II" title="Lý do vào viện">
        <Prose text={view.reason} />
      </RecordSection>

      <RecordSection numeral="III" title="Hỏi bệnh">
        <div className="flex flex-col gap-3">
          <div>
            <SubLabel>1. Quá trình bệnh lý</SubLabel>
            <Prose text={view.illness} />
          </div>
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 p-3">
            <span className="text-[13.5px] font-semibold text-slate-900">2. Tiền sử bệnh</span>
            <div>
              <SubLabel>Bản thân</SubLabel>
              {view.conditions.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1.5">
                  {view.conditions.map((c) => (
                    <CodeChip key={c.code} code={c.code} name={c.name} />
                  ))}
                </div>
              )}
              <p className="text-[13px] leading-relaxed text-slate-700">{view.personalHistoryNote || (view.conditions.length === 0 ? NOT_RECORDED : '')}</p>
            </div>
            <div>
              <SubLabel>Gia đình</SubLabel>
              {view.familyHistory.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {view.familyHistory.map((f) => (
                    <span key={f} className="rounded-[5px] border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-900">
                      {f}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] italic text-slate-500">{NOT_RECORDED}</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-[12.5px] font-semibold text-rose-700">Dị ứng</div>
              {view.allergies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {view.allergies.map((a) => (
                    <span key={a} className="rounded-[5px] border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-800">
                      {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] italic text-slate-500">Chưa ghi nhận dị ứng.</p>
              )}
            </div>
          </div>
        </div>
      </RecordSection>

      <RecordSection numeral="IV" title="Khám bệnh">
        <div className="flex flex-col gap-3">
          {/* 4 cột x 2 hàng (8 cột chỉ từ màn rất rộng): 8 ô trên một hàng làm nhãn "Cân nặng"/"Chiều cao" bị cắt. `gap-px` + nền xám vẽ đường kẻ cả hai chiều. */}
          <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 2xl:grid-cols-8">
            {view.vitals.map((v) => (
              <div key={v.label} className="min-w-0 bg-white px-2.5 py-2">
                <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{v.label}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{v.value}</div>
              </div>
            ))}
          </div>
          <div>
            <SubLabel>1. Toàn thân</SubLabel>
            <Prose text={view.generalExam} />
          </div>
          <div>
            <SubLabel>2. Các bộ phận</SubLabel>
            <Prose text={view.regionalExam} />
          </div>
          <div>
            <SubLabel>3. Tóm tắt kết quả cận lâm sàng</SubLabel>
            {paraclinical.state === 'loading' && <Skeleton className="h-24 w-full rounded-lg" />}
            {paraclinical.state === 'error' && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                <span>Không tải được kết quả cận lâm sàng của lượt khám này.</span>
                <Button type="button" variant="danger" className="px-3 py-1.5" onClick={onRetryParaclinical}>
                  Thử lại
                </Button>
              </div>
            )}
            {paraclinical.state === 'ready' &&
              (view.cls.length === 0 ? (
                <p className="text-[13.5px] italic text-slate-500">Lượt khám này không có kết quả cận lâm sàng đã duyệt.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {view.cls.map((r) => (
                    <ParaclinicalCard key={r.itemId} result={r} canView={canView(r.serviceKind)} onView={() => setViewing({ group: KIND_GROUP[r.serviceKind], itemId: r.itemId })} />
                  ))}
                </div>
              ))}
          </div>
          <div>
            <SubLabel>4. Chẩn đoán ban đầu</SubLabel>
            <Prose text={view.preliminaryDiagnosis} />
          </div>
          <div className="flex flex-col gap-2">
            <SubLabel>5. Đã xử lý (thuốc, chăm sóc)</SubLabel>
            {view.planContent !== '' && <Prose text={view.planContent} />}
            {view.nationalCodes.length > 0 && (
              <span className="text-xs tabular-nums text-slate-600">
                Mã đơn quốc gia <span className="font-semibold text-slate-900">{view.nationalCodes.join(' · ')}</span>
              </span>
            )}
            {printedPrescription && printedPrescription.items.length > 0 ? (
              <PrescriptionItemsTable items={printedPrescription.items} />
            ) : (
              view.planContent === '' && <p className="text-[13px] italic text-slate-500">{NOT_RECORDED}</p>
            )}
          </div>
          <div>
            <SubLabel>6. Chẩn đoán khi ra viện</SubLabel>
            <DiagnosisList diagnoses={view.diagnoses} />
          </div>
          <div>
            <SubLabel>7. Điều trị ngoại trú</SubLabel>
            <p className="text-[13.5px] tabular-nums text-slate-900">{view.treatmentPeriod}</p>
          </div>
        </div>
      </RecordSection>

      <div className="border-y border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Tổng kết bệnh án</div>

      <RecordSection numeral="1" tone="teal" title="Diễn biến">
        <SubLabel>Quá trình bệnh lý và diễn biến lâm sàng</SubLabel>
        <Prose text={summaryText} />
      </RecordSection>

      <RecordSection numeral="2" tone="teal" title="Cận lâm sàng">
        <SubLabel>Tóm tắt kết quả xét nghiệm cận lâm sàng có giá trị chẩn đoán</SubLabel>
        {paraclinical.state !== 'ready' ? (
          <p className="text-[13.5px] italic text-slate-500">{paraclinical.state === 'loading' ? 'Đang tải kết quả cận lâm sàng…' : 'Chưa tải được kết quả cận lâm sàng.'}</p>
        ) : view.cls.length === 0 ? (
          <p className="text-[13.5px] italic text-slate-500">Không có kết quả cận lâm sàng đã duyệt.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13.5px] text-slate-900">
            {view.cls.map((r) => (
              <li key={r.itemId}>
                <span className="font-semibold">{r.serviceName}</span>
                {r.conclusionText || r.descriptionText ? ` — ${r.conclusionText ?? r.descriptionText}` : ''}
              </li>
            ))}
          </ul>
        )}
      </RecordSection>

      <RecordSection numeral="3" tone="teal" title="Chẩn đoán ra viện">
        <DiagnosisList diagnoses={view.diagnoses} />
      </RecordSection>

      <RecordSection numeral="4" tone="teal" title="Phương pháp điều trị">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-slate-700">Hướng điều trị</span>
            {view.directions.length > 0 ? (
              view.directions.map((d) => (
                <span key={d} className="rounded-[5px] border border-teal-300 bg-teal-50 px-2.5 py-0.5 text-[12.5px] font-semibold text-teal-800">
                  {d}
                </span>
              ))
            ) : (
              <span className="text-[13px] italic text-slate-500">{NOT_RECORDED}</span>
            )}
          </div>
          {view.planContent !== '' && <Prose text={view.planContent} />}
        </div>
      </RecordSection>

      <RecordSection numeral="5" tone="teal" title="Tình trạng ra viện">
        <SubLabel>Tình trạng người bệnh khi kết thúc khám</SubLabel>
        <Prose text={view.prognosis} />
      </RecordSection>

      <RecordSection numeral="6" tone="teal" title="Hướng điều trị tiếp">
        <div className="flex flex-col gap-2">
          <Prose text={view.advice} />
          <p className="text-[13.5px]">
            <span className="text-slate-500">Hẹn tái khám:</span> <span className="font-semibold text-slate-900">{view.followUp ?? 'Không hẹn'}</span>
          </p>
        </div>
      </RecordSection>

      {viewing && <ParaclinicalResultViewDialog group={viewing.group} itemId={viewing.itemId} patientId={patientId} onClose={() => setViewing(null)} />}
    </div>
  );
}
