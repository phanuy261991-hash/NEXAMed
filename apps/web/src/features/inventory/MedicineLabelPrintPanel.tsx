import { useState } from 'react';
import { Minus, Plus, Printer } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useResolvedPrintTemplate } from '../../shared/print/print-template.queries';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { useMedicineLabelsQuery } from './inventory.queries';
import { MedicineLabelSheet, type MedicineLabelSheetItem } from './MedicineLabelSheet';
import { buildMedicineLabelInstruction, buildMedicineLabelTitle, formatLabelLots, formatLabelQuantity } from './medicine-label';

const MIN_COPIES = 1;
const MAX_COPIES = 9;
const GRID = 'grid grid-cols-[28px_minmax(0,1.3fr)_96px_minmax(0,1.6fr)_116px] items-center gap-x-3';

/**
 * Khối "In nhãn thuốc" (docs/DECISIONS.md #267, mockup đã chốt 28/10/2026) — liệt kê thuốc của MỘT phiếu xuất đã phát để tích chọn + đặt số bản rồi in nhãn dán bì thuốc.
 * Dùng ở màn thành công của "Phát thuốc" (ngay sau khi xác nhận) và ở "Chi tiết phiếu xuất kho" (in lại). Số lượng trên nhãn là số THỰC PHÁT; tên bệnh nhân + năm sinh lấy từ đơn nguồn.
 */
export function MedicineLabelPrintPanel({ issueId }: { issueId: string }) {
  const query = useMedicineLabelsQuery(issueId);
  const unitNameByCode = useUnitNameByCode();
  const template = useResolvedPrintTemplate('MEDICINE_LABEL');
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [printing, setPrinting] = useState(false);

  const data = query.data;
  const items = data?.items ?? [];
  const copiesOf = (key: string) => copies[key] ?? MIN_COPIES;
  const isSelected = (key: string) => !unselected.has(key);

  function toggle(key: string) {
    setUnselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function changeCopies(key: string, delta: number) {
    setCopies((prev) => ({ ...prev, [key]: Math.min(MAX_COPIES, Math.max(MIN_COPIES, (prev[key] ?? MIN_COPIES) + delta)) }));
  }

  const patient = data?.patient ?? null;
  const printSet: MedicineLabelSheetItem[] = patient
    ? items
        .filter((item) => isSelected(item.key))
        .flatMap((item) =>
          Array.from({ length: copiesOf(item.key) }, (_, index) => ({
            key: `${item.key}-${index}`,
            patientName: patient.fullName,
            birthYear: patient.birthYear,
            title: buildMedicineLabelTitle(item),
            quantityText: formatLabelQuantity(item.quantity, item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : null),
            instruction: buildMedicineLabelInstruction(item),
            lotText: formatLabelLots(item.batches),
          })),
        )
    : [];

  function handlePrint() {
    if (printSet.length === 0) return;
    setPrinting(true);
    // Chờ React vẽ xong tờ nhãn rồi mới mở hộp thoại in của trình duyệt (đúng khuôn các màn in khác).
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  }

  const paperText = template ? `${template.widthMm}×${template.heightMm ?? '…'} mm` : '70×40 mm';

  return (
    <section aria-label="In nhãn thuốc">
      <h3 className="text-[15px] font-semibold text-slate-900">In nhãn thuốc</h3>

      {query.isPending && (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {query.isError && (
        <div className="mt-3">
          <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được dữ liệu nhãn thuốc.'} onRetry={() => void query.refetch()} />
        </div>
      )}
      {data && items.length === 0 && <p className="mt-2 text-sm text-slate-600">Phiếu này không có thuốc nào cần dán nhãn.</p>}

      {data && items.length > 0 && (
        <>
          <div role="table" aria-label="Nhãn thuốc sẽ in" className="mt-2">
            <div role="row" className={`${GRID} border-b-2 border-blue-600 bg-slate-100 px-2 py-2`}>
              <span />
              <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">Thuốc</span>
              <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">Số lượng phát</span>
              <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">Câu dặn trên nhãn</span>
              <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">Số bản</span>
            </div>
            {items.map((item) => {
              const instruction = buildMedicineLabelInstruction(item);
              const selected = isSelected(item.key);
              return (
                <div key={item.key} role="row" className={`${GRID} border-b border-slate-200 px-2 py-2.5 ${selected ? '' : 'bg-slate-50'}`}>
                  <SelectionCheckbox checked={selected} onChange={() => toggle(item.key)} ariaLabel={`In nhãn ${item.drugName}`} />
                  <span role="cell" className={`min-w-0 text-sm ${selected ? 'text-slate-900' : 'text-slate-500'}`}>
                    {buildMedicineLabelTitle(item)}
                  </span>
                  <span role="cell" className="text-sm tabular-nums text-slate-900">
                    {formatLabelQuantity(item.quantity, item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : null)}
                  </span>
                  <span role="cell" className="min-w-0 truncate text-[13px] text-slate-600" title={instruction ?? undefined}>
                    {instruction ?? '—'}
                  </span>
                  <span role="cell" className="inline-flex items-center gap-1">
                    <Button type="button" variant="secondary" className="px-2 py-1" aria-label={`Giảm số bản ${item.drugName}`} disabled={!selected || copiesOf(item.key) <= MIN_COPIES} onClick={() => changeCopies(item.key, -1)}>
                      <Minus size={12} weight="bold" aria-hidden="true" />
                    </Button>
                    <span className="min-w-6 text-center text-sm tabular-nums text-slate-900" aria-live="polite">
                      {copiesOf(item.key)}
                    </span>
                    <Button type="button" variant="secondary" className="px-2 py-1" aria-label={`Tăng số bản ${item.drugName}`} disabled={!selected || copiesOf(item.key) >= MAX_COPIES} onClick={() => changeCopies(item.key, 1)}>
                      <Plus size={12} weight="bold" aria-hidden="true" />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-slate-600">
              {printSet.length} nhãn sẽ in, khổ tem {paperText} (đổi ở Quản lý mẫu in). Nhãn in từ số lượng thực phát, không phải số lượng đã kê.
            </p>
            <Button type="button" onClick={handlePrint} disabled={printSet.length === 0}>
              <Printer size={16} weight="bold" aria-hidden="true" />
              In nhãn ({printSet.length})
            </Button>
          </div>
        </>
      )}

      {printing && <MedicineLabelSheet labels={printSet} printedAt={data?.issuedAt} />}
    </section>
  );
}
