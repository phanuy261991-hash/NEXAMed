import { useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { formatVnd } from '../../shared/format/currency';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from '../cash-book/cash-account.queries';
import { useSettleWalletMutation } from './patient-wallet.queries';

/**
 * "Hoàn tiền & khoá ví" (Tất toán, Ví tạm ứng) — đúng khuôn "Hoàn tiền" ở `InvoiceDetailPage.tsx`
 * (badge tròn nổi bật số tiền, overlay/kích thước modal giống hệt). Còn số dư → bắt buộc chọn
 * phương thức/quỹ hoàn tiền; số dư đã về 0 → xác nhận khoá ngay, không cần chọn gì thêm.
 */
export function SettleWalletDialog({ patientId, balance, onClose }: { patientId: string; balance: number; onClose: () => void }) {
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();
  const settleMutation = useSettleWalletMutation();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);
  const paymentMethodOptions: ComboboxOption[] = useMemo(() => paymentMethods.map((m) => ({ value: m.code, label: m.name })), [paymentMethods]);
  const cashAccountOptions: ComboboxOption[] = useMemo(
    () => cashAccounts.map((a) => ({ value: a.id, label: a.type === 'BANK' ? `${a.name} (${a.bankAccountNo ?? '—'})` : a.name })),
    [cashAccounts],
  );

  const needsMethod = balance > 0;
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paymentMethodCode === '' && paymentMethods.length > 0) {
      setPaymentMethodCode(paymentMethods[0]!.code);
    }
  }, [paymentMethodCode, paymentMethods]);
  useEffect(() => {
    if (cashAccountId === '' && cashAccounts.length > 0) {
      const isCash = paymentMethods.find((m) => m.code === paymentMethodCode)?.countsAsCash ?? true;
      const def = cashAccounts.find((a) => a.isDefault && a.type === (isCash ? 'CASH' : 'BANK')) ?? cashAccounts[0];
      setCashAccountId(def?.id ?? '');
    }
  }, [cashAccountId, cashAccounts, paymentMethodCode, paymentMethods]);

  const isValid = !needsMethod || paymentMethodCode !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setError(null);
    try {
      await settleMutation.mutateAsync({
        patientId,
        paymentMethodCode: needsMethod ? paymentMethodCode : undefined,
        cashAccountId: needsMethod ? cashAccountId || undefined : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="settle-wallet-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="settle-wallet-title" className="text-sm font-semibold text-slate-900">
            Tất toán ví tạm ứng?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Khoá ví lại — không nạp/trừ được nữa sau khi xác nhận.</p>

          <div className="mt-3 flex items-center gap-3 rounded-md bg-violet-50/70 py-2.5 pl-2.5 pr-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-violet-500 text-white">
              <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
            </div>
            <p className="text-xs leading-snug text-slate-700">
              {balance > 0 ? (
                <>
                  Hoàn lại <span className="text-sm font-bold text-slate-900">{formatVnd(balance)}</span> cho khách.
                </>
              ) : (
                'Số dư ví đang là 0đ — không cần hoàn tiền, chỉ khoá ví.'
              )}
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </p>
          )}

          {needsMethod && (
            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="settle-method" className="text-sm font-semibold text-slate-800">
                  Hình thức hoàn <span className="text-rose-500">*</span>
                </label>
                <Combobox id="settle-method" value={paymentMethodCode} options={paymentMethodOptions} onChange={setPaymentMethodCode} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="settle-account" className="text-sm font-semibold text-slate-800">
                  Quỹ xuất tiền <span className="text-rose-500">*</span>
                </label>
                <Combobox id="settle-account" value={cashAccountId} options={cashAccountOptions} onChange={setCashAccountId} />
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" disabled={!isValid} loading={settleMutation.isPending}>
              Xác nhận tất toán
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
