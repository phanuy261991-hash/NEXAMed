import { useMemo, useState } from 'react';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from './cash-account.queries';
import { useCreateCashVoucherMutation } from './cash-voucher.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface FormValues {
  cashAccountId: string;
  counterAccountId: string;
  paymentMethodCode: string;
  amount: number | undefined;
  occurredAt: string;
  description: string;
  note: string;
}

/**
 * "Chuyển quỹ" lập tay (Sổ quỹ & Thu chi GĐ2) — di chuyển tiền giữa 2 quỹ NỘI BỘ (không phải Thu/
 * Chi thật), ví dụ nộp tiền mặt vào ngân hàng. CHỈ mở được cho ai có `cash_account.manage` (kiểm ở
 * `CashVoucherListPage.tsx`/`CashBookPage.tsx` trước khi render component này — backend chặn cứng
 * lại lần nữa, đây chỉ là UI). Dùng CHUNG endpoint `POST /cash-vouchers` với `counterAccountId` —
 * KHÔNG có khái niệm Thu/Chi hay Loại thu chi cho chuyển quỹ, chỉ "từ quỹ nào → quỹ nào".
 */
export function TransferVoucherFormDialog({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { flashVisible, triggerFlash } = useSaveFlash();
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();
  const createMutation = useCreateCashVoucherMutation();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);

  const [values, setValues] = useState<FormValues>({
    cashAccountId: '',
    counterAccountId: '',
    paymentMethodCode: '',
    amount: undefined,
    occurredAt: todayDateString(),
    description: '',
    note: '',
  });

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const sourceOptions: ComboboxOption[] = useMemo(
    () => cashAccounts.map((a) => ({ value: a.id, label: a.type === 'BANK' ? `${a.name} (${a.bankAccountNo ?? '—'})` : a.name })),
    [cashAccounts],
  );
  // Quỹ đích lọc khác quỹ nguồn — chọn nguồn xong đổi lại đích trùng nguồn thì tự xoá lựa chọn đích.
  const destinationOptions: ComboboxOption[] = useMemo(() => sourceOptions.filter((o) => o.value !== values.cashAccountId), [sourceOptions, values.cashAccountId]);
  const paymentMethodOptions: ComboboxOption[] = useMemo(() => paymentMethods.map((m) => ({ value: m.code, label: m.name })), [paymentMethods]);

  function handleSourceChange(id: string) {
    setValues((v) => ({ ...v, cashAccountId: id, counterAccountId: v.counterAccountId === id ? '' : v.counterAccountId }));
  }

  const isValid =
    values.cashAccountId !== '' &&
    values.counterAccountId !== '' &&
    values.cashAccountId !== values.counterAccountId &&
    values.paymentMethodCode !== '' &&
    (values.amount ?? 0) > 0 &&
    values.description.trim() !== '';

  function buildDto() {
    return {
      cashAccountId: values.cashAccountId,
      counterAccountId: values.counterAccountId,
      paymentMethodCode: values.paymentMethodCode,
      amount: values.amount ?? 0,
      occurredAt: values.occurredAt,
      description: values.description.trim(),
      note: values.note.trim() || undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    await createMutation.mutateAsync(buildDto());
    onDone();
  }

  async function handleSaveAndContinue() {
    if (!isValid) return;
    await createMutation.mutateAsync(buildDto());
    setValues((v) => ({ ...v, amount: undefined, description: '', note: '' }));
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={ArrowsLeftRight} title="Chuyển quỹ" subtitle="Sổ quỹ & Thu chi" onClose={onCancel} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <SaveFlashBanner visible={flashVisible} />

          <div className="space-y-5 pb-6">
            <BoxedSection badge="Chuyển từ quỹ nào sang quỹ nào">
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-source" className="text-sm font-semibold text-slate-800">
                    Quỹ nguồn <span className="text-rose-500">*</span>
                  </label>
                  <Combobox id="tv-source" value={values.cashAccountId} options={sourceOptions} onChange={handleSourceChange} placeholder="Chọn quỹ bị trừ tiền..." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-dest" className="text-sm font-semibold text-slate-800">
                    Quỹ đích <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="tv-dest"
                    value={values.counterAccountId}
                    options={destinationOptions}
                    onChange={(v) => set('counterAccountId', v)}
                    placeholder="Chọn quỹ được cộng tiền..."
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-amount" className="text-sm font-semibold text-slate-800">
                    Số tiền <span className="text-rose-500">*</span>
                  </label>
                  <MoneyInput id="tv-amount" value={values.amount} onChange={(v) => set('amount', v)} className={inputClassName} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-method" className="text-sm font-semibold text-slate-800">
                    Hình thức <span className="text-rose-500">*</span>
                  </label>
                  <Combobox id="tv-method" value={values.paymentMethodCode} options={paymentMethodOptions} onChange={(v) => set('paymentMethodCode', v)} />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="tv-occurred-at" className="text-sm font-semibold text-slate-800">
                    Ngày phát sinh
                  </label>
                  <input id="tv-occurred-at" type="date" value={values.occurredAt} onChange={(e) => set('occurredAt', e.target.value)} className={`${inputClassName} sm:max-w-[220px]`} />
                </div>
              </div>
            </BoxedSection>

            <BoxedSection badge="Chi tiết">
              <div className="grid grid-cols-1 gap-y-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-description" className="text-sm font-semibold text-slate-800">
                    Diễn giải <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="tv-description"
                    value={values.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder="Ví dụ: Nộp tiền mặt vào ngân hàng"
                    className={inputClassName}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tv-note" className="text-sm font-semibold text-slate-800">
                    Ghi chú
                  </label>
                  <textarea id="tv-note" rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} className={inputClassName} />
                </div>
              </div>
            </BoxedSection>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={createMutation.isPending}>
            Huỷ
          </Button>
          <Button type="button" variant="secondary" loading={createMutation.isPending} disabled={!isValid} onClick={handleSaveAndContinue}>
            Lưu và nhập tiếp
          </Button>
          <Button type="submit" loading={createMutation.isPending} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
