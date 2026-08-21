import { useMemo, useState } from 'react';
import { MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import type { UserAccountSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useDepartmentsQuery } from '../department/department.queries';
import { useRolesQuery } from '../role/role.queries';
import { roleLabel } from '../role/role-labels';
import { UserAccountFormDialog, type UserAccountFormValues } from './UserAccountFormDialog';
import {
  useCreateUserAccountMutation,
  useResetUserPasswordMutation,
  useUpdateUserAccountMutation,
  useUserAccountsQuery,
} from './user-account.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.';
}

/** `undefined`/`''` → `null` (xoá trên server), chuỗi có nội dung → giữ nguyên — dùng cho mọi trường text tuỳ chọn lúc PATCH. */
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * "Quản lý tài khoản" (mở rộng ADM-01) — bảng danh sách + modal Thêm/Sửa (`UserAccountFormDialog`)
 * + dialog "Đặt lại mật khẩu" riêng. Đặt trong pill cùng trang với "Vai trò & Phân quyền"
 * (`RolePermissionPage.tsx`). Quy mô nhân sự nhỏ — không virtualization/cuộn vô hạn như
 * `PatientListPage` (`.claude/docs/ui-guidelines.md` mục 9, lý do bắt buộc virtualization không
 * áp dụng ở đây).
 */
export function UserAccountPane() {
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; item?: UserAccountSummary } | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserAccountSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const accountsQuery = useUserAccountsQuery();
  const departmentsQuery = useDepartmentsQuery();
  const employmentStatusQuery = useReferenceCatalogQuery('EMPLOYMENT_STATUS');
  const rolesQuery = useRolesQuery();
  const createMutation = useCreateUserAccountMutation();
  const updateMutation = useUpdateUserAccountMutation();

  const departmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departmentsQuery.data?.items ?? []) map.set(d.id, d.name);
    return map;
  }, [departmentsQuery.data]);

  const employmentStatusNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of employmentStatusQuery.data?.items ?? []) map.set(i.code, i.name);
    return map;
  }, [employmentStatusQuery.data]);

  const employmentStatusDeactivatesByCode = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const i of employmentStatusQuery.data?.items ?? []) map.set(i.code, i.deactivatesAccount);
    return map;
  }, [employmentStatusQuery.data]);

  const roleIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rolesQuery.data?.items ?? []) map.set(r.name, r.id);
    return map;
  }, [rolesQuery.data]);

  const items = useMemo(() => {
    const all = accountsQuery.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.employeeCode ?? '').toLowerCase().includes(q),
    );
  }, [accountsQuery.data, search]);

  function currentRoleIdsFor(item: UserAccountSummary): string[] {
    return item.roleNames.map((name) => roleIdByName.get(name)).filter((id): id is string => id !== undefined);
  }

  function handleSubmit(values: UserAccountFormValues) {
    setActionError(null);
    if (modal?.mode === 'create') {
      createMutation.mutate(
        {
          username: values.username.trim(),
          password: values.password,
          fullName: values.fullName.trim(),
          phone: values.phone.trim() || undefined,
          personalEmail: values.personalEmail.trim() || undefined,
          companyEmail: values.companyEmail.trim() || undefined,
          academicTitleCode: values.academicTitleCode || undefined,
          positionCode: values.positionCode || undefined,
          employmentStatusCode: values.employmentStatusCode || undefined,
          employmentTypeCode: values.employmentTypeCode || undefined,
          canSignMedicalRecord: values.canSignMedicalRecord,
          mustChangePassword: values.mustChangePassword,
          departmentId: values.departmentId || undefined,
          roleIds: values.roleIds,
        },
        { onSuccess: () => setModal(null), onError: (err) => setActionError(errorMessage(err)) },
      );
    } else if (modal?.item) {
      // Trạng thái làm việc tự-vô-hiệu-hoá (checkbox "Đang hoạt động" đã bị khoá/disabled trong
      // form, xem UserAccountFormDialog) — KHÔNG gửi `isActive` trong trường hợp này. Form React
      // luôn giữ `values.isActive` là boolean cụ thể (không có khái niệm "chưa đụng tới" như
      // field text rỗng), gửi thẳng `true` sẽ bị backend hiểu là client cố ép kích hoạt lại →
      // 409 ACCOUNT_CANNOT_REACTIVATE_WHILE_RESIGNED dù người dùng không hề đụng vào checkbox đó
      // (bug thật phát hiện lúc kiểm bằng Playwright, không phải suy đoán) — để trống cho backend
      // tự lặng lẽ ép `false` (`resolveAccountActiveState`, `user-account.service.ts`).
      const statusDeactivates = values.employmentStatusCode
        ? (employmentStatusDeactivatesByCode.get(values.employmentStatusCode) ?? false)
        : false;
      updateMutation.mutate(
        {
          id: modal.item.id,
          body: {
            fullName: values.fullName.trim(),
            phone: nullableText(values.phone),
            personalEmail: nullableText(values.personalEmail),
            companyEmail: nullableText(values.companyEmail),
            academicTitleCode: nullableText(values.academicTitleCode),
            positionCode: nullableText(values.positionCode),
            employmentStatusCode: nullableText(values.employmentStatusCode),
            employmentTypeCode: nullableText(values.employmentTypeCode),
            canSignMedicalRecord: values.canSignMedicalRecord,
            departmentId: nullableText(values.departmentId),
            isActive: statusDeactivates ? undefined : values.isActive,
            roleIds: values.roleIds,
            version: modal.item.version,
          },
        },
        { onSuccess: () => setModal(null), onError: (err) => setActionError(errorMessage(err)) },
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <MagnifyingGlass
            size={15}
            weight="regular"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã NV, họ tên hoặc tên đăng nhập..."
            className={`${inputClassName} pl-8`}
          />
        </div>
        <Button type="button" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          Thêm tài khoản
        </Button>
      </div>

      {actionError && <ErrorBanner message={actionError} />}
      {accountsQuery.isError && <ErrorBanner message="Không tải được danh sách tài khoản." onRetry={() => accountsQuery.refetch()} />}

      {accountsQuery.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {accountsQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={MagnifyingGlass} title="Không tìm thấy tài khoản nào" description="Thử từ khoá khác hoặc thêm tài khoản mới." />
      )}

      {accountsQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white scroll-hover">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="w-32 px-4 py-2.5 text-center">Mã NV</th>
                <th className="px-4 py-2.5 text-left">Họ tên</th>
                <th className="px-4 py-2.5 text-center">Tên đăng nhập</th>
                <th className="px-4 py-2.5 text-left">Vai trò</th>
                <th className="px-4 py-2.5 text-center">Khoa/Phòng</th>
                <th className="px-4 py-2.5 text-center">Trạng thái làm việc</th>
                <th className="px-4 py-2.5 text-center">Trạng thái tài khoản</th>
                <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-200 last:border-0">
                  <td
                    className="cursor-pointer px-4 py-2 text-center font-medium text-blue-600 hover:text-blue-700"
                    onDoubleClick={() => setModal({ mode: 'edit', item })}
                  >
                    {item.employeeCode ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-left font-medium text-slate-900">{item.fullName}</td>
                  <td className="px-4 py-2 text-center font-medium text-slate-600">{item.username}</td>
                  <td className="px-4 py-2 text-left font-medium text-slate-600">
                    {item.roleNames.length > 0 ? item.roleNames.map((name) => roleLabel(name)).join(', ') : '—'}
                  </td>
                  <td className="px-4 py-2 text-center font-medium text-slate-600">
                    {item.departmentId ? (departmentNameById.get(item.departmentId) ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-2 text-center font-medium text-slate-600">
                    {item.employmentStatusCode ? (employmentStatusNameByCode.get(item.employmentStatusCode) ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {item.isActive ? 'Đang hoạt động' : 'Vô hiệu hoá'}
                    </span>
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserAccountFormDialog
          mode={modal.mode}
          item={modal.item}
          currentRoleIds={modal.item ? currentRoleIdsFor(modal.item) : []}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
          onResetPassword={modal.item ? () => setResetPasswordTarget(modal.item!) : undefined}
        />
      )}

      {resetPasswordTarget && (
        <ResetPasswordDialog
          item={resetPasswordTarget}
          onCancel={() => setResetPasswordTarget(null)}
          onDone={() => {
            setResetPasswordTarget(null);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function ResetPasswordDialog({
  item,
  onCancel,
  onDone,
}: {
  item: UserAccountSummary;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const resetMutation = useResetUserPasswordMutation();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-slate-900">Đặt lại mật khẩu — {item.fullName}</h3>
        {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="reset-new-password" className="text-sm font-semibold text-slate-800">
            Mật khẩu mới
          </label>
          <PasswordInput id="reset-new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} />
          Thay đổi mật khẩu lần đầu
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            type="button"
            loading={resetMutation.isPending}
            disabled={newPassword.length < 8}
            onClick={() => {
              setError(null);
              resetMutation.mutate(
                { id: item.id, body: { newPassword, mustChangePassword, version: item.version } },
                { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
              );
            }}
          >
            Đặt lại mật khẩu
          </Button>
        </div>
      </div>
    </div>
  );
}