import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt } from '@phosphor-icons/react';
import type { CashAccount, CashVoucher, ReferenceCatalogDirection, ReferenceCatalogItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from './cash-account.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Quỹ mặc định khớp `countsAsCash` của hình thức đang chọn — CASH nếu tiền mặt, BANK nếu không (đúng khuôn `InvoiceService.resolveCashAccountId`). */
function findDefaultCashAccount(accounts: CashAccount[], countsAsCash: boolean): CashAccount | undefined {
  return accounts.find((a) => a.isActive && a.isDefault && a.type === (countsAsCash ? 'CASH' : 'BANK'));
}

interface FormValues {
  direction: ReferenceCatalogDirection;
  incomeExpenseTypeCode: string;
  cashAccountId: string;
  paymentMethodCode: string;
  amount: number | undefined;
  occurredAt: string;
  partnerName: string;
  description: string;
  note: string;
}

export interface CashVoucherSubmitDto {
  direction?: ReferenceCatalogDirection;
  incomeExpenseTypeCode: string;
  cashAccountId: string;
  paymentMethodCode: string;
  amount: number;
  occurredAt: string;
  partnerName: string | null;
  description: string;
  note: string | null;
}

/**
 * "Lập phiếu thu/chi" (Sổ quỹ & Thu chi GĐ1, mockup Artifact duyệt 2026-09-05) — dùng chung cho 2
 * nút tắt (`InvoiceListPage.tsx`, `CloseShiftDialog.tsx`) lẫn trang "Phiếu thu / Phiếu chi". Đúng
 * khuôn `WorkShiftFormModal.tsx` ("Lưu và nhập tiếp" mục 4.7, Enter-to-submit mục 4.4). `direction`
 * CHỈ chọn được lúc TẠO (backend không cho đổi chiều tiền của phiếu đã lập).
 */
export function CashVoucherFormDialog({
  mode,
  voucher,
  initialDirection = 'INCOME',
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  voucher?: CashVoucher;
  initialDirection?: ReferenceCatalogDirection;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: CashVoucherSubmitDto) => Promise<void>;
}) {
  const partnerInputRef = useRef<HTMLInputElement>(null);
  const { flashVisible, triggerFlash } = useSaveFlash();

  const incomeExpenseTypeQuery = useReferenceCatalogQuery('INCOME_EXPENSE_TYPE');
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);

  const [values, setValues] = useState<FormValues>(() => {
    const defaultMethod = paymentMethods[0]?.code ?? '';
    const isCash = paymentMethods.find((m) => m.code === defaultMethod)?.countsAsCash ?? true;
    const defaultAccount = findDefaultCashAccount(cashAccounts, isCash) ?? cashAccounts[0];
    return {
      direction: voucher?.direction ?? initialDirection,
      incomeExpenseTypeCode: voucher?.incomeExpenseTypeCode ?? '',
      cashAccountId: voucher?.cashAccountId ?? defaultAccount?.id ?? '',
      paymentMethodCode: voucher?.paymentMethodCode ?? defaultMethod,
      amount: voucher?.amount,
      occurredAt: voucher?.occurredAt ? voucher.occurredAt.slice(0, 10) : todayDateString(),
      partnerName: voucher?.partnerName ?? '',
      description: voucher?.description ?? '',
      note: voucher?.note ?? '',
    };
  });

  // Danh mục Hình thức/Quỹ tải BẤT ĐỒNG BỘ (React Query) — lúc modal mount lần đầu 2 mảng này rỗng,
  // nên khởi tạo `values` ở trên (chạy đúng 1 lần) không điền được giá trị mặc định. Backfill khi
  // dữ liệu về, CHỈ khi field còn rỗng (không đè lựa chọn người dùng đã tự đổi) — bug thật phát
  // hiện lúc kiểm bằng Playwright: 2 ô "Hình thức"/"Quỹ" hiện trống dù logic mặc định có sẵn.
  useEffect(() => {
    if (mode !== 'create') return;
    setValues((v) => {
      let next = v;
      if (next.paymentMethodCode === '' && paymentMethods.length > 0) {
        next = { ...next, paymentMethodCode: paymentMethods[0]!.code };
      }
      if (next.cashAccountId === '' && cashAccounts.length > 0) {
        const isCash = paymentMethods.find((m) => m.code === next.paymentMethodCode)?.countsAsCash ?? true;
        const defaultAccount = findDefaultCashAccount(cashAccounts, isCash) ?? cashAccounts[0];
        next = { ...next, cashAccountId: defaultAccount?.id ?? next.cashAccountId };
      }
      return next;
    });
  }, [mode, paymentMethods, cashAccounts]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handlePaymentMethodChange(code: string) {
    const isCash = paymentMethods.find((m) => m.code === code)?.countsAsCash ?? true;
    const defaultAccount = findDefaultCashAccount(cashAccounts, isCash);
    setValues((v) => ({ ...v, paymentMethodCode: code, cashAccountId: defaultAccount?.id ?? v.cashAccountId }));
  }

  const incomeExpenseTypeOptions: ComboboxOption[] = useMemo(
    () =>
      (incomeExpenseTypeQuery.data?.items ?? [])
        .filter((i: ReferenceCatalogItem) => i.isActive && i.direction === values.direction)
        .map((i) => ({ value: i.code, label: i.name })),
    [incomeExpenseTypeQuery.data, values.direction],
  );
  const paymentMethodOptions: ComboboxOption[] = useMemo(() => paymentMethods.map((m) => ({ value: m.code, label: m.name })), [paymentMethods]);
  const cashAccountOptions: ComboboxOption[] = useMemo(
    () => cashAccounts.map((a) => ({ value: a.id, label: a.type === 'BANK' ? `${a.name} (${a.bankAccountNo ?? '—'})` : a.name })),
    [cashAccounts],
  );

  const isValid =
    values.incomeExpenseTypeCode !== '' &&
    values.cashAccountId !== '' &&
    values.paymentMethodCode !== '' &&
    (values.amount ?? 0) > 0 &&
    values.description.trim() !== '';

  function buildDto(): CashVoucherSubmitDto {
    return {
      direction: mode === 'create' ? values.direction : undefined,
      incomeExpenseTypeCode: values.incomeExpenseTypeCode,
      cashAccountId: values.cashAccountId,
      paymentMethodCode: values.paymentMethodCode,
      amount: values.amount ?? 0,
      occurredAt: values.occurredAt,
      partnerName: values.partnerName.trim() || null,
      description: values.description.trim(),
      note: values.note.trim() || null,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    await onSubmit(buildDto());
    onCancel();
  }

  async function handleSaveAndContinue() {
    if (!isValid) return;
    await onSubmit(buildDto());
    setValues((v) => ({ ...v, amount: undefined, partnerName: '', description: '', note: '' }));
    partnerInputRef.current?.focus();
    triggerFlash();
  }

  const isIncome = values.direction === 'INCOME';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader
          icon={Receipt}
          title={mode === 'create' ? 'Lập phiếu thu/chi' : 'Sửa phiếu'}
          subtitle="Sổ quỹ & Thu chi"
          onClose={onCancel}
          right={voucher ? <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{voucher.voucherNo}</span> : undefined}
        />

        <SaveFlashBanner visible={flashVisible} />

        <div className="space-y-4">
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <button
              type="button"
              disabled={mode === 'edit'}
              onClick={() => set('direction', 'INCOME')}
              className={`flex-1 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                isIncome ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              Phiếu thu
            </button>
            <button
              type="button"
              disabled={mode === 'edit'}
              onClick={() => set('direction', 'EXPENSE')}
              className={`flex-1 border-l border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                !isIncome ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              Phiếu chi
            </button>
          </div>

          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="cv-type" className="text-sm font-semibold text-slate-800">
                Loại {isIncome ? 'thu' : 'chi'} <span className="text-rose-500">*</span>
              </label>
              <Combobox
                id="cv-type"
                value={values.incomeExpenseTypeCode}
                options={incomeExpenseTypeOptions}
                onChange={(v) => set('incomeExpenseTypeCode', v)}
                placeholder={`Chọn loại ${isIncome ? 'thu' : 'chi'}...`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cv-method" className="text-sm font-semibold text-slate-800">
                Hình thức <span className="text-rose-500">*</span>
              </label>
              <Combobox id="cv-method" value={values.paymentMethodCode} options={paymentMethodOptions} onChange={handlePaymentMethodChange} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cv-account" className="text-sm font-semibold text-slate-800">
                Quỹ <span className="text-rose-500">*</span>
              </label>
              <Combobox id="cv-account" value={values.cashAccountId} options={cashAccountOptions} onChange={(v) => set('cashAccountId', v)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cv-amount" className="text-sm font-semibold text-slate-800">
                Số tiền <span className="text-rose-500">*</span>
              </label>
              <MoneyInput id="cv-amount" value={values.amount} onChange={(v) => set('amount', v)} className={inputClassName} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cv-occurred-at" className="text-sm font-semibold text-slate-800">
                Ngày phát sinh
              </label>
              <input id="cv-occurred-at" type="date" value={values.occurredAt} onChange={(e) => set('occurredAt', e.target.value)} className={inputClassName} />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="cv-partner" className="text-sm font-semibold text-slate-800">
                {isIncome ? 'Người nộp tiền' : 'Người nhận tiền'}
              </label>
              <input
                ref={partnerInputRef}
                id="cv-partner"
                value={values.partnerName}
                onChange={(e) => set('partnerName', e.target.value)}
                className={inputClassName}
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="cv-description" className="text-sm font-semibold text-slate-800">
                Diễn giải <span className="text-rose-500">*</span>
              </label>
              <input
                id="cv-description"
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={isIncome ? 'Ví dụ: Bán phế liệu' : 'Ví dụ: Tiền điện tháng 8/2026'}
                className={inputClassName}
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="cv-note" className="text-sm font-semibold text-slate-800">
                Ghi chú
              </label>
              <textarea id="cv-note" rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} className={inputClassName} />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={!isValid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
