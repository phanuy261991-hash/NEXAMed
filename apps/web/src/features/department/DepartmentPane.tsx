import { useMemo, useState } from 'react';
import { Buildings, MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import type { DepartmentSummary, DepartmentTypeSummary } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { useCreateDepartmentMutation, useDepartmentsQuery, useUpdateDepartmentMutation } from './department.queries';
import { useCreateDepartmentTypeMutation, useDepartmentTypesQuery, useUpdateDepartmentTypeMutation } from './department-type.queries';

/** Khớp `user_account.manage` (chỉ clinic_admin) — .claude/docs/security-audit.md. */
const MANAGE_ROLES = ['clinic_admin'];

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const NO_TYPE_VALUE = '';

/**
 * "Khoa/Phòng" (mở rộng ADM-01, yêu cầu chủ dự án 2026-08-20) — bố cục master-detail (cột trái
 * "Loại Khoa/Phòng" lọc cột phải "Khoa/Phòng"), tham khảo `RoomPane.tsx` (Tầng lọc Phòng). "Loại
 * Khoa/Phòng" TÙY CHỌN — cột trái LUÔN hiện kể cả 0 loại (đúng nguyên tắc RoomPane, không giấu
 * lối vào tạo loại đầu tiên).
 */
export function DepartmentPane() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [typeSearch, setTypeSearch] = useState('');
  const [typeModal, setTypeModal] = useState<{ mode: 'create' | 'edit'; type?: DepartmentTypeSummary } | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; department?: DepartmentSummary } | null>(null);

  const typesQuery = useDepartmentTypesQuery();
  const query = useDepartmentsQuery();
  const createTypeMutation = useCreateDepartmentTypeMutation();
  const updateTypeMutation = useUpdateDepartmentTypeMutation();
  const createMutation = useCreateDepartmentMutation();
  const updateMutation = useUpdateDepartmentMutation();

  const types = typesQuery.data?.items ?? [];
  const hasTypes = types.length > 0;

  const visibleTypes = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    if (q === '') return types;
    return types.filter((t) => t.name.toLowerCase().includes(q));
  }, [types, typeSearch]);

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    if (!hasTypes || selectedTypeId === null) return all;
    return all.filter((d) => d.departmentTypeId === selectedTypeId);
  }, [query.data, hasTypes, selectedTypeId]);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-slate-500">
        Phục vụ trường &quot;Khoa/Phòng&quot; khi tạo/sửa tài khoản. Phần lớn phòng khám 1-3 bác sĩ không cần dùng tới.
      </p>

      {query.isError && <ErrorBanner message="Không tải được danh sách Khoa/Phòng." onRetry={() => query.refetch()} />}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Thẻ "Loại Khoa/Phòng" LUÔN hiện (kể cả 0 loại) — lối vào duy nhất để tạo loại đầu tiên, cùng RoomPane. */}
        <div className="flex w-56 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Loại Khoa/Phòng</span>
            {canManage && (
              <button
                type="button"
                title="Thêm loại"
                onClick={() => setTypeModal({ mode: 'create' })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus size={14} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>
          {hasTypes ? (
            <>
              <div className="relative border-b border-slate-100 px-2.5 py-2">
                <MagnifyingGlass
                  size={13}
                  weight="regular"
                  className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={typeSearch}
                  onChange={(e) => setTypeSearch(e.target.value)}
                  placeholder="Tìm loại..."
                  className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <ul className="flex-1 overflow-y-auto scroll-hover py-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedTypeId(null)}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm font-medium ${
                      selectedTypeId === null ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Tất cả
                  </button>
                </li>
                {visibleTypes.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">Không tìm thấy loại nào.</li>}
                {visibleTypes.map((type) => {
                  const selected = selectedTypeId === type.id;
                  return (
                    <li key={type.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelectedTypeId(type.id)}
                        className={`flex-1 truncate px-3 py-2 text-left text-sm font-medium ${
                          selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                        } ${type.isActive ? '' : 'opacity-50'}`}
                      >
                        {type.name}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setTypeModal({ mode: 'edit', type })}
                          className="mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-400"
                        >
                          <PencilSimple size={13} weight="regular" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-400">Chưa có loại nào. Bấm + để thêm.</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Khoa/Phòng</span>
            {canManage && (
              <Button type="button" onClick={() => setModal({ mode: 'create' })}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                Thêm Khoa/Phòng
              </Button>
            )}
          </div>

          {query.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {query.isSuccess && items.length === 0 && (
            <EmptyState icon={Buildings} title="Chưa có Khoa/Phòng nào" description="Thêm mới nếu cần phân nhóm nhân sự theo khoa/phòng." />
          )}

          {query.isSuccess && items.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="w-28 px-4 py-2.5 text-center">Mã</th>
                    <th className="px-4 py-2.5 text-left">Tên Khoa/Phòng</th>
                    {hasTypes && <th className="w-40 px-4 py-2.5 text-center">Phân loại</th>}
                    <th className="w-36 px-4 py-2.5 text-center">Trạng thái</th>
                    {canManage && <th className="w-20 px-4 py-2.5 text-center">Sửa</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((department) => (
                    <tr key={department.id} className={`border-b border-slate-200 last:border-0 ${department.isActive ? '' : 'opacity-50'}`}>
                      {/* Mã không bấm được → đen, không xanh (.claude/docs/ui-guidelines.md mục 9 nhóm 2) — tự sinh, không sửa qua UI này. */}
                      <td className="px-4 py-2 text-center font-semibold text-slate-800">{department.code ?? '—'}</td>
                      <td className="px-4 py-2 text-left font-medium text-slate-900">{department.name}</td>
                      {hasTypes && <td className="px-4 py-2 text-center font-medium text-slate-600">{department.departmentTypeName ?? '—'}</td>}
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            department.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {department.isActive ? 'Đang hoạt động' : 'Ngưng dùng'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-center">
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() => setModal({ mode: 'edit', department })}
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
          )}
        </div>
      </div>

      {typeModal && (
        <DepartmentTypeFormModal
          mode={typeModal.mode}
          type={typeModal.type}
          submitting={createTypeMutation.isPending || updateTypeMutation.isPending}
          onCancel={() => setTypeModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setTypeModal(null);
            if (typeModal.mode === 'create') {
              createTypeMutation.mutate({ name: dto.name }, { onSuccess: onSettled });
            } else if (typeModal.type) {
              updateTypeMutation.mutate(
                { id: typeModal.type.id, body: { name: dto.name, isActive: dto.isActive, version: typeModal.type.version } },
                { onSuccess: onSettled },
              );
            }
          }}
        />
      )}

      {modal && (
        <DepartmentFormModal
          mode={modal.mode}
          department={modal.department}
          types={types}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setModal(null);
            if (modal.mode === 'create') {
              createMutation.mutate({ name: dto.name, departmentTypeId: dto.departmentTypeId }, { onSuccess: onSettled });
            } else if (modal.department) {
              updateMutation.mutate(
                {
                  id: modal.department.id,
                  body: {
                    name: dto.name,
                    departmentTypeId: dto.departmentTypeId ?? null,
                    isActive: dto.isActive,
                    version: modal.department.version,
                  },
                },
                { onSuccess: onSettled },
              );
            }
          }}
        />
      )}
    </div>
  );
}

function DepartmentTypeFormModal({
  mode,
  type,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  type?: DepartmentTypeSummary;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [isActive, setIsActive] = useState(type?.isActive ?? true);
  const isInvalid = name.trim() === '';

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa (`.claude/docs/
  // ui-guidelines.md` mục 4.4).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({ name: name.trim(), isActive });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm Loại Khoa/Phòng' : 'Sửa Loại Khoa/Phòng'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="dept-type-name" className="text-sm font-semibold text-slate-800">
            Tên loại
          </label>
          <input
            id="dept-type-name"
            placeholder="Ví dụ: Khối Lâm sàng"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
          />
        </div>

        {mode === 'edit' && (
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang hoạt động
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
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

function DepartmentFormModal({
  mode,
  department,
  types,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  department?: DepartmentSummary;
  types: DepartmentTypeSummary[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; departmentTypeId?: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(department?.name ?? '');
  const [departmentTypeId, setDepartmentTypeId] = useState(department?.departmentTypeId ?? NO_TYPE_VALUE);
  const [isActive, setIsActive] = useState(department?.isActive ?? true);

  const typeOptions = [{ value: NO_TYPE_VALUE, label: 'Không phân loại' }, ...types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))];
  const isInvalid = name.trim() === '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({ name: name.trim(), departmentTypeId: departmentTypeId === NO_TYPE_VALUE ? undefined : departmentTypeId, isActive });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm Khoa/Phòng' : 'Sửa Khoa/Phòng'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="dept-name" className="text-sm font-semibold text-slate-800">
            Tên Khoa/Phòng
          </label>
          <input id="dept-name" placeholder="Ví dụ: Khoa Nội" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </div>

        {types.length > 0 && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="dept-type" className="text-sm font-semibold text-slate-800">
              Phân loại
            </label>
            <Combobox id="dept-type" value={departmentTypeId} onChange={setDepartmentTypeId} options={typeOptions} />
          </div>
        )}

        {mode === 'edit' && (
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang hoạt động
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
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