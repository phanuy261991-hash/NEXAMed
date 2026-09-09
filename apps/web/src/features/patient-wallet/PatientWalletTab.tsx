import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarBlank, PlusCircle, Receipt, Wallet, XCircle } from '@phosphor-icons/react';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Button } from '../../shared/ui/Button';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { useWalletQuery, useWalletTransactionsQuery } from './patient-wallet.queries';
import { formatWalletDate, formatWalletDateTime, walletTransactionDescription, walletTransactionMeta } from './wallet-format';
import { TopUpWalletDialog } from './TopUpWalletDialog';
import { SettleWalletDialog } from './SettleWalletDialog';

const BADGE_TONE_MAP: Record<ReturnType<typeof walletTransactionMeta>['badgeTone'], StatusBadgeTone> = {
  success: 'success',
  info: 'info',
  accent: 'accent',
  neutral: 'neutral',
};

/**
 * Tab "Ví tạm ứng" trong Hồ sơ bệnh nhân — khối số dư + 3 ô thống kê + bảng lịch sử giao dịch, đúng
 * mockup đã chốt (Artifact `wallet-mockup.html`). Bám nguyên token màu/cỡ chữ đã duyệt, không tự đổi.
 */
export function PatientWalletTab({ patientId }: { patientId: string }) {
  const walletQuery = useWalletQuery(patientId);
  const txQuery = useWalletTransactionsQuery(patientId);
  const canTopUp = useHasPermission('patient_wallet', 'topup');
  const canSettle = useHasPermission('patient_wallet', 'settle');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);

  if (walletQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (walletQuery.isError) {
    return <ErrorBanner message="Không tải được thông tin ví tạm ứng." onRetry={() => void walletQuery.refetch()} />;
  }

  const wallet = walletQuery.data;
  const transactions = txQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const isActive = wallet?.status === 'ACTIVE';

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(260px,1.1fr)_repeat(3,minmax(120px,0.75fr))]">
        <div className="flex flex-col justify-between gap-3.5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-emerald-700">
              <Wallet size={14} weight="fill" aria-hidden="true" />
              Số dư khả dụng
            </div>
            <div className="text-[30px] font-bold leading-tight tabular-nums text-emerald-700">{formatVnd(wallet?.balance ?? 0)}</div>
            {wallet && (
              <p className="mt-1 text-[13px] text-emerald-700">
                {isActive ? 'Ví đang hoạt động' : 'Ví đã khoá (đã tất toán)'}
                {wallet.lastTransactionAt && <> · Cập nhật {formatWalletDateTime(wallet.lastTransactionAt)}</>}
              </p>
            )}
          </div>
          {canTopUp && isActive && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="success" onClick={() => setTopUpOpen(true)}>
                <PlusCircle size={16} weight="bold" aria-hidden="true" />
                Nạp tạm ứng
              </Button>
              {canSettle && (wallet?.balance ?? 0) >= 0 && (
                <Button type="button" variant="dangerGhost" onClick={() => setSettleOpen(true)}>
                  Hoàn tiền &amp; khoá ví
                </Button>
              )}
            </div>
          )}
          {!wallet && canTopUp && (
            <Button type="button" variant="success" onClick={() => setTopUpOpen(true)}>
              <PlusCircle size={16} weight="bold" aria-hidden="true" />
              Nạp tạm ứng
            </Button>
          )}
        </div>

        <div className="flex flex-col justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-sm">
          <span className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Tổng đã nạp</span>
          <span className="text-[19px] font-bold tabular-nums text-slate-900">{formatVnd(wallet?.totalToppedUp ?? 0)}</span>
          <span className="text-sm font-medium text-slate-600">{wallet?.topUpCount ?? 0} lần nạp</span>
        </div>
        <div className="flex flex-col justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-sm">
          <span className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Đã sử dụng</span>
          <span className="text-[19px] font-bold tabular-nums text-slate-900">{formatVnd(wallet?.totalUsed ?? 0)}</span>
          <span className="text-sm font-medium text-slate-600">{wallet?.deductCount ?? 0} lượt khám</span>
        </div>
        <div className="flex flex-col justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-sm">
          <span className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Giao dịch gần nhất</span>
          <span className="text-[19px] font-bold text-slate-900">{wallet?.lastTransactionAt ? formatWalletDate(wallet.lastTransactionAt) : '—'}</span>
          <span className="truncate text-sm font-medium text-slate-600">{transactions[0] ? walletTransactionDescription(transactions[0]) : 'Chưa có giao dịch'}</span>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Receipt size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
            Lịch sử giao dịch ví
          </span>
        </div>

        {transactions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Chưa có giao dịch nào.</p>
        ) : (
          <div className="scroll-hover overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-3 py-2.5 text-center">Thời gian</th>
                  <th className="px-3 py-2.5 text-center">Chứng từ</th>
                  <th className="px-3 py-2.5 text-center">Loại</th>
                  <th className="px-3 py-2.5 text-left">Nội dung</th>
                  <th className="px-3 py-2.5 text-right">Biến động</th>
                  <th className="px-3 py-2.5 text-right">Số dư sau</th>
                  <th className="px-3 py-2.5 text-left">Người thực hiện</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const meta = walletTransactionMeta(tx);
                  const isCredit = tx.type === 'TOPUP' || tx.type === 'REFUND';
                  return (
                    <tr key={tx.id} className="border-b border-slate-100 font-medium last:border-0">
                      <td className="whitespace-nowrap px-3 py-3 text-center text-slate-700">{formatWalletDateTime(tx.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-center">
                        {tx.invoiceId && tx.encounterId ? (
                          <Link to={`/billing/${tx.encounterId}`} className="font-medium text-blue-600 hover:text-blue-700">
                            {tx.invoiceNo}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-800">{tx.voucherNo ?? '—'}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-center">
                        <StatusBadge tone={BADGE_TONE_MAP[meta.badgeTone]}>{meta.label}</StatusBadge>
                      </td>
                      <td className="px-3 py-3 text-left text-slate-700">{walletTransactionDescription(tx)}</td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums ${isCredit ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {isCredit ? '+' : '−'}
                        {formatVnd(tx.amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-slate-900">{formatVnd(tx.balanceAfter)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-left text-slate-700">{tx.createdByName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {txQuery.hasNextPage && (
          <div className="border-t border-slate-100 px-5 py-3 text-center">
            <Button type="button" variant="secondary" loading={txQuery.isFetchingNextPage} onClick={() => void txQuery.fetchNextPage()}>
              Tải thêm
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-600">
        <CalendarBlank size={16} className="mt-0.5 flex-none text-slate-400" aria-hidden="true" />
        <span>
          Mỗi dòng &quot;Nạp tiền&quot; và &quot;Tất toán&quot; đều gắn với một phiếu thu/chi thật trong Sổ quỹ. Dòng &quot;Cấn trừ&quot; và &quot;Hoàn về ví&quot;
          không đụng tới két — tiền đã nằm trong quỹ từ lúc nạp.
        </span>
      </div>

      {!isActive && wallet && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <XCircle size={16} weight="fill" className="flex-none text-slate-400" aria-hidden="true" />
          Ví đã tất toán và khoá — không nạp/trừ được nữa.
        </div>
      )}

      {topUpOpen && <TopUpWalletDialog patientId={patientId} onClose={() => setTopUpOpen(false)} />}
      {settleOpen && wallet && <SettleWalletDialog patientId={patientId} balance={wallet.balance} onClose={() => setSettleOpen(false)} />}
    </div>
  );
}
