import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCircleDown, ArrowCircleUp, Printer, Receipt } from '@phosphor-icons/react';
import type { CashAccount, CashVoucher, ReferenceCatalogDirection, ReferenceCatalogItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from './cash-account.queries';
import { CashVoucherPrintView } from './CashVoucherPrintView';
import { usePrintCashVoucherMutation } from './cash-voucher.queries';

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
  onSubmit: (dto: CashVoucherSubmitDto) => Promise<CashVoucher>;
}) {
  const partnerInputRef = useRef<HTMLInputElement>(null);
  const { flashVisible, triggerFlash } = useSaveFlash();
  const [printTarget, setPrintTarget] = useState<CashVoucher | null>(null);
  const [printing, setPrinting] = useState(false);
  const printMutation = usePrintCashVoucherMutation();
  const clinicHeaderQuery = useClinicPrintHeaderQuery();

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

  /** "Lưu và in phiếu" — lưu xong lấy `id` phiếu vừa tạo/sửa, đánh dấu đã in (đúng khuôn
   * `CashVoucherDetailDialog.handlePrint()`), render `CashVoucherPrintView` ẩn để `window.print()`
   * chụp đúng nội dung rồi mới gọi thật (setTimeout đợi React vẽ xong). `window.print()` CHẶN
   * luồng JS tới khi người dùng đóng hộp thoại in — đóng modal (`onCancel()`) ngay sau đó là an
   * toàn, không cắt ngang lúc trình duyệt đang in. */
  async function handleSaveAndPrint() {
    if (!isValid) return;
    const created = await onSubmit(buildDto());
    await printMutation.mutateAsync(created.id);
    setPrintTarget(created);
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
      onCancel();
    }, 100);
  }

  function labelFor(catalog: ReferenceCatalogItem[] | undefined, code: string): string {
    return catalog?.find((i) => i.code === code)?.name ?? code;
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
      {/* Header + footer CỐ ĐỊNH, chỉ vùng giữa cuộn (`min-h-0 flex-1 overflow-y-auto`) — đúng
          khuôn `ExamTypeFormModal.tsx` (form dài hơn, cùng vấn đề). Trước đó cả `<form>` cuộn
          chung khiến header/nút hành động trôi mất khỏi khung nhìn khi nội dung dài. */}
      <form className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader
            icon={Receipt}
            title={mode === 'create' ? 'Lập phiếu thu/chi' : 'Sửa phiếu'}
            subtitle="Sổ quỹ & Thu chi"
            onClose={onCancel}
            right={voucher ? <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{voucher.voucherNo}</span> : undefined}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <SaveFlashBanner visible={flashVisible} />

          <div className="space-y-5 pb-6">
          {/* Segmented control trên nền xám (thay 2 nút vuông viền cứng cũ) — icon khớp đúng
              `ArrowCircleDown`/`ArrowCircleUp` đã dùng ở `CashVoucherListPage.tsx` để đồng nhất
              ngôn ngữ hình ảnh Thu (xanh lá)/Chi (đỏ) xuyên suốt tính năng. */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1.5">
            <button
              type="button"
              disabled={mode === 'edit'}
              onClick={() => set('direction', 'INCOME')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isIncome ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
              }`}
            >
              <ArrowCircleDown size={18} weight="bold" aria-hidden="true" />
              Phiếu thu
            </button>
            <button
              type="button"
              disabled={mode === 'edit'}
              onClick={() => set('direction', 'EXPENSE')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                !isIncome ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
              }`}
            >
              <ArrowCircleUp size={18} weight="bold" aria-hidden="true" />
              Phiếu chi
            </button>
          </div>

          {/* Lưới 3 cột × 2 hàng — đúng 6 trường, khối hình chữ nhật vuông vức (ui-guidelines mục
              4.1 "Cân bằng thị giác"), thay bố cục 2 cột dồn dọc cũ. */}
          <BoxedSection badge="Thông tin phiếu">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
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
              <div className="flex flex-col gap-1.5">
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
            </div>
          </BoxedSection>

          <BoxedSection badge="Chi tiết">
            <div className="grid grid-cols-1 gap-y-4">
              <div className="flex flex-col gap-1.5">
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cv-note" className="text-sm font-semibold text-slate-800">
                  Ghi chú
                </label>
                <textarea id="cv-note" rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} className={inputClassName} />
              </div>
            </div>
          </BoxedSection>

          {printing && printTarget && clinicHeaderQuery.data && (
            <CashVoucherPrintView
              voucher={printTarget}
              clinicHeader={clinicHeaderQuery.data}
              incomeExpenseTypeLabel={labelFor(incomeExpenseTypeQuery.data?.items, printTarget.incomeExpenseTypeCode)}
              cashAccountName={cashAccounts.find((a) => a.id === printTarget.cashAccountId)?.name ?? '—'}
              paymentMethodLabel={labelFor(paymentMethodQuery.data?.items, printTarget.paymentMethodCode)}
            />
          )}
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={!isValid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="button" variant="secondary" loading={printMutation.isPending} disabled={!isValid} onClick={handleSaveAndPrint}>
            <Printer size={15} weight="bold" aria-hidden="true" />
            Lưu và in phiếu
          </Button>
          <Button type="submit" loading={submitting} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
