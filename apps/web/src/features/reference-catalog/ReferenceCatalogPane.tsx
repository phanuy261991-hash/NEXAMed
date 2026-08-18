import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { ReferenceCatalogCategory, ReferenceCatalogItem } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { formatVnd } from '../../shared/format/currency';
import {
  useCreateReferenceCatalogItemMutation,
  useDeactivateReferenceCatalogItemMutation,
  useReactivateReferenceCatalogItemMutation,
  useReferenceCatalogQuery,
  useUpdateReferenceCatalogItemMutation,
} from './reference-catalog.queries';

/** Khớp `reference_catalog.manage` (chỉ clinic_admin) — .claude/docs/security-audit.md. */
const MANAGE_ROLES = ['clinic_admin'];

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface ModalState {
  mode: 'create' | 'edit';
  item?: ReferenceCatalogItem;
}

/**
 * Bảng CRUD cho một category của `reference_catalog` — tách từ `ReferenceCatalogAdminPage.tsx`
 * cũ (bỏ tab bar/`useBreadcrumb`) để dùng làm nội dung cột phải trong trang "Danh mục"
 * (`.claude/docs/ui-guidelines.md` mục 10, `docs/DECISIONS.md` #039). Nhận `category` qua prop
 * thay vì tự quản lý state chuyển tab — mỗi category giờ là 1 mục riêng trong danh sách cấp 2.
 */
export function ReferenceCatalogPane({
  category,
  categoryLabel,
}: {
  category: ReferenceCatalogCategory;
  categoryLabel: string;
}) {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ReferenceCatalogItem | null>(null);

  const query = useReferenceCatalogQuery(category, includeInactive);
  const createMutation = useCreateReferenceCatalogItemMutation(category);
  const updateMutation = useUpdateReferenceCatalogItemMutation(category);
  const deactivateMutation = useDeactivateReferenceCatalogItemMutation(category);
  const reactivateMutation = useReactivateReferenceCatalogItemMutation(category);

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo mã hoặc tên..."
              className={`${inputClassName} pl-8`}
            />
          </div>
          {canManage && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Hiện cả mục đã ẩn
            </label>
          )}
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm mới
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh mục." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={MagnifyingGlass} title="Không tìm thấy mục nào" description="Thử từ khoá khác hoặc bỏ bộ lọc tìm kiếm." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="w-24 px-4 py-2.5 text-center">Mã</th>
                <th className="px-4 py-2.5 text-left">Tên hiển thị</th>
                {category === 'EXAM_TYPE' && <th className="w-32 px-4 py-2.5 text-center">Giá</th>}
                {category === 'EXAM_TYPE' && <th className="w-24 px-4 py-2.5 text-center">Đơn vị</th>}
                <th className="w-24 px-4 py-2.5 text-center">Thứ tự</th>
                {canManage && <th className="w-32 px-4 py-2.5 text-center">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={`border-b border-slate-200 last:border-0 ${item.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{item.code}</td>
                  <td className="px-4 py-2 text-left font-medium text-slate-900">
                    {item.name}
                    {!item.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Đã ẩn</span>}
                  </td>
                  {category === 'EXAM_TYPE' && (
                    <td className="px-4 py-2 text-center font-medium text-slate-600">{item.price !== null ? formatVnd(item.price) : '—'}</td>
                  )}
                  {category === 'EXAM_TYPE' && <td className="px-4 py-2 text-center font-medium text-slate-600">{item.unit ?? '—'}</td>}
                  <td className="px-4 py-2 text-center text-slate-500">{item.sortOrder}</td>
                  {canManage && (
                    <td className="px-4 py-2 text-center">
                      {item.isActive ? (
                        <>
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() => setModal({ mode: 'edit', item })}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <PencilSimple size={15} weight="regular" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title="Xoá"
                            onClick={() => setDeactivateTarget(item)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash size={15} weight="regular" aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          title="Khôi phục"
                          onClick={() => reactivateMutation.mutate(item.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                        >
                          <ArrowCounterClockwise size={15} weight="regular" aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ItemFormModal
          category={category}
          categoryLabel={categoryLabel}
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setModal(null);
            if (modal.mode === 'create') {
              createMutation.mutate({ category, ...dto }, { onSuccess: onSettled });
            } else if (modal.item) {
              updateMutation.mutate({ id: modal.item.id, body: dto }, { onSuccess: onSettled });
            }
          }}
        />
      )}

      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Xoá &quot;{deactivateTarget.name}&quot; khỏi danh mục?</p>
            <p className="mt-1.5 text-xs text-slate-500">
              Hồ sơ bệnh nhân đã lưu giá trị này trước đó sẽ không bị thay đổi. Có thể khôi phục lại sau qua &quot;Hiện cả
              mục đã ẩn&quot;.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deactivateMutation.isPending}
                onClick={() => deactivateMutation.mutate(deactivateTarget.id, { onSuccess: () => setDeactivateTarget(null) })}
              >
                Xoá
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemFormModal({
  category,
  categoryLabel,
  mode,
  item,
  submitting,
  onCancel,
  onSubmit,
}: {
  category: ReferenceCatalogCategory;
  categoryLabel: string;
  mode: 'create' | 'edit';
  item?: ReferenceCatalogItem;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { code: string; name: string; sortOrder: number; price?: number; unit?: string }) => void;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);
  const [price, setPrice] = useState(item?.price !== null && item?.price !== undefined ? String(item.price) : '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const isExamType = category === 'EXAM_TYPE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm mục mới' : 'Sửa mục'}</h2>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">Danh mục: {categoryLabel}</p>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="rc-code" className="text-xs font-semibold text-slate-600">
            Mã
          </label>
          <input id="rc-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClassName} />
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="rc-name" className="text-xs font-semibold text-slate-600">
            Tên hiển thị
          </label>
          <input id="rc-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </div>

        {isExamType && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="rc-price" className="text-xs font-semibold text-slate-600">
              Giá (đồng)
            </label>
            <input
              id="rc-price"
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClassName}
            />
          </div>
        )}

        {isExamType && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="rc-unit" className="text-xs font-semibold text-slate-600">
              Đơn vị
            </label>
            <input id="rc-unit" placeholder="Ví dụ: Lượt, Buổi" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClassName} />
          </div>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="rc-sort-order" className="text-xs font-semibold text-slate-600">
            Thứ tự hiển thị
          </label>
          <input
            id="rc-sort-order"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className={inputClassName}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={code.trim() === '' || name.trim() === '' || (isExamType && price.trim() === '')}
            onClick={() =>
              onSubmit({
                code: code.trim(),
                name: name.trim(),
                sortOrder,
                price: isExamType && price.trim() !== '' ? Number(price) : undefined,
                unit: isExamType && unit.trim() !== '' ? unit.trim() : undefined,
              })
            }
          >
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}
