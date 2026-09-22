import { useRef, useState } from 'react';
import { ArrowCounterClockwise, PencilSimple, Plus, Prohibit, Truck } from '@phosphor-icons/react';
import type { SupplierSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useHasAnyPermission } from '../auth/usePermission';
import { DRUG_MANAGE_PERMISSIONS } from '../auth/admin-permissions';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useCreateSupplierMutation, useSuppliersQuery, useUpdateSupplierMutation } from './supplier.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface ModalState {
  mode: 'create' | 'edit';
  item?: SupplierSummary;
}

/** Nhà cung cấp (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — nay được dùng ở trang riêng
 * `SupplierManagementPage.tsx` (nhóm sidebar "Quản lý nhà cung cấp", tách khỏi "Danh mục Thuốc và
 * Vật Tư"). Mã tự sinh (tiền tố NCC) — không có ô nhập mã, đúng khuôn `WorkShiftPane`. */
export function SupplierPane() {
  const canManage = useHasAnyPermission(DRUG_MANAGE_PERMISSIONS);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<SupplierSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useSuppliersQuery(includeInactive);
  const createMutation = useCreateSupplierMutation();
  const updateMutation = useUpdateSupplierMutation();

  const items = query.data?.items ?? [];
  const itemIds = items.map((s) => s.id);
  const rowSelection = useRowSelection(itemIds);

  function errorMessage(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.';
  }

  /** Nút "Ngưng sử dụng" nhanh ở danh sách — bắt xác nhận vì NCC sẽ hết chọn được khi lập Phiếu nhập kho mới. */
  function handleDeactivate(item: SupplierSummary) {
    setActionError(null);
    updateMutation.mutate(
      { id: item.id, body: { isActive: false, version: item.version } },
      { onSuccess: () => setDeactivateTarget(null), onError: (err) => setActionError(errorMessage(err)) },
    );
  }

  /** "Kích hoạt lại" — trực tiếp không cần xác nhận (cùng cách `ReferenceCatalogPane`/`UserAccountPane` xử lý). */
  function handleReactivate(item: SupplierSummary) {
    setActionError(null);
    updateMutation.mutate({ id: item.id, body: { isActive: true, version: item.version } }, { onError: (err) => setActionError(errorMessage(err)) });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Hiện cả nhà cung cấp đã ngưng
        </label>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm nhà cung cấp
          </Button>
        )}
      </div>

      {actionError && <ErrorBanner message={actionError} />}
      {query.isError && <ErrorBanner message="Không tải được danh sách nhà cung cấp." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={Truck} title="Chưa có nhà cung cấp nào" description="Thêm nhà cung cấp để dùng khi lập Phiếu nhập kho." />
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
                  <th className="w-28 px-4 py-2.5 text-center">Mã</th>
                  <th className="px-4 py-2.5 text-left">Tên nhà cung cấp</th>
                  <th className="w-32 px-4 py-2.5 text-center">Mã số thuế</th>
                  <th className="w-36 px-4 py-2.5 text-center">Điện thoại</th>
                  <th className="w-40 px-4 py-2.5 text-left">Người liên hệ</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-20 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((supplier) => (
                  <tr key={supplier.id} className={`border-b border-slate-200 last:border-0 ${supplier.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(supplier.id)} onChange={() => rowSelection.toggle(supplier.id)} ariaLabel={`Chọn ${supplier.name}`} />
                    </td>
                    <td className="px-4 py-2 text-center font-bold text-slate-800">{supplier.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{supplier.name}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{supplier.taxCode ?? '—'}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{supplier.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-left text-slate-600">{supplier.contactName ?? '—'}</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={supplier.isActive ? 'success' : 'neutral'}>{supplier.isActive ? 'Đang dùng' : 'Ngưng'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <div className="flex flex-nowrap items-center justify-center gap-1.5">
                          <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => setModal({ mode: 'edit', item: supplier })} />
                          {supplier.isActive ? (
                            <RowActionButton icon={Prohibit} label="Ngưng sử dụng" tone="danger" onClick={() => setDeactivateTarget(supplier)} />
                          ) : (
                            <RowActionButton icon={ArrowCounterClockwise} label="Kích hoạt lại" tone="primary" onClick={() => handleReactivate(supplier)} />
                          )}
                        </div>
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
        <SupplierFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (dto) => {
            if (modal.mode === 'create') {
              await createMutation.mutateAsync(dto);
            } else if (modal.item) {
              await updateMutation.mutateAsync({ id: modal.item.id, body: { ...dto, isActive: modal.item.isActive, version: modal.item.version } });
            }
          }}
        />
      )}

      {deactivateTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Ngưng sử dụng nhà cung cấp &quot;{deactivateTarget.name}&quot;?</p>
            <p className="mt-1.5 text-xs text-slate-500">Sẽ không chọn được nhà cung cấp này khi lập Phiếu nhập kho mới. Có thể kích hoạt lại sau.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" loading={updateMutation.isPending} onClick={() => handleDeactivate(deactivateTarget)}>
                Ngưng sử dụng
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierFormModal({
  mode,
  item,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: SupplierSummary;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; taxCode?: string; phone?: string; address?: string; contactName?: string }) => Promise<void>;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [taxCode, setTaxCode] = useState(item?.taxCode ?? '');
  const [phone, setPhone] = useState(item?.phone ?? '');
  const [address, setAddress] = useState(item?.address ?? '');
  const [contactName, setContactName] = useState(item?.contactName ?? '');
  const { flashVisible, triggerFlash } = useSaveFlash();
  const isInvalid = name.trim() === '';

  function buildDto() {
    return {
      name: name.trim(),
      taxCode: taxCode.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      contactName: contactName.trim() || undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    await onSubmit(buildDto());
    onCancel();
  }

  async function handleSaveAndContinue() {
    if (isInvalid) return;
    await onSubmit(buildDto());
    setName('');
    setTaxCode('');
    setPhone('');
    setAddress('');
    setContactName('');
    nameInputRef.current?.focus();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={Truck} title={mode === 'create' ? 'Thêm nhà cung cấp' : 'Sửa nhà cung cấp'} onClose={onCancel} />

        <SaveFlashBanner visible={flashVisible} />

        <div className="mb-4 mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="supplier-name" className="text-sm font-semibold text-slate-800">
              Tên nhà cung cấp
            </label>
            <input id="supplier-name" ref={nameInputRef} value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="supplier-tax" className="text-sm font-semibold text-slate-800">
              Mã số thuế
            </label>
            <input id="supplier-tax" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="supplier-phone" className="text-sm font-semibold text-slate-800">
              Điện thoại
            </label>
            <input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="supplier-contact" className="text-sm font-semibold text-slate-800">
              Người liên hệ
            </label>
            <input id="supplier-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="supplier-address" className="text-sm font-semibold text-slate-800">
              Địa chỉ
            </label>
            <input id="supplier-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClassName} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={isInvalid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
