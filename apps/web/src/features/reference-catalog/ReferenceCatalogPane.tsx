import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { ReferenceCatalogCategory, ReferenceCatalogItem } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { ApiError } from '../../shared/api/client';
import {
  useCreateReferenceCatalogItemMutation,
  useDeactivateReferenceCatalogItemMutation,
  useReactivateReferenceCatalogItemMutation,
  useReferenceCatalogQuery,
  useUpdateReferenceCatalogItemMutation,
} from './reference-catalog.queries';
import { ExamTypeFormModal } from './ExamTypeFormModal';

/** Khớp `reference_catalog.manage` (chỉ clinic_admin) — .claude/docs/security-audit.md. */
const MANAGE_ROLES = ['clinic_admin'];

/**
 * 4 danh mục nhân sự (mở rộng ADM-01, 2026-08-20) + "Đơn vị tính" (UNIT, 2026-08-26) + "Hình thức
 * thanh toán" (PAYMENT_METHOD, 2026-08-27) — không có nguồn dữ liệu chính thức để nhập mã tay nên
 * server tự sinh `code`, ẩn ô nhập "Mã" trong modal Thêm/Sửa. Cột "Mã" trong bảng danh sách vẫn
 * hiện (yêu cầu chủ dự án 2026-08-21) — chỉ đọc, không sửa được.
 */
const AUTO_CODE_CATEGORIES: ReferenceCatalogCategory[] = [
  'ACADEMIC_TITLE',
  'STAFF_POSITION',
  'EMPLOYMENT_STATUS',
  'EMPLOYMENT_TYPE',
  'UNIT',
  'PAYMENT_METHOD',
];

/**
 * Category có Mô tả + Trạng thái (Đang sử dụng/Ngưng sử dụng) ngay trong form Thêm/Sửa, không chỉ
 * qua action Xoá/Khôi phục — ban đầu chỉ UNIT (2026-08-26, #078), mở rộng sang "Chức danh"/"Học
 * hàm học vị" rồi "Hình thức thanh toán" (2026-08-27, yêu cầu chủ dự án). `description`/`isActive`
 * đã là cột dùng chung toàn bảng `reference_catalog` (không migration riêng) — chỉ cần bật hiển
 * thị/gửi field ở đây.
 */
const DESCRIPTION_STATUS_CATEGORIES: ReferenceCatalogCategory[] = ['UNIT', 'ACADEMIC_TITLE', 'STAFF_POSITION', 'PAYMENT_METHOD'];

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
  const hideCode = AUTO_CODE_CATEGORIES.includes(category);

  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ReferenceCatalogItem | null>(null);

  const query = useReferenceCatalogQuery(category, includeInactive);
  const createMutation = useCreateReferenceCatalogItemMutation(category);
  const updateMutation = useUpdateReferenceCatalogItemMutation(category);
  const deactivateMutation = useDeactivateReferenceCatalogItemMutation(category);
  const reactivateMutation = useReactivateReferenceCatalogItemMutation(category);

  // Chỉ `ExamTypeFormModal` hiện lỗi này (ví dụ EXAM_TYPE_PRICE_OVERLAP nếu race điều kiện lọt qua
  // validate tầng client) — modal chung `ItemFormModal` chưa có chỗ hiện lỗi submit từ trước, giữ
  // nguyên hành vi cũ, không mở rộng ở đây.
  const mutationError = createMutation.error ?? updateMutation.error;
  const mutationErrorMessage = mutationError instanceof ApiError ? mutationError.message : undefined;

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }, [query.data, search]);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const rowSelection = useRowSelection(itemIds);

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

      {/* Danh sách có thể dài (đơn vị/loại khám/hồ sơ nhân sự...) — bọc riêng vùng cuộn dọc
          (min-h-0 + overflow-y-auto) thay vì để bảng tự giãn theo nội dung rồi kéo cả trang cuộn
          theo (tiêu đề cột sẽ trôi mất). Tiêu đề cột dính (sticky) để vẫn thấy khi cuộn sâu — cùng
          mẫu đã dùng ở `AllergenPane.tsx` (.claude/docs/ui-guidelines.md mục 9g). */}
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
                  <th className="px-4 py-2.5 text-left">Tên hiển thị</th>
                  {category === 'EXAM_TYPE' && <th className="w-32 px-4 py-2.5 text-center">Đơn giá</th>}
                  {DESCRIPTION_STATUS_CATEGORIES.includes(category) && <th className="px-4 py-2.5 text-left">Mô tả</th>}
                  {DESCRIPTION_STATUS_CATEGORIES.includes(category) && <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>}
                  <th className="w-24 px-4 py-2.5 text-center">Thứ tự</th>
                  {canManage && <th className="w-32 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-b border-slate-200 last:border-0 ${item.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(item.id)} onChange={() => rowSelection.toggle(item.id)} ariaLabel={`Chọn ${item.name}`} />
                    </td>
                    <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{item.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">
                      {item.name}
                      {/* Category có cột "Trạng thái" riêng (Đang sử dụng/Ngưng sử dụng) — badge "Đã ẩn" ở đây sẽ trùng lặp thông tin. */}
                      {!item.isActive && !DESCRIPTION_STATUS_CATEGORIES.includes(category) && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Đã ẩn</span>
                      )}
                    </td>
                    {category === 'EXAM_TYPE' && (
                      <td className="px-4 py-2 text-center font-medium text-slate-600">
                        {item.prices && item.prices.length > 0 ? (
                          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[12px] font-semibold text-blue-700">{item.prices.length} mức giá</span>
                        ) : (
                          <span className="text-slate-400">Chưa có giá</span>
                        )}
                      </td>
                    )}
                    {DESCRIPTION_STATUS_CATEGORIES.includes(category) && (
                      <td className="max-w-xs truncate px-4 py-2 text-left font-medium text-slate-600" title={item.description ?? undefined}>
                        {item.description ?? '—'}
                      </td>
                    )}
                    {DESCRIPTION_STATUS_CATEGORIES.includes(category) && (
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {item.isActive ? 'Đang sử dụng' : 'Ngưng sử dụng'}
                        </span>
                      </td>
                    )}
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
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {modal && category === 'EXAM_TYPE' && (
        <ExamTypeFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          submitError={mutationErrorMessage}
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

      {modal && category !== 'EXAM_TYPE' && (
        <ItemFormModal
          category={category}
          categoryLabel={categoryLabel}
          hideCode={hideCode}
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
  hideCode,
  mode,
  item,
  submitting,
  onCancel,
  onSubmit,
}: {
  category: ReferenceCatalogCategory;
  categoryLabel: string;
  /** Ẩn hẳn ô "Mã" — server tự sinh (mở rộng ADM-01, 2026-08-20), xem `AUTO_CODE_CATEGORIES`. */
  hideCode: boolean;
  mode: 'create' | 'edit';
  item?: ReferenceCatalogItem;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: {
    code?: string;
    name: string;
    sortOrder: number;
    deactivatesAccount?: boolean;
    description?: string;
    isActive?: boolean;
  }) => void;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);
  const [deactivatesAccount, setDeactivatesAccount] = useState(item?.deactivatesAccount ?? false);
  const [description, setDescription] = useState(item?.description ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  // Mở rộng ADM-01 — chỉ EMPLOYMENT_STATUS có ý nghĩa với deactivatesAccount.
  const isEmploymentStatus = category === 'EMPLOYMENT_STATUS';
  // "Đơn vị tính" (2026-08-26) — chỉ category này đổi nhãn trường Tên.
  const isUnit = category === 'UNIT';
  // Mô tả + Trạng thái ngay trong form — UNIT (#078) + "Chức danh"/"Học hàm học vị" (2026-08-27).
  const hasDescriptionAndStatus = DESCRIPTION_STATUS_CATEGORIES.includes(category);
  const isInvalid = (!hideCode && code.trim() === '') || name.trim() === '';

  // Bọc `<form>` để Enter trong ô nhập tự submit (chuẩn HTML, không cần tự bắt phím) — mọi form
  // Thêm/Sửa trong app PHẢI theo mẫu này (`.claude/docs/ui-guidelines.md` mục 4.4, bắt buộc từ
  // 2026-08-21, phản hồi thật: trước đây chỉ bấm chuột được, không bấm Enter được).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({
      code: hideCode ? undefined : code.trim(),
      name: name.trim(),
      sortOrder,
      deactivatesAccount: isEmploymentStatus ? deactivatesAccount : undefined,
      description: hasDescriptionAndStatus && description.trim() !== '' ? description.trim() : undefined,
      isActive: hasDescriptionAndStatus ? isActive : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm mục mới' : 'Sửa mục'}</h2>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">Danh mục: {categoryLabel}</p>

        {!hideCode && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="rc-code" className="text-sm font-semibold text-slate-800">
              Mã <span className="text-rose-500">*</span>
            </label>
            <input id="rc-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClassName} />
          </div>
        )}

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="rc-name" className="text-sm font-semibold text-slate-800">
            {isUnit ? 'Tên đơn vị' : 'Tên hiển thị'} <span className="text-rose-500">*</span>
          </label>
          <input id="rc-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </div>

        {hasDescriptionAndStatus && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="rc-description" className="text-sm font-semibold text-slate-800">
              Mô tả
            </label>
            <textarea
              id="rc-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClassName}
            />
          </div>
        )}


        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="rc-sort-order" className="text-sm font-semibold text-slate-800">
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

        {hasDescriptionAndStatus && (
          <div className="mb-4 flex flex-col gap-1.5">
            <label htmlFor="rc-is-active" className="text-sm font-semibold text-slate-800">
              Trạng thái
            </label>
            <select
              id="rc-is-active"
              value={isActive ? '1' : '0'}
              onChange={(e) => setIsActive(e.target.value === '1')}
              className={inputClassName}
            >
              <option value="1">Đang sử dụng</option>
              <option value="0">Ngưng sử dụng</option>
            </select>
          </div>
        )}

        {isEmploymentStatus && (
          <label className="mb-4 flex items-start gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={deactivatesAccount}
              onChange={(e) => setDeactivatesAccount(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Tự động vô hiệu hoá tài khoản khi chọn trạng thái này
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Ví dụ &quot;Nghỉ việc&quot; — tài khoản gán trạng thái này sẽ tự chuyển sang &quot;Vô hiệu hoá&quot;, không đăng nhập được nữa.
              </span>
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
