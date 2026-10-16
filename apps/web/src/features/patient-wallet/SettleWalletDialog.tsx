import { useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
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
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={ArrowCounterClockwise}
        tone="danger"
        title="Tất toán ví tạm ứng"
        rows={[{ label: needsMethod ? 'Hoàn lại khách' : 'Số dư ví', value: formatVnd(balance) }]}
        note={needsMethod ? 'Khoá ví, không nạp/trừ được nữa sau khi xác nhận.' : 'Số dư 0đ nên chỉ khoá ví, không nạp/trừ được nữa.'}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" disabled={!isValid} loading={settleMutation.isPending}>
              Xác nhận tất toán
            </Button>
          </>
        }
      >
        {needsMethod && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </ConfirmDialog>
    </form>
  );
}
