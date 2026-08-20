import { useEffect, useMemo, useState } from 'react';
import { EyeSlash, PencilSimple, Plus } from '@phosphor-icons/react';
import type { DataScope, RoleSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { RoleMatrixTable } from './RoleMatrixTable';
import { roleLabel } from './role-labels';
import {
  useCreateRoleMutation,
  useHideRoleMutation,
  useRenameRoleMutation,
  useRoleMatrixQuery,
  useRolesQuery,
  useUpdateRoleMatrixMutation,
} from './role.queries';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.';
}

/** Chữ cái đầu tối đa 2 từ đầu tiên (cùng quy tắc avatar ở TopBar.tsx) — "Bác sĩ" → "BS". */
function roleInitials(label: string): string {
  const letters = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.join('') || '?';
}

/**
 * "Vai trò & Phân quyền" (ADM-07) — cột trái danh sách vai trò (5 mặc định + tuỳ biến), cột phải
 * ma trận quyền của vai trò đang chọn. Mockup đã duyệt qua Artifact trước khi code — xem
 * `RoleMatrixTable.tsx` cho bố cục bảng CRUD.
 */
export function RolePermissionPane() {
  const rolesQuery = useRolesQuery();
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, DataScope>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RoleSummary | null>(null);
  const [hideTarget, setHideTarget] = useState<RoleSummary | null>(null);

  const roles = rolesQuery.data?.items ?? [];

  useEffect(() => {
    if (activeRoleId === null && roles.length > 0) {
      setActiveRoleId(roles[0]!.id);
    }
  }, [activeRoleId, roles]);

  const activeRole = roles.find((r) => r.id === activeRoleId) ?? null;
  const matrixQuery = useRoleMatrixQuery(activeRoleId);
  const updateMatrixMutation = useUpdateRoleMatrixMutation();
  const createMutation = useCreateRoleMutation();
  const renameMutation = useRenameRoleMutation();
  const hideMutation = useHideRoleMutation();

  const displayPermissions = useMemo(() => {
    const base = matrixQuery.data?.permissions ?? [];
    if (Object.keys(pending).length === 0) return base;
    return base.map((p) => (p.permissionId in pending ? { ...p, dataScope: pending[p.permissionId]! } : p));
  }, [matrixQuery.data, pending]);

  const dirty = Object.keys(pending).length > 0;

  function selectRole(id: string) {
    setActiveRoleId(id);
    setPending({});
    setActionError(null);
  }

  function handleScopeChange(permissionId: string, scope: DataScope) {
    const original = matrixQuery.data?.permissions.find((p) => p.permissionId === permissionId)?.dataScope;
    setPending((prev) => {
      const next = { ...prev };
      if (scope === original) {
        delete next[permissionId];
      } else {
        next[permissionId] = scope;
      }
      return next;
    });
  }

  function handleSave() {
    if (!activeRole) return;
    setActionError(null);
    const entries = Object.entries(pending).map(([permissionId, dataScope]) => ({ permissionId, dataScope }));
    updateMatrixMutation.mutate(
      { id: activeRole.id, body: { entries } },
      { onSuccess: () => setPending({}), onError: (err) => setActionError(errorMessage(err)) },
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Vai trò &amp; Phân quyền</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Chọn một vai trò bên trái, cấu hình quyền theo từng phân hệ ở bảng bên phải. Dấu &quot;—&quot; nghĩa là tính năng đó
            không có loại quyền này trong hệ thống (không phải ô có thể chọn).
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          Vai trò mới
        </Button>
      </div>

      {rolesQuery.isError && <ErrorBanner message="Không tải được danh sách vai trò." onRetry={() => rolesQuery.refetch()} />}
      {actionError && <ErrorBanner message={actionError} />}

      {rolesQuery.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {rolesQuery.isSuccess && (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-slate-200 p-2 scroll-hover">
            {roles.map((role) => (
              <div
                key={role.id}
                onClick={() => selectRole(role.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && selectRole(role.id)}
                className={`group mb-0.5 flex cursor-pointer items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-left transition-colors ${
                  role.id === activeRoleId ? 'border-blue-600 bg-blue-50' : 'border-transparent hover:bg-slate-50'
                }`}
              >
                <div
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                    role.isSystemDefault ? 'bg-slate-100 text-slate-600' : 'bg-brand-teal-tint text-brand-teal'
                  }`}
                >
                  {roleInitials(roleLabel(role.name))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{roleLabel(role.name)}</div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                    {role.isSystemDefault ? 'Mặc định' : 'Tuỳ biến'}
                  </div>
                </div>
                {!role.isSystemDefault && (
                  <div className="hidden flex-shrink-0 gap-1 group-hover:flex">
                    <button
                      type="button"
                      title="Đổi tên"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameTarget(role);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700"
                    >
                      <PencilSimple size={13} weight="regular" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      title="Ẩn vai trò"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHideTarget(role);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-rose-600"
                    >
                      <EyeSlash size={13} weight="regular" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {matrixQuery.isLoading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {matrixQuery.isError && (
              <div className="p-4">
                <ErrorBanner message="Không tải được ma trận quyền." onRetry={() => matrixQuery.refetch()} />
              </div>
            )}
            {matrixQuery.isSuccess && (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-hover">
                  <RoleMatrixTable
                    permissions={displayPermissions}
                    disabled={updateMatrixMutation.isPending}
                    onScopeChange={handleScopeChange}
                  />
                </div>
                {dirty && (
                  <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
                    <span className="text-xs font-semibold text-amber-600">● Có thay đổi chưa lưu</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setPending({})}>
                        Huỷ
                      </Button>
                      <Button type="button" className="px-3 py-1.5" loading={updateMatrixMutation.isPending} onClick={handleSave}>
                        Lưu thay đổi
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <RoleNameDialog
          title="Tạo vai trò mới"
          submitLabel="Tạo vai trò"
          hint='Vai trò mới bắt đầu với mọi quyền ở mức "Không" — chọn vai trò vừa tạo để cấp quyền.'
          submitting={createMutation.isPending}
          onCancel={() => setCreateOpen(false)}
          onSubmit={(name) => {
            setActionError(null);
            createMutation.mutate(
              { name },
              {
                onSuccess: (role) => {
                  setCreateOpen(false);
                  selectRole(role.id);
                },
                onError: (err) => setActionError(errorMessage(err)),
              },
            );
          }}
        />
      )}

      {renameTarget && (
        <RoleNameDialog
          title="Đổi tên vai trò"
          submitLabel="Lưu"
          initialName={renameTarget.name}
          submitting={renameMutation.isPending}
          onCancel={() => setRenameTarget(null)}
          onSubmit={(name) => {
            setActionError(null);
            renameMutation.mutate(
              { id: renameTarget.id, body: { name, version: renameTarget.version } },
              {
                onSuccess: () => setRenameTarget(null),
                onError: (err) => setActionError(errorMessage(err)),
              },
            );
          }}
        />
      )}

      {hideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Ẩn vai trò &quot;{hideTarget.name}&quot;?</p>
            <p className="mt-1.5 text-xs text-slate-500">
              Chỉ ẩn được vai trò không còn tài khoản nào đang gán. Có thể tạo lại đúng tên này sau nếu cần.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setHideTarget(null)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={hideMutation.isPending}
                onClick={() =>
                  hideMutation.mutate(
                    { id: hideTarget.id, body: { version: hideTarget.version } },
                    {
                      onSuccess: () => {
                        setHideTarget(null);
                        if (activeRoleId === hideTarget.id) setActiveRoleId(null);
                      },
                      onError: (err) => {
                        setActionError(errorMessage(err));
                        setHideTarget(null);
                      },
                    },
                  )
                }
              >
                Ẩn vai trò
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleNameDialog({
  title,
  submitLabel,
  hint,
  initialName = '',
  submitting,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  hint?: string;
  initialName?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="role-name" className="text-sm font-semibold text-slate-800">
            Tên vai trò
          </label>
          <input
            id="role-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Lễ tân trưởng"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {hint && <p className="text-xs text-slate-400" dangerouslySetInnerHTML={{ __html: hint }} />}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="button" loading={submitting} disabled={name.trim() === ''} onClick={() => onSubmit(name.trim())}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}