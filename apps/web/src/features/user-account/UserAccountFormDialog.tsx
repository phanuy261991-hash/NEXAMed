import { useEffect, useState } from 'react';
import type { UserAccountGender, UserAccountSummary } from '@nexamed/shared';
import { Combobox, withLegacyValueOption, type ComboboxOption } from '../../shared/ui/Combobox';
import { MultiSelectCombobox } from '../../shared/ui/MultiSelectCombobox';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Button } from '../../shared/ui/Button';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useDepartmentsQuery, useCreateDepartmentMutation } from '../department/department.queries';
import { useRoomsQuery } from '../clinic/clinic.queries';
import { useRolesQuery } from '../role/role.queries';
import { roleLabel } from '../role/role-labels';
import { UserAccountSignatureUpload } from './UserAccountSignatureUpload';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';
const labelClassName = 'mb-1 block text-sm font-semibold text-slate-800';
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const fieldGridClassName = 'grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3';

const TABS = [
  { id: 'general', label: 'Thông tin chung' },
  { id: 'professional', label: 'Chuyên môn và Pháp lý' },
  { id: 'config', label: 'Cấu hình và Vai trò' },
] as const;
type TabId = (typeof TABS)[number]['id'];

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
  displayName: string;
  phone: string;
  email: string;
  dob: string;
  gender: '' | UserAccountGender;
  academicTitleCode: string;
  positionCode: string;
  employmentStatusCode: string;
  employmentTypeCode: string;
  licenseNo: string;
  licenseIssuedAt: string;
  licenseIssuedPlace: string;
  canSignMedicalRecord: boolean;
  mustChangePassword: boolean;
  departmentId: string;
  defaultRoomId: string;
  isActive: boolean;
  roleIds: string[];
}

function toFormValues(item: UserAccountSummary | undefined): UserAccountFormValues {
  return {
    username: item?.username ?? '',
    password: '',
    fullName: item?.fullName ?? '',
    displayName: item?.displayName ?? '',
    phone: item?.phone ?? '',
    email: item?.email ?? '',
    dob: item?.dob ?? '',
    gender: item?.gender ?? '',
    academicTitleCode: item?.academicTitleCode ?? '',
    positionCode: item?.positionCode ?? '',
    employmentStatusCode: item?.employmentStatusCode ?? '',
    employmentTypeCode: item?.employmentTypeCode ?? '',
    licenseNo: item?.licenseNo ?? '',
    licenseIssuedAt: item?.licenseIssuedAt ?? '',
    licenseIssuedPlace: item?.licenseIssuedPlace ?? '',
    canSignMedicalRecord: item?.canSignMedicalRecord ?? false,
    mustChangePassword: item?.mustChangePassword ?? false,
    departmentId: item?.departmentId ?? '',
    defaultRoomId: item?.defaultRoomId ?? '',
    isActive: item?.isActive ?? true,
    roleIds: [],
  };
}

/**
 * Modal Thêm/Sửa tài khoản (redesign 3-tab, `docs/DECISIONS.md` #082) — thay bố cục Boxed Section
 * gộp chung (mục 9b) bằng 3 Tab: "Thông tin chung" / "Chuyên môn và Pháp lý" / "Cấu hình và Vai
 * trò". Mỗi tab vẫn dùng Boxed Section Form Pattern bên trong. 2 nút hành động cố định ở chân
 * modal (`flex-shrink-0`, ngoài vùng cuộn), không cuộn theo nội dung tab. Lúc sửa: không có ô mật
 * khẩu (đổi mật khẩu là thao tác riêng, xem `ResetPasswordDialog` trong `UserAccountPane.tsx`),
 * Tên đăng nhập chỉ đọc (không đổi được sau khi tạo — không có endpoint đổi username).
 *
 * "Tên hiển thị" tự động gợi ý ghép Học vị/Học hàm + Họ tên (chỉ khi người dùng CHƯA từng tự gõ
 * tay vào ô này — `displayNameTouched`) — mặc định coi ĐÃ chỉnh tay khi sửa tài khoản có sẵn
 * (không âm thầm ghi đè giá trị đã lưu chỉ vì đổi Họ tên).
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
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [values, setValues] = useState<UserAccountFormValues>(() => ({
    ...toFormValues(item),
    roleIds: currentRoleIds,
  }));
  // Chỉ coi là "đã chỉnh tay" khi ĐÃ có displayName lưu sẵn (giữ nguyên, không âm thầm ghi đè) —
  // tài khoản cũ tạo trước tính năng này (displayName rỗng/null) vẫn cần được gợi ý tự động như
  // lúc tạo mới, không phải cứ ở chế độ Sửa là khoá gợi ý (bug thật: mở Sửa một tài khoản cũ,
  // "Tên hiển thị" đứng im ở placeholder dù đã có Họ tên).
  const [displayNameTouched, setDisplayNameTouched] = useState(Boolean(item?.displayName));

  function set<K extends keyof UserAccountFormValues>(key: K, value: UserAccountFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const academicTitleQuery = useReferenceCatalogQuery('ACADEMIC_TITLE');
  const positionQuery = useReferenceCatalogQuery('STAFF_POSITION');
  const employmentStatusQuery = useReferenceCatalogQuery('EMPLOYMENT_STATUS');
  const employmentTypeQuery = useReferenceCatalogQuery('EMPLOYMENT_TYPE');
  const departmentsQuery = useDepartmentsQuery();
  const createDepartmentMutation = useCreateDepartmentMutation();
  const roomsQuery = useRoomsQuery();
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

  // "Phòng khám mặc định" (redesign 3-tab #082) — cùng cách xử lý legacy value như Khoa/Phòng ở trên.
  const allRooms = roomsQuery.data?.items ?? [];
  const roomOptions: ComboboxOption[] = allRooms.filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }));
  if (values.defaultRoomId !== '' && !roomOptions.some((o) => o.value === values.defaultRoomId)) {
    const legacy = allRooms.find((r) => r.id === values.defaultRoomId);
    roomOptions.unshift({ value: values.defaultRoomId, label: legacy ? `${legacy.name} (đã ẩn)` : values.defaultRoomId });
  }

  const selectedStatus = employmentStatusItems.find((i) => i.code === values.employmentStatusCode);
  const statusDeactivatesAccount = selectedStatus?.deactivatesAccount ?? false;

  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [addingDepartment, setAddingDepartment] = useState(false);

  /** Ghép Học vị/Học hàm + Họ tên — chỉ gợi ý, người dùng sửa lại tự do ở `handleDisplayNameChange`. */
  function suggestDisplayName(fullName: string, academicTitleCode: string): string {
    const titleLabel = academicTitleOptions.find((o) => o.value === academicTitleCode)?.label ?? '';
    return [titleLabel, fullName.trim()].filter(Boolean).join(' ');
  }

  function handleFullNameChange(v: string) {
    set('fullName', v);
    if (!displayNameTouched) set('displayName', suggestDisplayName(v, values.academicTitleCode));
  }

  function handleAcademicTitleChange(v: string) {
    set('academicTitleCode', v);
    if (!displayNameTouched) set('displayName', suggestDisplayName(values.fullName, v));
  }

  // Gợi ý ngay lúc mở dialog (không đợi người dùng gõ lại Họ tên/Học hàm) — cần vì Sửa tài khoản
  // cũ đã có sẵn `fullName` từ trước, nhưng danh mục "Học vị/Học hàm" (để tra label ghép vào) chỉ
  // tải xong SAU khi mount, nên không tính được ngay trong `useState` khởi tạo ở trên.
  useEffect(() => {
    if (displayNameTouched || values.fullName.trim() === '') return;
    const suggestion = suggestDisplayName(values.fullName, values.academicTitleCode);
    if (suggestion !== values.displayName) set('displayName', suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicTitleQuery.data, displayNameTouched]);

  function handleDisplayNameChange(v: string) {
    setDisplayNameTouched(true);
    set('displayName', v);
  }

  // SĐT/Tên hiển thị chỉ bắt buộc lúc TẠO MỚI — tài khoản cũ (tạo trước khi 2 trường này tồn
  // tại) có thể chưa có sẵn, không được khoá nút "Lưu thay đổi" của MỌI sửa đổi khác chỉ vì thiếu
  // 2 trường này (bug thật: mở Sửa tài khoản demo cũ, nút Lưu bị mờ dù chỉ đổi Vai trò).
  const canSubmit =
    values.fullName.trim() !== '' &&
    (mode === 'edit' || values.phone.trim() !== '') &&
    (mode === 'edit' || values.displayName.trim() !== '') &&
    values.roleIds.length > 0 &&
    (mode === 'edit' || (values.username.trim().length >= 3 && values.password.length >= 8));

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa (`.claude/docs/
  // ui-guidelines.md` mục 4.4). `Combobox`/`PasswordInput` đã tự `preventDefault()` trên Enter
  // (chọn giá trị/không có tác dụng phụ) nên không đụng submit ngoài ý muốn; riêng ô "Tên khoa/phòng
  // mới" (thêm nhanh, chưa phải submit cuối) cần chặn tay — xem `handleAddDepartmentKeyDown`.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(values);
  }

  function handleAddDepartmentKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (newDepartmentName.trim() === '' || createDepartmentMutation.isPending) return;
    createDepartmentMutation.mutate(
      { name: newDepartmentName.trim() },
      {
        onSuccess: (created) => {
          set('departmentId', created.id);
          setNewDepartmentName('');
          setAddingDepartment(false);
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 border-b border-slate-200 px-6 pt-5">
          <h2 className="text-[15px] font-bold text-slate-900">{mode === 'create' ? 'Thêm tài khoản' : 'Sửa tài khoản'}</h2>
          <nav className="mt-3 flex gap-1" role="tablist" aria-label="Nhóm thông tin tài khoản">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                  activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 scroll-hover">
          {/* ============ TAB 1 — THÔNG TIN CHUNG ============ */}
          <div className={activeTab === 'general' ? 'flex flex-col gap-6' : 'hidden'}>
            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Thông tin cá nhân</span>
              <div className={fieldGridClassName}>
                <Field id="ua-fullname" label="Họ và tên" required className="sm:col-span-2">
                  <input
                    id="ua-fullname"
                    value={values.fullName}
                    onChange={(e) => handleFullNameChange(e.target.value)}
                    placeholder="VD: Nguyễn Văn An"
                    className={inputClassName}
                  />
                </Field>
                <Field id="ua-phone" label="Số điện thoại" required>
                  <input
                    id="ua-phone"
                    value={values.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    placeholder="VD: 0912 345 678"
                    className={inputClassName}
                  />
                </Field>
                <Field id="ua-dob" label="Ngày sinh">
                  <input id="ua-dob" type="date" value={values.dob} onChange={(e) => set('dob', e.target.value)} className={inputClassName} />
                </Field>
                <Field id="ua-gender" label="Giới tính">
                  <div className="flex h-[42px] items-center gap-5">
                    <label htmlFor="ua-gender-male" className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                      <input
                        id="ua-gender-male"
                        type="checkbox"
                        className="round-checkbox"
                        checked={values.gender === 'male'}
                        onChange={(e) => set('gender', e.target.checked ? 'male' : '')}
                      />
                      Nam
                    </label>
                    <label htmlFor="ua-gender-female" className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                      <input
                        id="ua-gender-female"
                        type="checkbox"
                        className="round-checkbox"
                        checked={values.gender === 'female'}
                        onChange={(e) => set('gender', e.target.checked ? 'female' : '')}
                      />
                      Nữ
                    </label>
                  </div>
                </Field>
                <Field id="ua-email" label="Email" className="sm:col-span-2">
                  <input
                    id="ua-email"
                    type="email"
                    value={values.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="VD: an.nguyen@phongkham.vn"
                    className={inputClassName}
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
              </div>
            </div>

            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Thông tin đăng nhập</span>
              <div className={fieldGridClassName}>
                <Field id="ua-username" label="Tên đăng nhập" required>
                  <input
                    id="ua-username"
                    value={values.username}
                    disabled={mode === 'edit'}
                    onChange={(e) => set('username', e.target.value)}
                    placeholder="VD: an.nguyen"
                    className={inputClassName}
                  />
                </Field>

                {mode === 'create' ? (
                  <Field id="ua-password" label="Mật khẩu" required>
                    <PasswordInput
                      id="ua-password"
                      value={values.password}
                      onChange={(v) => set('password', v)}
                      autoComplete="new-password"
                      placeholder="Tối thiểu 8 ký tự"
                    />
                  </Field>
                ) : (
                  <div>
                    {/* Nhãn vô hình cùng chiều cao `labelClassName` — đảm bảo nút thẳng hàng
                        pixel-perfect với ô "Tên đăng nhập" cạnh bên (có nhãn thật), không dựa vào
                        `items-end` (từng lệch khi 2 cột co giãn khác chiều cao). */}
                    <span className={`${labelClassName} invisible`}>Đặt lại mật khẩu</span>
                    <Button type="button" variant="secondary" className="w-full" onClick={onResetPassword}>
                      Đặt lại mật khẩu
                    </Button>
                  </div>
                )}

                <Field id="ua-status" label="Trạng thái">
                  <div className="flex h-[42px] items-center gap-1 rounded-full border border-slate-300 p-1">
                    <button
                      type="button"
                      disabled={statusDeactivatesAccount}
                      onClick={() => set('isActive', true)}
                      className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        values.isActive ? 'bg-brand-teal text-white' : 'text-slate-500 hover:bg-brand-teal-tint hover:text-brand-teal'
                      }`}
                    >
                      Đang hoạt động
                    </button>
                    <button
                      type="button"
                      onClick={() => set('isActive', false)}
                      className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                        !values.isActive ? 'bg-brand-teal text-white' : 'text-slate-500 hover:bg-brand-teal-tint hover:text-brand-teal'
                      }`}
                    >
                      Ngưng hoạt động
                    </button>
                  </div>
                </Field>
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
              {statusDeactivatesAccount && (
                <p className="mt-2 text-xs font-medium text-amber-600">
                  Trạng thái làm việc đang chọn (tab "Cấu hình và Vai trò") sẽ tự động vô hiệu hoá tài khoản khi lưu.
                </p>
              )}
            </div>
          </div>

          {/* ============ TAB 2 — CHUYÊN MÔN VÀ PHÁP LÝ ============ */}
          <div className={activeTab === 'professional' ? 'flex flex-col gap-6' : 'hidden'}>
            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Trình độ &amp; Đơn vị công tác</span>
              <div className={fieldGridClassName}>
                <Field id="ua-academic-title" label="Học hàm/học vị">
                  <Combobox
                    id="ua-academic-title"
                    value={values.academicTitleCode}
                    onChange={handleAcademicTitleChange}
                    options={academicTitleOptions}
                  />
                </Field>
                <Field id="ua-department" label="Khoa/Phòng" className="sm:col-span-2">
                  {addingDepartment ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={newDepartmentName}
                        onChange={(e) => setNewDepartmentName(e.target.value)}
                        onKeyDown={handleAddDepartmentKeyDown}
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
                <Field id="ua-displayname" label="Tên hiển thị" required className="sm:col-span-3">
                  <input
                    id="ua-displayname"
                    value={values.displayName}
                    onChange={(e) => handleDisplayNameChange(e.target.value)}
                    placeholder="Tự động ghép sau khi nhập Họ tên + Học hàm/Học vị"
                    className={inputClassName}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Tự động ghép Học vị/Học hàm + Họ tên — có thể chỉnh sửa lại. Dùng khi in đơn thuốc và mọi nơi hiển thị tên tài khoản.
                  </p>
                </Field>
              </div>
            </div>

            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Pháp lý &amp; Chữ ký</span>
              <div className={fieldGridClassName}>
                <Field id="ua-license-no" label="Số Chứng chỉ hành nghề (CCHN)">
                  <input
                    id="ua-license-no"
                    value={values.licenseNo}
                    onChange={(e) => set('licenseNo', e.target.value)}
                    placeholder="VD: 001234/BYT-CCHN"
                    className={inputClassName}
                  />
                </Field>
                <Field id="ua-license-issued-at" label="Ngày cấp CCHN">
                  <input
                    id="ua-license-issued-at"
                    type="date"
                    value={values.licenseIssuedAt}
                    onChange={(e) => set('licenseIssuedAt', e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field id="ua-license-issued-place" label="Nơi cấp CCHN">
                  <input
                    id="ua-license-issued-place"
                    value={values.licenseIssuedPlace}
                    onChange={(e) => set('licenseIssuedPlace', e.target.value)}
                    placeholder="VD: Sở Y tế TP. Hồ Chí Minh"
                    className={inputClassName}
                  />
                </Field>
                <div className="sm:col-span-3">
                  <span className={labelClassName}>Chữ ký số / Ảnh chữ ký</span>
                  <UserAccountSignatureUpload userId={item?.id} signatureUrl={item?.signatureUrl ?? null} version={item?.version} />
                </div>
              </div>
            </div>
          </div>

          {/* ============ TAB 3 — CẤU HÌNH VÀ VAI TRÒ ============ */}
          <div className={activeTab === 'config' ? 'flex flex-col gap-6' : 'hidden'}>
            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Phân quyền truy cập</span>
              <div className={fieldGridClassName}>
                <Field id="ua-roles" label="Vai trò" required className="sm:col-span-2">
                  <MultiSelectCombobox
                    id="ua-roles"
                    values={values.roleIds}
                    onChange={(ids) => set('roleIds', ids)}
                    options={(rolesQuery.data?.items ?? []).map((role) => ({ value: role.id, label: roleLabel(role.name) }))}
                    placeholder={rolesQuery.isLoading ? 'Đang tải...' : 'Chọn vai trò...'}
                  />
                </Field>
                <Field id="ua-employment-status" label="Trạng thái làm việc">
                  <Combobox
                    id="ua-employment-status"
                    value={values.employmentStatusCode}
                    onChange={(v) => set('employmentStatusCode', v)}
                    options={employmentStatusOptions}
                  />
                </Field>
              </div>

              {/* Checkbox gộp chung 1 dòng — tránh đặt cạnh ô nhập liệu (phản hồi chủ dự án
                  2026-08-20, nhìn mất cân đối khi checkbox cao bằng 1 ô Combobox trống). */}
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={values.canSignMedicalRecord} onChange={(e) => set('canSignMedicalRecord', e.target.checked)} />
                  Được ký HSBA
                </label>
              </div>
            </div>

            <div className={sectionBoxClassName}>
              <span className={sectionBadgeClassName}>Cấu hình làm việc</span>
              <div className={fieldGridClassName}>
                <Field id="ua-position" label="Chức danh nội bộ">
                  <Combobox id="ua-position" value={values.positionCode} onChange={(v) => set('positionCode', v)} options={positionOptions} />
                </Field>
                <Field id="ua-default-room" label="Phòng khám mặc định">
                  <Combobox id="ua-default-room" value={values.defaultRoomId} onChange={(v) => set('defaultRoomId', v)} options={roomOptions} />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            {mode === 'create' ? 'Tạo tài khoản' : 'Lưu thay đổi'}
          </Button>
        </div>
      </form>
    </div>
  );
}