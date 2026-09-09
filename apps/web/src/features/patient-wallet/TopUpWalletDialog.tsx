import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Printer } from '@phosphor-icons/react';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { formatVnd } from '../../shared/format/currency';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from '../cash-book/cash-account.queries';
import { usePatientQuery } from '../patient/patient.queries';
import { useTopUpWalletMutation, useWalletQuery } from './patient-wallet.queries';
import { WalletReceiptPrintView } from './WalletReceiptPrintView';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const readonlyClassName = 'w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-semibold text-slate-800';

interface ReceiptData {
  voucherNo: string;
  occurredAt: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
  paymentMethodLabel: string;
}

/**
 * "Nạp tạm ứng" (Ví tạm ứng, mockup Artifact màn 4 đã chốt) — form đơn khối (không cần 2 BoxedSection
 * như `CashVoucherFormDialog.tsx`, đúng mockup: 6 trường vừa đủ 1 khối). Mở từ tab "Ví tạm ứng" ở Hồ
 * sơ bệnh nhân, hoặc từ ô nạp bổ sung ở màn Chi tiết thanh toán khi ví thiếu tiền.
 */
export function TopUpWalletDialog({ patientId, defaultAmount, onClose }: { patientId: string; defaultAmount?: number; onClose: () => void }) {
  const patientQuery = usePatientQuery(patientId);
  const walletQuery = useWalletQuery(patientId);
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();
  const clinicHeaderQuery = useClinicPrintHeaderQuery();
  const topUpMutation = useTopUpWalletMutation();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);
  const paymentMethodOptions: ComboboxOption[] = useMemo(() => paymentMethods.map((m) => ({ value: m.code, label: m.name })), [paymentMethods]);
  const cashAccountOptions: ComboboxOption[] = useMemo(
    () => cashAccounts.map((a) => ({ value: a.id, label: a.type === 'BANK' ? `${a.name} (${a.bankAccountNo ?? '—'})` : a.name })),
    [cashAccounts],
  );

  const [amount, setAmount] = useState<number | undefined>(defaultAmount);
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // Danh mục Hình thức/Quỹ tải bất đồng bộ — backfill mặc định khi về, chỉ khi field còn rỗng
  // (đúng bug đã sửa ở CashVoucherFormDialog.tsx, không lặp lại ở đây).
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

  function handlePaymentMethodChange(code: string) {
    const isCash = paymentMethods.find((m) => m.code === code)?.countsAsCash ?? true;
    const def = cashAccounts.find((a) => a.isDefault && a.type === (isCash ? 'CASH' : 'BANK'));
    setPaymentMethodCode(code);
    if (def) setCashAccountId(def.id);
  }

  const isValid = (amount ?? 0) > 0 && paymentMethodCode !== '';
  const balanceBefore = walletQuery.data?.balance ?? 0;
  const balanceAfterPreview = balanceBefore + (amount ?? 0);

  async function submit(print: boolean) {
    if (!isValid) return;
    setError(null);
    try {
      const result = await topUpMutation.mutateAsync({
        patientId,
        amount: amount!,
        paymentMethodCode,
        cashAccountId: cashAccountId || undefined,
        note: note.trim() || undefined,
      });
      if (print) {
        setReceipt({
          voucherNo: result.voucherNo,
          occurredAt: result.occurredAt,
          balanceBefore,
          balanceAfter: result.wallet.balance,
          amount: amount!,
          paymentMethodLabel: paymentMethods.find((m) => m.code === paymentMethodCode)?.name ?? paymentMethodCode,
        });
        setPrinting(true);
        setTimeout(() => {
          window.print();
          setPrinting(false);
          onClose();
        }, 100);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={PlusCircle} title="Nạp tạm ứng" subtitle={patientQuery.data ? `Ví: ${patientQuery.data.fullName}` : undefined} onClose={onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {error && (
            <p role="alert" className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-slate-800">
                Bệnh nhân <span className="text-rose-500">*</span>
              </label>
              <div className={readonlyClassName}>
                {patientQuery.data ? `${patientQuery.data.fullName} — ${patientQuery.data.patientCode}` : 'Đang tải...'}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-slate-800">Số dư hiện tại</label>
              <div className={`${readonlyClassName} text-right tabular-nums`}>{formatVnd(balanceBefore)}</div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="topup-amount" className="text-sm font-semibold text-slate-800">
                Số tiền nạp <span className="text-rose-500">*</span>
              </label>
              <MoneyInput id="topup-amount" value={amount} onChange={setAmount} className={`${inputClassName} text-right text-[17px]`} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="topup-method" className="text-sm font-semibold text-slate-800">
                Hình thức <span className="text-rose-500">*</span>
              </label>
              <Combobox id="topup-method" value={paymentMethodCode} options={paymentMethodOptions} onChange={handlePaymentMethodChange} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="topup-account" className="text-sm font-semibold text-slate-800">
                Quỹ nhận tiền <span className="text-rose-500">*</span>
              </label>
              <Combobox id="topup-account" value={cashAccountId} options={cashAccountOptions} onChange={setCashAccountId} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-slate-800">Ngày nạp</label>
              <div className={readonlyClassName}>Hôm nay</div>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="topup-note" className="text-sm font-semibold text-slate-800">
                Nội dung
              </label>
              <input id="topup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: Tạm ứng thủ thuật tiểu phẫu" className={inputClassName} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Số dư sau khi nạp</span>
            <span className="text-lg font-bold tabular-nums text-emerald-700">{formatVnd(balanceAfterPreview)}</span>
          </div>

          {printing && receipt && patientQuery.data && clinicHeaderQuery.data && (
            <WalletReceiptPrintView
              clinicHeader={clinicHeaderQuery.data}
              voucherNo={receipt.voucherNo}
              occurredAt={receipt.occurredAt}
              patientFullName={patientQuery.data.fullName}
              patientCode={patientQuery.data.patientCode}
              note={note.trim() || null}
              paymentMethodLabel={receipt.paymentMethodLabel}
              balanceBefore={receipt.balanceBefore}
              balanceAfter={receipt.balanceAfter}
              amount={receipt.amount}
            />
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={topUpMutation.isPending}>
            Huỷ
          </Button>
          <Button type="button" variant="secondary" loading={topUpMutation.isPending} disabled={!isValid} onClick={() => void submit(false)}>
            Lưu
          </Button>
          <Button type="button" loading={topUpMutation.isPending} disabled={!isValid} onClick={() => void submit(true)}>
            <Printer size={15} weight="bold" aria-hidden="true" />
            Lưu &amp; in phiếu
          </Button>
        </div>
      </form>
    </div>
  );
}
