import { useMemo, useRef, useState } from 'react';
import { Bank, PencilSimple, Plus, Vault } from '@phosphor-icons/react';
import type { CashAccount, CashAccountType } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { EmptyState } from '../../shared/ui/EmptyState';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { formatVnd } from '../../shared/format/currency';
import { useCashAccountsQuery, useCreateCashAccountMutation, useUpdateCashAccountMutation } from './cash-account.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const TYPE_LABEL: Record<CashAccountType, string> = { CASH: 'Tiền mặt', BANK: 'Ngân hàng', DRAWER: 'Két thu ngân' };

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface FormValues {
  name: string;
  type: 'CASH' | 'BANK';
  bankName: string;
  bankAccountNo: string;
  openingBalance: number | undefined;
  openingBalanceAt: string;
  isDefault: boolean;
  isActive: boolean;
}

function toFormValues(item?: CashAccount): FormValues {
  return {
    name: item?.name ?? '',
    type: item?.type === 'BANK' ? 'BANK' : 'CASH',
    bankName: item?.bankName ?? '',
    bankAccountNo: item?.bankAccountNo ?? '',
    openingBalance: item?.openingBalance ?? 0,
    openingBalanceAt: item?.openingBalanceAt ? item.openingBalanceAt.slice(0, 10) : todayDateString(),
    isDefault: item?.isDefault ?? false,
    isActive: item?.isActive ?? true,
  };
}

function CashAccountFormModal({
  mode,
  item,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: CashAccount;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: FormValues) => Promise<void>;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<FormValues>(() => toFormValues(item));
  const { flashVisible, triggerFlash } = useSaveFlash();

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const isValid = values.name.trim() !== '' && (values.type === 'CASH' || values.bankAccountNo.trim() !== '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    await onSubmit(values);
    onCancel();
  }

  async function handleSaveAndContinue() {
    if (!isValid) return;
    await onSubmit(values);
    setValues(toFormValues(undefined));
    nameInputRef.current?.focus();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader
          icon={Vault}
          title={mode === 'create' ? 'Thêm Quỹ' : 'Sửa Quỹ'}
          subtitle="Cấu hình thanh toán: Quỹ"
          onClose={onCancel}
          right={
            mode === 'edit' && item ? (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600" title="Mã tự sinh, không sửa được">
                Mã: {item.code}
              </span>
            ) : undefined
          }
        />

        <SaveFlashBanner visible={flashVisible} />

        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="ca-name" className="text-sm font-semibold text-slate-800">
              Tên quỹ <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="ca-name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ví dụ: Quỹ tiền mặt, Tài khoản Vietcombank"
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-semibold text-slate-800">
              Loại quỹ <span className="text-rose-500">*</span>
            </label>
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => set('type', 'CASH')}
                className={`flex-1 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                  values.type === 'CASH' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                Tiền mặt
              </button>
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => set('type', 'BANK')}
                className={`flex-1 border-l border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                  values.type === 'BANK' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                Ngân hàng
              </button>
            </div>
            {mode === 'edit' && <p className="text-[11px] text-slate-400">Không đổi được loại quỹ sau khi tạo.</p>}
          </div>

          {values.type === 'BANK' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ca-bank-name" className="text-sm font-semibold text-slate-800">
                  Tên ngân hàng
                </label>
                <input id="ca-bank-name" value={values.bankName} onChange={(e) => set('bankName', e.target.value)} className={inputClassName} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ca-bank-no" className="text-sm font-semibold text-slate-800">
                  Số tài khoản <span className="text-rose-500">*</span>
                </label>
                <input id="ca-bank-no" value={values.bankAccountNo} onChange={(e) => set('bankAccountNo', e.target.value)} className={inputClassName} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ca-opening-balance" className="text-sm font-semibold text-slate-800">
              Số dư đầu kỳ
            </label>
            <MoneyInput id="ca-opening-balance" value={values.openingBalance} onChange={(v) => set('openingBalance', v)} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ca-opening-at" className="text-sm font-semibold text-slate-800">
              Mốc tính số dư
            </label>
            <input
              id="ca-opening-at"
              type="date"
              value={values.openingBalanceAt}
              onChange={(e) => set('openingBalanceAt', e.target.value)}
              className={inputClassName}
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:col-span-2">
            <input type="checkbox" checked={values.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
            Đặt làm quỹ mặc định cho loại &quot;{TYPE_LABEL[values.type]}&quot;
          </label>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:col-span-2">
              <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Đang hoạt động
            </label>
          )}
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

/**
 * "Quỹ" (tiền mặt/ngân hàng, Sổ quỹ & Thu chi GĐ1) — mục con trong pill "Cấu hình thanh toán"
 * (`/admin/system-config`). Đúng khuôn `DrugCatalogPane.tsx` (danh sách phẳng + modal Thêm/Sửa,
 * "Lưu và nhập tiếp" mục 4.7). Không có xoá — quỹ đã phát sinh giao dịch không xoá được, chỉ ẩn
 * qua `isActive` (đúng nguyên tắc CLAUDE.md "không xoá cứng dữ liệu nghiệp vụ").
 */
export function CashAccountPane() {
  const canManage = useHasPermission('cash_account', 'manage');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; item?: CashAccount } | null>(null);

  const query = useCashAccountsQuery();
  const createMutation = useCreateCashAccountMutation();
  const updateMutation = useUpdateCashAccountMutation();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const rowSelection = useRowSelection(itemIds);

  async function handleSubmit(dto: FormValues) {
    if (modal?.mode === 'edit' && modal.item) {
      await updateMutation.mutateAsync({
        id: modal.item.id,
        body: {
          name: dto.name,
          bankName: dto.type === 'BANK' ? dto.bankName || null : null,
          bankAccountNo: dto.type === 'BANK' ? dto.bankAccountNo || null : null,
          isDefault: dto.isDefault,
          isActive: dto.isActive,
          version: modal.item.version,
        },
      });
    } else {
      await createMutation.mutateAsync({
        name: dto.name,
        type: dto.type,
        bankName: dto.type === 'BANK' ? dto.bankName || null : null,
        bankAccountNo: dto.type === 'BANK' ? dto.bankAccountNo || null : null,
        openingBalance: dto.openingBalance ?? 0,
        openingBalanceAt: dto.openingBalanceAt,
        isDefault: dto.isDefault,
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-500">
          Quỹ tiền mặt/ngân hàng dùng cho phiếu thu/chi ngoài dịch vụ khám. Quỹ tiền mặt mặc định đã có sẵn — thêm quỹ
          ngân hàng khi phòng khám nhận chuyển khoản.
        </p>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm quỹ
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh sách Quỹ." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={Vault} title="Chưa có quỹ nào" description="Thêm quỹ tiền mặt hoặc ngân hàng để bắt đầu lập phiếu thu/chi." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-10 px-4 py-2.5 text-center">
                    <SelectionCheckbox
                      checked={rowSelection.allLoadedSelected}
                      indeterminate={rowSelection.someLoadedSelected}
                      onChange={rowSelection.toggleAll}
                      ariaLabel="Chọn tất cả"
                    />
                  </th>
                  <th className="w-24 px-4 py-2.5 text-center">Mã</th>
                  <th className="px-4 py-2.5 text-left">Tên quỹ</th>
                  <th className="w-32 px-4 py-2.5 text-center">Loại</th>
                  <th className="px-4 py-2.5 text-left">Số tài khoản</th>
                  <th className="w-28 px-4 py-2.5 text-center">Số dư đầu kỳ</th>
                  <th className="w-24 px-4 py-2.5 text-center">Mặc định</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-20 px-4 py-2.5 text-center">Sửa</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-b border-slate-200 last:border-0 ${item.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox
                        checked={rowSelection.isSelected(item.id)}
                        onChange={() => rowSelection.toggle(item.id)}
                        ariaLabel={`Chọn ${item.name}`}
                      />
                    </td>
                    <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{item.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{item.name}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        {item.type === 'BANK' && <Bank size={13} weight="bold" aria-hidden="true" />}
                        {TYPE_LABEL[item.type]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-left text-slate-600">
                      {item.type === 'BANK' ? `${item.bankName ?? ''} · ${item.bankAccountNo ?? '—'}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-center font-medium tabular-nums text-slate-700">{formatVnd(item.openingBalance)}</td>
                    <td className="px-4 py-2 text-center">{item.isDefault ? <StatusBadge tone="accent">Mặc định</StatusBadge> : '—'}</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Đang hoạt động' : 'Ngưng dùng'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setModal({ mode: 'edit', item })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PencilSimple size={15} weight="regular" aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {modal && (
        <CashAccountFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
