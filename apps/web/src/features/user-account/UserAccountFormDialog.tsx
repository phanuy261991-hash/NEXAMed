import { useState } from 'react';
import type { UserAccountSummary } from '@nexamed/shared';
import { Combobox, withLegacyValueOption, type ComboboxOption } from '../../shared/ui/Combobox';
import { MultiSelectCombobox } from '../../shared/ui/MultiSelectCombobox';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Button } from '../../shared/ui/Button';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useDepartmentsQuery, useCreateDepartmentMutation } from '../department/department.queries';
import { useRolesQuery } from '../role/role.queries';
import { roleLabel } from '../role/role-labels';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';
const labelClassName = 'mb-1 block text-sm font-semibold text-slate-800';
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const fieldGridClassName = 'grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3';

function Field({
  id,
  label,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClassName} htmlFor={id}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export interface UserAccountFormValues {
  username: string;
  password: string;
  fullName: string;
  phone: string;
  personalEmail: string;
  companyEmail: string;
  academicTitleCode: string;
  positionCode: string;
  employmentStatusCode: string;
  employmentTypeCode: string;
  canSignMedicalRecord: boolean;
  mustChangePassword: boolean;
  departmentId: string;
  isActive: boolean;
  roleIds: string[];
}

function toFormValues(item: UserAccountSummary | undefined): UserAccountFormValues {
  return {
    username: item?.username ?? '',
    password: '',
    fullName: item?.fullName ?? '',
    phone: item?.phone ?? '',
    personalEmail: item?.personalEmail ?? '',
    companyEmail: item?.companyEmail ?? '',
    academicTitleCode: item?.academicTitleCode ?? '',
    positionCode: item?.positionCode ?? '',
    employmentStatusCode: item?.employmentStatusCode ?? '',
    employmentTypeCode: item?.employmentTypeCode ?? '',
    canSignMedicalRecord: item?.canSignMedicalRecord ?? false,
    mustChangePassword: item?.mustChangePassword ?? false,
    departmentId: item?.departmentId ?? '',
    isActive: item?.isActive ?? true,
    roleIds: [],
  };
}

/**
 * Modal Thêm/Sửa tài khoản (mở rộng ADM-01) — Boxed Section Form Pattern
 * (`.claude/docs/ui-guidelines.md` mục 9b): "Thông tin cá nhân" / "Công việc & Vai trò" /
 * "Tài khoản đăng nhập". Lúc sửa: không có ô mật khẩu (đổi mật khẩu là thao tác riêng, xem
 * `ResetPasswordDialog` trong `UserAccountPane.tsx`), Tên đăng nhập chỉ đọc (không đổi được sau
 * khi tạo — không có endpoint đổi username).
 */
export function UserAccountFormDialog({
  mode,
  item,
  currentRoleIds,
  submitting,
  onCancel,
  onSubmit,
  onResetPassword,
}: {
  mode: 'create' | 'edit';
  item?: UserAccountSummary;
  /** Vai trò hiện tại của tài khoản (edit) — `userAccountSummarySchema` chỉ trả `roleNames`, không có id, nên truyền riêng từ nơi đã tra được. */
  currentRoleIds: string[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: UserAccountFormValues) => void;
  /** Mở dialog "Đặt lại mật khẩu" riêng (quản lý bởi `UserAccountPane.tsx` — cần `version` mới nhất, không phải `item` chụp lúc mở form sửa). Chỉ có ở `mode='edit'`. */
  onResetPassword?: () => void;
}) {
  const [values, setValues] = useState<UserAccountFormValues>(() => ({
    ...toFormValues(item),
    roleIds: currentRoleIds,
  }));

  function set<K extends keyof UserAccountFormValues>(key: K, value: UserAccountFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const academicTitleQuery = useReferenceCatalogQuery('ACADEMIC_TITLE');
  const positionQuery = useReferenceCatalogQuery('STAFF_POSITION');
  const employmentStatusQuery = useReferenceCatalogQuery('EMPLOYMENT_STATUS');
  const employmentTypeQuery = useReferenceCatalogQuery('EMPLOYMENT_TYPE');
  const departmentsQuery = useDepartmentsQuery();
  const createDepartmentMutation = useCreateDepartmentMutation();
  const rolesQuery = useRolesQuery();

  const academicTitleOptions = withLegacyValueOption(
    (academicTitleQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.academicTitleCode,
  );
  const positionOptions = withLegacyValueOption(
    (positionQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.positionCode,
  );
  const employmentStatusItems = employmentStatusQuery.data?.items ?? [];
  const employmentStatusOptions: ComboboxOption[] = withLegacyValueOption(
    employmentStatusItems.map((i) => ({ value: i.code, label: i.name })),
    values.employmentStatusCode,
  );
  const employmentTypeOptions = withLegacyValueOption(
    (employmentTypeQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.employmentTypeCode,
  );
  // Chỉ chào Khoa/Phòng đang active — Khoa/Phòng đã ẩn (DepartmentPane) không nên gán mới. Khác
  // các Combobox theo mã ngắn khác (`withLegacyValueOption` hiện thẳng value làm label), value ở
  // đây là UUID — nếu hồ sơ cũ đang gán vào Khoa/Phòng vừa ẩn, lấy đúng TÊN thật từ danh sách đầy
  // đủ (đã tải, chỉ đang lọc để hiển thị) thay vì hiện UUID thô.
  const allDepartments = departmentsQuery.data?.items ?? [];
  const departmentOptions: ComboboxOption[] = allDepartments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }));
  if (values.departmentId !== '' && !departmentOptions.some((o) => o.value === values.departmentId)) {
    const legacy = allDepartments.find((d) => d.id === values.departmentId);
    departmentOptions.unshift({ value: values.departmentId, label: legacy ? `${legacy.name} (đã ẩn)` : values.departmentId });
  }

  const selectedStatus = employmentStatusItems.find((i) => i.code === values.employmentStatusCode);
  const statusDeactivatesAccount = selectedStatus?.deactivatesAccount ?? false;

  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [addingDepartment, setAddingDepartment] = useState(false);

  const canSubmit =
    values.fullName.trim() !== '' &&
    values.roleIds.length > 0 &&
    (mode === 'edit' || (values.username.trim().length >= 3 && values.password.length >= 8));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl scroll-hover">
        <h2 className="text-[15px] font-bold text-slate-900">{mode === 'create' ? 'Thêm tài khoản' : 'Sửa tài khoản'}</h2>

        <div className="mt-6 space-y-6">
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Thông tin cá nhân</span>
            <div className={fieldGridClassName}>
              <Field id="ua-fullname" label="Họ và tên" required className="sm:col-span-2">
                <input id="ua-fullname" value={values.fullName} onChange={(e) => set('fullName', e.target.value)} className={inputClassName} />
              </Field>
              <Field id="ua-phone" label="Số điện thoại">
                <input id="ua-phone" value={values.phone} onChange={(e) => set('phone', e.target.value)} className={inputClassName} />
              </Field>
              <Field id="ua-personal-email" label="Email cá nhân">
                <input
                  id="ua-personal-email"
                  type="email"
                  value={values.personalEmail}
                  onChange={(e) => set('personalEmail', e.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field id="ua-company-email" label="Email công ty">
                <input
                  id="ua-company-email"
                  type="email"
                  value={values.companyEmail}
                  onChange={(e) => set('companyEmail', e.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field id="ua-academic-title" label="Học vị/học hàm">
                <Combobox
                  id="ua-academic-title"
                  value={values.academicTitleCode}
                  onChange={(v) => set('academicTitleCode', v)}
                  options={academicTitleOptions}
                />
              </Field>
              <Field id="ua-position" label="Chức danh">
                <Combobox id="ua-position" value={values.positionCode} onChange={(v) => set('positionCode', v)} options={positionOptions} />
              </Field>
              <Field id="ua-department" label="Khoa/Phòng" className="sm:col-span-2">
                {addingDepartment ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newDepartmentName}
                      onChange={(e) => setNewDepartmentName(e.target.value)}
                      placeholder="Tên khoa/phòng mới"
                      className={inputClassName}
                    />
                    <Button
                      type="button"
                      className="flex-shrink-0 px-3 py-2"
                      loading={createDepartmentMutation.isPending}
                      disabled={newDepartmentName.trim() === ''}
                      onClick={() =>
                        createDepartmentMutation.mutate(
                          { name: newDepartmentName.trim() },
                          {
                            onSuccess: (created) => {
                              set('departmentId', created.id);
                              setNewDepartmentName('');
                              setAddingDepartment(false);
                            },
                          },
                        )
                      }
                    >
                      Thêm
                    </Button>
                    <Button type="button" variant="secondary" className="flex-shrink-0 px-3 py-2" onClick={() => setAddingDepartment(false)}>
                      Huỷ
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Combobox id="ua-department" value={values.departmentId} onChange={(v) => set('departmentId', v)} options={departmentOptions} />
                    </div>
                    <Button type="button" variant="secondary" className="flex-shrink-0 px-3 py-2" onClick={() => setAddingDepartment(true)}>
                      + Thêm mới
                    </Button>
                  </div>
                )}
              </Field>
            </div>
          </div>

          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Công việc &amp; Vai trò</span>
            <div className={fieldGridClassName}>
              <Field id="ua-employment-status" label="Trạng thái làm việc">
                <Combobox
                  id="ua-employment-status"
                  value={values.employmentStatusCode}
                  onChange={(v) => set('employmentStatusCode', v)}
                  options={employmentStatusOptions}
                />
              </Field>
              <Field id="ua-employment-type" label="Hình thức làm việc">
                <Combobox
                  id="ua-employment-type"
                  value={values.employmentTypeCode}
                  onChange={(v) => set('employmentTypeCode', v)}
                  options={employmentTypeOptions}
                />
              </Field>
              <Field id="ua-roles" label="Vai trò" required>
                <MultiSelectCombobox
                  id="ua-roles"
                  values={values.roleIds}
                  onChange={(ids) => set('roleIds', ids)}
                  options={(rolesQuery.data?.items ?? []).map((role) => ({ value: role.id, label: roleLabel(role.name) }))}
                  placeholder={rolesQuery.isLoading ? 'Đang tải...' : 'Chọn vai trò...'}
                />
              </Field>
            </div>

            {/* Mọi checkbox trong khối này gộp chung 1 dòng — tránh đặt cạnh ô nhập liệu (phản hồi
                chủ dự án 2026-08-20, nhìn mất cân đối khi checkbox cao bằng 1 ô Combobox trống). */}
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={values.canSignMedicalRecord} onChange={(e) => set('canSignMedicalRecord', e.target.checked)} />
                Được ký HSBA
              </label>
              {mode === 'edit' && (
                <label className={`flex items-center gap-2 text-sm font-semibold ${statusDeactivatesAccount ? 'text-slate-400' : 'text-slate-800'}`}>
                  <input
                    type="checkbox"
                    checked={values.isActive}
                    disabled={statusDeactivatesAccount}
                    onChange={(e) => set('isActive', e.target.checked)}
                  />
                  Đang hoạt động
                </label>
              )}
            </div>
            {statusDeactivatesAccount && (
              <p className="mt-2 text-xs font-medium text-amber-600">
                Trạng thái làm việc đang chọn sẽ tự động vô hiệu hoá tài khoản khi lưu.
              </p>
            )}
          </div>

          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Tài khoản đăng nhập</span>
            <div className={fieldGridClassName}>
              <Field id="ua-username" label="Tên đăng nhập" required>
                <input
                  id="ua-username"
                  value={values.username}
                  disabled={mode === 'edit'}
                  onChange={(e) => set('username', e.target.value)}
                  className={inputClassName}
                />
              </Field>

              {mode === 'create' ? (
                <Field id="ua-password" label="Mật khẩu" required>
                  <PasswordInput id="ua-password" value={values.password} onChange={(v) => set('password', v)} autoComplete="new-password" />
                </Field>
              ) : (
                <div className="flex items-end">
                  <Button type="button" variant="secondary" onClick={onResetPassword}>
                    Đặt lại mật khẩu
                  </Button>
                </div>
              )}
            </div>

            {mode === 'create' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={values.mustChangePassword}
                    onChange={(e) => set('mustChangePassword', e.target.checked)}
                  />
                  Thay đổi mật khẩu lần đầu
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="button" loading={submitting} disabled={!canSubmit} onClick={() => onSubmit(values)}>
            {mode === 'create' ? 'Tạo tài khoản' : 'Lưu thay đổi'}
          </Button>
        </div>
      </div>
    </div>
  );
}
