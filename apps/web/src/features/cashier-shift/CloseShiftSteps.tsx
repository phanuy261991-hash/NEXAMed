import type { ReactNode } from 'react';
import { Bank, CreditCard, Vault, Wallet } from '@phosphor-icons/react';
import type { CashierShiftSummary } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { DenominationCounter } from '../../shared/ui/DenominationCounter';
import { Skeleton } from '../../shared/ui/Skeleton';

/**
 * 4 bước nội dung của "Chốt ca" (`CloseShiftDialog.tsx`) — trích ra dùng chung khi có nơi gọi thứ
 * hai (`EndOfDayDialog.tsx`, "Chế độ phòng khám 1 người", mockup Artifact đã duyệt 2026-09-14),
 * theo CLAUDE.md "trích xuất khi trùng lặp lần hai". Mỗi hàm chỉ nhận state/handler cần thiết —
 * KHÔNG tự gọi query/mutation nào, để nơi gọi (dialog cha) toàn quyền quyết định lúc nào lưu/tải
 * lại dữ liệu (cùng cách `DenominationCounter`/`MoneyInput` đã dùng chung từ trước).
 */

export function SummaryCard({ label, value, valueClassName, center }: { label: string; value: string; valueClassName?: string; center?: boolean }) {
  return (
    <div className={`rounded-lg border border-slate-200 p-4 ${center ? 'text-center' : ''}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold text-slate-900 ${valueClassName ?? ''}`}>{value}</div>
    </div>
  );
}

/** Bước "Tổng kết hệ thống" — hero "Tổng doanh thu ca" + 3 thẻ tiền mặt + phi tiền mặt. */
export function CloseShiftRevenueStep({
  summary,
  isPending,
  blind,
  openingFloatActual,
}: {
  summary: CashierShiftSummary | undefined;
  isPending: boolean;
  blind: boolean;
  openingFloatActual: number;
}) {
  if (isPending || !summary) {
    return <Skeleton className="h-40 w-full" />;
  }

  const { cashInAmount, cashOutAmount, cashInCount, cashOutCount, nonCashBreakdown, expectedCashAmount: expected } = summary;
  const cashNet = cashInAmount - cashOutAmount;
  const nonCashNet = nonCashBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const totalRevenue = cashNet + nonCashNet;
  const cashPct = totalRevenue !== 0 ? Math.round((cashNet / totalRevenue) * 100) : 0;
  const nonCashPct = 100 - cashPct;

  return (
    <>
      {/* "Tổng doanh thu ca" (`docs/DECISIONS.md` #120) — tiền mặt ròng + phi tiền mặt ròng, KHÔNG
          cộng vốn đầu ca (không phải doanh thu phát sinh trong ca này). */}
      <div className="rounded-xl border border-brand-teal/20 bg-brand-teal-panel px-4.5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-brand-teal/30 bg-white text-brand-teal-active">
            <Wallet size={18} weight="regular" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-teal-active">Tổng doanh thu ca</div>
            <div className="text-[10px] font-medium text-brand-teal-active">Tiền mặt + các hình thức khác, đã trừ hoàn tiền</div>
          </div>
        </div>

        {blind ? (
          <div className="mt-3 text-[23px] font-bold tracking-[0.12em] text-brand-teal-active/60">*.***.*** đ</div>
        ) : (
          <div className="mt-3 text-[29px] font-bold text-slate-900">{formatVnd(totalRevenue)}</div>
        )}

        {!blind && totalRevenue > 0 && (
          <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-white/60" aria-hidden="true">
            <div className="bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, cashPct))}%` }} />
            <div className="bg-brand-teal-active" style={{ width: `${Math.max(0, Math.min(100, nonCashPct))}%` }} />
          </div>
        )}

        <div className="mt-2.75 flex flex-wrap gap-4.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-teal-active">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
            Tiền mặt <span className="font-bold text-slate-900">{blind ? 'ẩn — hiện sau khi đếm' : `${formatVnd(cashNet)} · ${cashPct}%`}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-teal-active">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-teal-active" aria-hidden="true" />
            Phi tiền mặt <span className="font-bold text-slate-900">{formatVnd(nonCashNet)} · {nonCashPct}%</span>
          </div>
        </div>
      </div>

      <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tiền mặt — cần đếm tay để đối soát</div>
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Vốn đầu ca" value={formatVnd(openingFloatActual)} />
        <SummaryCard
          label={`Tổng thu tiền mặt (${cashInCount} phiếu)`}
          value={blind ? '*.***.*** đ' : `+${formatVnd(cashInAmount)}`}
          valueClassName={blind ? 'tracking-widest text-slate-300' : 'text-emerald-600'}
        />
        <SummaryCard
          label={`Chi tiền mặt — hoàn tiền (${cashOutCount} phiếu)`}
          value={blind ? '*.***.*** đ' : `−${formatVnd(cashOutAmount)}`}
          valueClassName={blind ? 'tracking-widest text-slate-300' : 'text-rose-600'}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-600">Tiền mặt dự kiến trong két</div>
          <div className="text-xs font-medium text-slate-500">Gồm {formatVnd(openingFloatActual)} vốn đầu ca</div>
        </div>
        {blind ? (
          <span className="text-lg font-bold tracking-widest text-blue-300">*.***.***</span>
        ) : (
          <span className="text-lg font-bold text-blue-700">{formatVnd(expected)}</span>
        )}
      </div>

      {nonCashBreakdown.length > 0 && (
        <>
          <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Phi tiền mặt — đối chiếu qua sao kê, không cần đếm tay</div>
          <div className="grid grid-cols-2 gap-3">
            {nonCashBreakdown.map((item) => {
              const negative = item.amount < 0;
              return (
                <div key={item.method} className={`flex items-center gap-3 rounded-lg border p-4 ${negative ? 'border-rose-200 bg-rose-50' : 'border-slate-200'}`}>
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${negative ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    {item.method === 'BANK_TRANSFER' ? <Bank size={18} weight="regular" aria-hidden="true" /> : <CreditCard size={18} weight="regular" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-500">
                      {item.methodLabel} · {item.count} giao dịch
                    </div>
                    <div className={`text-lg font-bold ${negative ? 'text-rose-600' : 'text-slate-900'}`}>
                      {negative ? `−${formatVnd(Math.abs(item.amount))}` : formatVnd(item.amount)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/** Bước "Kiểm đếm tiền mặt" — toolbar (Lập phiếu thu/chi + Nhập trực tiếp) + máy tính mệnh giá. */
export function CloseShiftCountStep({
  countedAmount,
  onChangeCountedAmount,
  directEntry,
  onToggleDirectEntry,
  canCreateCashVoucher,
  onOpenCashVoucherModal,
}: {
  countedAmount: number;
  onChangeCountedAmount: (value: number) => void;
  directEntry: boolean;
  onToggleDirectEntry: () => void;
  canCreateCashVoucher: boolean;
  onOpenCashVoucherModal: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">Đếm từng mệnh giá — hệ thống tự cộng tổng.</p>
        <div className="flex flex-shrink-0 items-center gap-3">
          {canCreateCashVoucher && (
            <button type="button" onClick={onOpenCashVoucherModal} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
              <Vault size={13} weight="bold" aria-hidden="true" />
              Lập phiếu thu/chi
            </button>
          )}
          <button type="button" onClick={onToggleDirectEntry} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            {directEntry ? 'Dùng máy tính mệnh giá' : 'Nhập trực tiếp tổng số tiền'}
          </button>
        </div>
      </div>
      {directEntry ? (
        <div>
          <label htmlFor="direct-total" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Tổng tiền mặt đếm được <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <MoneyInput
              id="direct-total"
              value={countedAmount}
              onChange={(v) => onChangeCountedAmount(v ?? 0)}
              className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
          </div>
        </div>
      ) : (
        <DenominationCounter value={countedAmount} onChange={onChangeCountedAmount} />
      )}
    </div>
  );
}

/** Bước "Đối soát" — Dự kiến/Thực đếm/Chênh lệch + lý do giải trình nếu lệch. */
export function CloseShiftReconcileStep({
  expected,
  countedAmount,
  discrepancyReason,
  onChangeDiscrepancyReason,
}: {
  expected: number;
  countedAmount: number;
  discrepancyReason: string;
  onChangeDiscrepancyReason: (value: string) => void;
}) {
  const diff = countedAmount - expected;
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <SummaryCard label="Dự kiến" value={formatVnd(expected)} center />
        <SummaryCard label="Thực đếm" value={formatVnd(countedAmount)} center />
        <div className={`rounded-lg border-2 p-4 text-center ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
          <div className={`text-[11px] font-bold uppercase tracking-wide ${diff === 0 ? 'text-emerald-600' : 'text-rose-500'}`}>Chênh lệch</div>
          <div className={`mt-1 text-lg font-bold ${diff === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '−'}${formatVnd(Math.abs(diff))}`}
          </div>
        </div>
      </div>

      {diff === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          Khớp tuyệt đối — không cần giải trình, có thể tiếp tục.
        </div>
      ) : (
        <div>
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">Có chênh lệch — bắt buộc giải trình trước khi tiếp tục.</div>
          <label htmlFor="diff-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Lý do chênh lệch <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="diff-reason"
            rows={3}
            required
            value={discrepancyReason}
            onChange={(e) => onChangeDiscrepancyReason(e.target.value)}
            placeholder="Ví dụ: trả nhầm tiền thừa cho khách lúc 10:20, khách chuyển khoản nhưng quên ghi nhận..."
            className="w-full rounded-md border border-rose-300 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      )}
    </div>
  );
}

/** Bước "Bàn giao" — tiền để lại vốn ca sau + ghi chú bàn giao. `extraNotice` cho phép nơi gọi
 * chèn thêm 1 khối thông báo riêng (ví dụ "sẽ tự động Duyệt" ở `EndOfDayDialog.tsx`) NGAY TRÊN
 * cảnh báo khoá dữ liệu mặc định, không phải fork lại toàn bộ bước này. */
export function CloseShiftHandoverStep({
  keepAmount,
  onChangeKeepAmount,
  submittedAmount,
  handoverNote,
  onChangeHandoverNote,
  error,
  extraNotice,
}: {
  keepAmount: number;
  onChangeKeepAmount: (value: number) => void;
  submittedAmount: number;
  handoverNote: string;
  onChangeHandoverNote: (value: string) => void;
  error: string | null;
  extraNotice?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor="handover-keep" className="mb-1.5 block text-sm font-semibold text-slate-800">
        Tiền mặt để lại làm vốn cho ca sau
      </label>
      <div className="relative">
        <MoneyInput
          id="handover-keep"
          value={keepAmount}
          onChange={(v) => onChangeKeepAmount(v ?? 0)}
          className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 p-4">
        <span className="text-sm font-semibold text-slate-700">Tiền mặt nộp về (chủ phòng khám / kế toán)</span>
        <span className="text-xl font-bold text-blue-700">{formatVnd(submittedAmount)}</span>
      </div>

      <div className="mt-4">
        <label htmlFor="handover-note" className="mb-1.5 block text-sm font-semibold text-slate-800">
          Ghi chú bàn giao <span className="font-normal normal-case text-slate-400">(tuỳ chọn)</span>
        </label>
        <textarea
          id="handover-note"
          rows={2}
          value={handoverNote}
          onChange={(e) => onChangeHandoverNote(e.target.value)}
          placeholder="Ví dụ: đã kiểm tra cùng Quản lý ca, tiền đã cất vào két sắt văn phòng."
          className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {extraNotice}

      <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-medium text-amber-800">
          Sau khi xác nhận, dữ liệu ca này bị khoá hoàn toàn — bạn không tự sửa lại được. Muốn sửa/huỷ phải có tài khoản Quản lý duyệt mở khoá.
        </p>
      </div>

      {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
