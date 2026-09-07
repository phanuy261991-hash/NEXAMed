import { useEffect, useMemo, useState } from 'react';
import { ArrowCircleDown, ArrowCircleUp, ArrowsLeftRight, BookOpen, DownloadSimple, Wallet } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useCashAccountsQuery } from './cash-account.queries';
import { useCashBookLedgerQuery, useExportCashBookLedgerMutation } from './cash-book-ledger.queries';

const GRID_COLUMNS = '130px 1.4fr 2fr 160px 160px';
const TABLE_MIN_WIDTH_PX = 900;
const ROW_HEIGHT_PX = 52;

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

function monthStartDateString(): string {
  return `${getVietnamTodayDateString().slice(0, 7)}-01`;
}

const ENTRY_TYPE_META: Record<string, { label: string; icon: typeof ArrowCircleDown }> = {
  INVOICE_PAYMENT: { label: 'Thu tiền khám', icon: ArrowCircleDown },
  INVOICE_REFUND: { label: 'Hoàn tiền khám', icon: ArrowCircleUp },
  VOUCHER_INCOME: { label: 'Phiếu thu', icon: ArrowCircleDown },
  VOUCHER_EXPENSE: { label: 'Phiếu chi', icon: ArrowCircleUp },
  TRANSFER_IN: { label: 'Chuyển quỹ đến', icon: ArrowsLeftRight },
  TRANSFER_OUT: { label: 'Chuyển quỹ đi', icon: ArrowsLeftRight },
};

/**
 * "Sổ quỹ" (Sổ quỹ & Thu chi GĐ2) — chọn 1 quỹ, xem MỌI chứng từ ảnh hưởng số dư của quỹ đó
 * (`payment` lượt khám + `cash_voucher`) kèm số dư luỹ kế. Server LUÔN tính `runningBalance` theo
 * thứ tự CŨ→MỚI (bắt buộc cho đúng phép cộng dồn), nhưng HIỂN THỊ đảo lại MỚI→CŨ (chủ dự án phản
 * hồi 2026-09-07: sắp cũ→mới trước đây bắt phải cuộn xuống cuối mới thấy số dư hiện tại, bất tiện —
 * đổi cho khớp List Screen Pattern chung của app, mới nhất luôn ở trên). Mỗi dòng đã mang sẵn đúng
 * `runningBalance` của nó nên đảo thứ tự hiển thị không ảnh hưởng gì tới số liệu. `cash_voucher.read`
 * — cùng quyền "Phiếu thu/Phiếu chi" (receptionist+clinic_admin), khác "Báo cáo dòng tiền" (chỉ
 * clinic_admin).
 */
export function CashBookPage() {
  useBreadcrumb([{ label: 'Sổ quỹ & Thu chi' }, { label: 'Sổ quỹ' }]);

  const cashAccountsQuery = useCashAccountsQuery();
  const accounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);

  const [cashAccountId, setCashAccountId] = useState('');
  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());

  useEffect(() => {
    if (cashAccountId === '' && accounts.length > 0) {
      setCashAccountId(accounts.find((a) => a.isDefault && a.type === 'CASH')?.id ?? accounts[0]!.id);
    }
  }, [accounts, cashAccountId]);

  const ledgerQuery = useCashBookLedgerQuery({ cashAccountId, from: dateFrom, to: dateTo }, cashAccountId !== '');
  const exportMutation = useExportCashBookLedgerMutation();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cb-account" className="text-sm font-semibold text-slate-800">
              Quỹ
            </label>
            <select
              id="cb-account"
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              className="min-w-[220px] rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.type === 'DRAWER' && a.ownerUserName ? ` — Két riêng của ${a.ownerUserName}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cb-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <input id="cb-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cb-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <input id="cb-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          loading={exportMutation.isPending}
          disabled={cashAccountId === ''}
          onClick={() => exportMutation.mutate({ cashAccountId, from: dateFrom, to: dateTo })}
        >
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {/* Dải KPI dùng chung `shared/ui/StatCard.tsx#StatCardRow` — "Số dư cuối kỳ" là số liệu thật
          sự cần chú ý nên `emphasis`, "Số dư đầu kỳ" giữ tông trung tính. */}
      {ledgerQuery.isSuccess && (
        <div className="flex flex-shrink-0 flex-wrap items-stretch gap-3">
          <StatCardRow
            items={[
              { icon: Wallet, tone: 'slate', label: 'Số dư đầu kỳ', value: formatVnd(ledgerQuery.data.openingBalance) },
              { icon: BookOpen, tone: 'blue', label: 'Số dư cuối kỳ', value: formatVnd(ledgerQuery.data.closingBalance), emphasis: true },
            ]}
          />
        </div>
      )}

      {ledgerQuery.isError && (
        <ErrorBanner message={ledgerQuery.error instanceof ApiError ? ledgerQuery.error.message : 'Không tải được Sổ quỹ.'} onRetry={() => void ledgerQuery.refetch()} />
      )}

      {ledgerQuery.isPending && cashAccountId !== '' && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {ledgerQuery.isSuccess && ledgerQuery.data.entries.length === 0 && (
        <EmptyState icon={BookOpen} title="Chưa có chứng từ nào" description="Chưa có giao dịch nào ảnh hưởng tới quỹ này trong khoảng ngày đã chọn." />
      )}

      {ledgerQuery.isSuccess && ledgerQuery.data.entries.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Sổ quỹ" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div
                role="row"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="flex items-center justify-center py-2.5">Ngày</div>
                <div role="columnheader" className="flex items-center justify-center py-2.5">Loại chứng từ</div>
                <div role="columnheader" className="flex items-center py-2.5">Diễn giải</div>
                <div role="columnheader" className="flex items-center justify-center py-2.5">Số tiền</div>
                <div role="columnheader" className="flex items-center justify-center py-2.5">Số dư luỹ kế</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {[...ledgerQuery.data.entries].reverse().map((entry) => {
                  const meta = ENTRY_TYPE_META[entry.entryType];
                  const Icon = meta?.icon ?? ArrowCircleDown;
                  const isPositive = entry.amountSigned >= 0;
                  return (
                    <div
                      key={entry.id}
                      role="row"
                      style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                      className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                    >
                      <div role="cell" className="text-center text-slate-600">{formatDateShort(entry.occurredAt)}</div>
                      <div role="cell" className="flex items-center justify-center gap-1.5 truncate">
                        <Icon size={13} weight="fill" className={`flex-shrink-0 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden="true" />
                        <span className="truncate text-slate-700">{meta?.label ?? entry.entryType}</span>
                      </div>
                      <div role="cell" className="min-w-0 truncate font-medium text-slate-900" title={entry.description}>
                        {entry.description} <span className="text-xs text-slate-400">· {entry.referenceNo}</span>
                      </div>
                      <div role="cell" className={`text-center font-bold tabular-nums ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isPositive ? '+' : '−'}
                        {formatVnd(Math.abs(entry.amountSigned))}
                      </div>
                      <div role="cell" className="text-center font-bold tabular-nums text-slate-900">{formatVnd(entry.runningBalance)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
