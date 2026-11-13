import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import type { StockRequestDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { useShipStockTransferMutation, useStockTransferQuery } from './inventory.queries';

const GRID = 'minmax(180px,1.4fr) 70px 90px minmax(180px,1.4fr) 110px';

/** "2028-03-31" -> "03-2028" (mockup màn 5b: hạn dùng theo tháng). */
function formatExpiryMonth(iso: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 10).split('-');
  return `${m}-${y}`;
}

/**
 * Kết quả sau khi kho cấp bấm "Chuyển thành phiếu điều chuyển" (docs/DECISIONS.md #298, mockup màn 5b): hộp hiện PHIẾU ĐIỀU CHUYỂN NHÁP vừa tạo (số phiếu, kho gửi/nhận, từ yêu cầu,
 * từng mặt hàng kèm lô gợi ý theo hạn dùng gần nhất) để người gửi "Sửa lô" hoặc "Duyệt xuất" ngay, không phải mở lại từ đầu. Đơn vị lấy từ dòng yêu cầu (phiếu điều chuyển ghi số lượng theo đơn vị cơ sở).
 */
export function StockRequestTransferResult({ transferId, request, onClose }: { transferId: string; request: StockRequestDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const transferQuery = useStockTransferQuery(transferId);
  const shipMutation = useShipStockTransferMutation();
  const unitNameByCode = useUnitNameByCode();
  const [error, setError] = useState<string | null>(null);

  const transfer = transferQuery.data;
  const unitByDrug = new Map(request.lines.map((l) => [l.drugId, l.unitCode]));

  async function ship() {
    if (!transfer) return;
    setError(null);
    try {
      await shipMutation.mutateAsync({ id: transfer.id, body: { version: transfer.version } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Duyệt xuất thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Kết quả sau khi chuyển">
      <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl">
        <ModalHeader icon={ArrowsLeftRight} tone="success" title="Kết quả sau khi chuyển" subtitle="Phiếu điều chuyển nháp vừa tạo, không phải nhập lại" onClose={onClose} />

        {transferQuery.isPending && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {transferQuery.isError && (
          <ErrorBanner
            message={transferQuery.error instanceof ApiError ? transferQuery.error.message : 'Không tải được phiếu điều chuyển vừa tạo.'}
            onRetry={() => void transferQuery.refetch()}
          />
        )}

        {transfer && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: 'Số phiếu', value: `${transfer.transferNo}${transfer.status === 'DRAFT' ? ' (nháp)' : ''}` },
                { label: 'Kho gửi', value: `${transfer.fromBranchName} / ${transfer.fromWarehouseName}` },
                { label: 'Kho nhận', value: `${transfer.toBranchName} / ${transfer.toWarehouseName}` },
                { label: 'Từ yêu cầu', value: request.requestNo },
              ].map((f) => (
                <div key={f.label}>
                  <p className="mb-1 text-sm font-semibold text-slate-800">{f.label}</p>
                  <input readOnly value={f.value} aria-label={f.label} className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-800" />
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <div role="table" aria-label="Mặt hàng của phiếu điều chuyển" style={{ minWidth: 640 }}>
                <div role="row" style={{ gridTemplateColumns: GRID }} className="grid gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                  <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                  <div role="columnheader" className="py-2.5 text-center">Số lượng</div>
                  <div role="columnheader" className="py-2.5 text-left">Lô gợi ý (hạn dùng gần nhất)</div>
                  <div role="columnheader" className="py-2.5 text-center">Hạn dùng</div>
                </div>
                {transfer.lines.map((l) => {
                  const unit = unitByDrug.get(l.drugId);
                  return (
                    <div key={l.id} role="row" style={{ gridTemplateColumns: GRID, minHeight: 48 }} className="grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm last:border-b-0">
                      <div role="cell" className="min-w-0 truncate font-semibold text-slate-900" title={l.drugName}>{l.drugName}</div>
                      <div role="cell" className="text-center font-medium text-slate-700">{unit ? unitLabel(unitNameByCode, unit) : '—'}</div>
                      <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{l.quantityShipped}</div>
                      <div role="cell" className="min-w-0 truncate font-medium text-slate-800">{l.batchNo ?? (l.isBatchManaged ? '—' : 'Không quản lý theo lô')}</div>
                      <div role="cell" className="text-center font-medium text-slate-700">{formatExpiryMonth(l.expiryDate)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" disabled={!transfer} onClick={() => transfer && navigate(`/inventory/transfers/${transfer.id}`)}>
            Sửa lô
          </Button>
          <Button type="button" disabled={!transfer || transfer.status !== 'DRAFT'} loading={shipMutation.isPending} onClick={() => void ship()}>
            Duyệt xuất
          </Button>
        </div>
      </div>
    </div>
  );
}
