import { useEffect, useState } from 'react';
import { CheckCircle, Lock, PencilSimple, WarningCircle, X } from '@phosphor-icons/react';
import { changePassword } from '../auth/auth.api';
import { useAuthStore } from '../auth/auth.store';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatDobDisplay } from '../../shared/format/date';
import { getInitials } from '../../shared/format/initials';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { roleLabel } from '../role/role-labels';
import { useMyProfileQuery, useUpdateMyProfileMutation } from './user-account.queries';

const SECTION_BADGE_CLASS =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const LOCKED_VALUE_CLASS = 'rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800';
const EDITABLE_VIEW_CLASS = 'rounded-md border border-slate-200 bg-white px-3 py-2 text-[15px] font-semibold text-slate-900';
const EDIT_INPUT_CLASS =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function LockedLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
      <Lock size={11} weight="bold" className="text-slate-400" aria-hidden="true" />
      {children}
    </label>
  );
}

function Field({ label, locked, children }: { label: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <div>
      {locked ? <LockedLabel>{label}</LockedLabel> : <label className="mb-1 block text-sm font-semibold text-slate-800">{label}</label>}
      {children}
    </div>
  );
}

interface ContactFormState {
  phone: string;
  email: string;
  dob: string;
  gender: '' | 'male' | 'female';
}

/**
 * Popup "Thông tin tài khoản" (menu avatar, mockup chốt trực tiếp — chưa ghi số quyết định) — mọi
 * vai trò dùng được (không riêng bác sĩ). 2 khung: "Hồ sơ & liên hệ" (đa số khoá cứng, CHỈ 4
 * trường liên hệ — SĐT/Email/Ngày sinh/Giới tính — tự sửa được qua toggle Sửa/Lưu/Huỷ, đúng Boxed
 * Section Form Pattern của `ClinicInfoPane.tsx`) và "Đổi mật khẩu" (tái dùng nguyên `POST
 * /auth/change-password` đã có từ trước — chỉ thêm ô "Xác nhận mật khẩu mới" so khớp tại chỗ ở
 * FE, không gửi lên server). Họ và tên/Tên hiển thị/Vai trò/hồ sơ nhân sự-pháp lý CỐ Ý khoá cứng —
 * dùng để ký HSBA/in đơn thuốc, vẫn do Quản trị kiểm soát qua `PATCH /users/:id`.
 */
export function MyAccountDialog({ onClose }: { onClose: () => void }) {
  const currentUser = useAuthStore((s) => s.user);
  const query = useMyProfileQuery(Boolean(currentUser));
  const updateMutation = useUpdateMyProfileMutation();

  const departmentOptionsQuery = useDepartmentOptionsQuery();
  const academicTitleQuery = useReferenceCatalogQuery('ACADEMIC_TITLE');
  const positionQuery = useReferenceCatalogQuery('STAFF_POSITION');
  const employmentStatusQuery = useReferenceCatalogQuery('EMPLOYMENT_STATUS');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactFormState>({ phone: '', email: '', dob: '', gender: '' });

  useEffect(() => {
    if (!query.data || editing) return;
    setForm({
      phone: query.data.phone ?? '',
      email: query.data.email ?? '',
      dob: query.data.dob ?? '',
      gender: query.data.gender ?? '',
    });
  }, [query.data, editing]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleCancelEdit() {
    if (query.data) {
      setForm({
        phone: query.data.phone ?? '',
        email: query.data.email ?? '',
        dob: query.data.dob ?? '',
        gender: query.data.gender ?? '',
      });
    }
    setEditing(false);
  }

  function handleSave() {
    if (!query.data) return;
    updateMutation.mutate(
      {
        phone: form.phone.trim() === '' ? null : form.phone.trim(),
        email: form.email.trim() === '' ? null : form.email.trim(),
        dob: form.dob === '' ? null : form.dob,
        gender: form.gender === '' ? null : form.gender,
        version: query.data.version,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Không đổi được mật khẩu, vui lòng thử lại.');
    } finally {
      setPwSubmitting(false);
    }
  }

  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword && newPassword.length >= 8;
  const canSubmitPassword = currentPassword.length > 0 && newPassword.length >= 8 && passwordsMatch;

  const departmentName = departmentOptionsQuery.data?.items.find((d) => d.id === query.data?.departmentId)?.name ?? null;
  const academicTitleName = academicTitleQuery.data?.items.find((i) => i.code === query.data?.academicTitleCode)?.name ?? null;
  const positionName = positionQuery.data?.items.find((i) => i.code === query.data?.positionCode)?.name ?? null;
  const employmentStatusName = employmentStatusQuery.data?.items.find((i) => i.code === query.data?.employmentStatusCode)?.name ?? null;

  if (!currentUser) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="my-account-title">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header — avatar + tên + dòng meta (username/vai trò/khoa phòng/trạng thái) gộp 1 khối, không lặp lại. */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[15px] font-bold text-blue-600">
              {getInitials(currentUser.displayName ?? currentUser.fullName)}
            </div>
            <div className="min-w-0">
              <h2 id="my-account-title" className="truncate text-lg font-extrabold text-slate-900">
                {currentUser.displayName ?? currentUser.fullName}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
                <span className="font-mono">{currentUser.username}</span>
                {currentUser.roles.map((r) => (
                  <span key={r} className="flex items-center gap-1.5 before:content-['·'] before:text-slate-300">
                    {roleLabel(r)}
                  </span>
                ))}
                {departmentName && <span className="flex items-center gap-1.5 before:content-['·'] before:text-slate-300">{departmentName}</span>}
                {query.data && (
                  <span
                    className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
                      query.data.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${query.data.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {query.data.isActive ? 'Đang hoạt động' : 'Ngưng hoạt động'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
          >
            <X size={15} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 scroll-hover">
          {query.isError && <ErrorBanner message="Không tải được thông tin tài khoản." onRetry={() => query.refetch()} />}

          {query.isLoading || !query.data ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="relative rounded-lg border border-slate-200 p-6 pt-8">
                <span className={SECTION_BADGE_CLASS}>Thông tin cá nhân</span>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Trường có <Lock size={10} weight="bold" className="inline text-slate-400" aria-hidden="true" /> chỉ Quản trị sửa được — liên hệ Quản
                    trị viên nếu cần đính chính.
                  </p>
                  {!editing && (
                    <Button type="button" variant="secondary" className="flex-shrink-0" onClick={() => setEditing(true)}>
                      <PencilSimple size={14} weight="regular" aria-hidden="true" />
                      Sửa thông tin liên hệ
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-3">
                  <Field label="Họ và tên" locked>
                    <p className={LOCKED_VALUE_CLASS}>{query.data.fullName}</p>
                  </Field>
                  <Field label="Tên đăng nhập" locked>
                    <p className={`${LOCKED_VALUE_CLASS} font-mono`}>{query.data.username}</p>
                  </Field>
                  <Field label="Mã nhân viên" locked>
                    <p className={`${LOCKED_VALUE_CLASS} font-mono`}>{query.data.employeeCode ?? '—'}</p>
                  </Field>

                  <Field label="Học hàm/học vị" locked>
                    <p className={LOCKED_VALUE_CLASS}>{academicTitleName ?? '—'}</p>
                  </Field>
                  <Field label="Chức danh nội bộ" locked>
                    <p className={LOCKED_VALUE_CLASS}>{positionName ?? '—'}</p>
                  </Field>
                  <Field label="Khoa/Phòng" locked>
                    <p className={LOCKED_VALUE_CLASS}>{departmentName ?? '—'}</p>
                  </Field>

                  <Field label="Số điện thoại">
                    {editing ? (
                      <input
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        placeholder="VD: 0912 345 678"
                        className={EDIT_INPUT_CLASS}
                      />
                    ) : (
                      <p className={EDITABLE_VIEW_CLASS}>{query.data.phone || '—'}</p>
                    )}
                  </Field>
                  <Field label="Email">
                    {editing ? (
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="VD: ban.than@phongkham.vn"
                        className={EDIT_INPUT_CLASS}
                      />
                    ) : (
                      <p className={EDITABLE_VIEW_CLASS}>{query.data.email || '—'}</p>
                    )}
                  </Field>
                  <Field label="Ngày sinh">
                    {editing ? (
                      <input
                        type="date"
                        value={form.dob}
                        onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                        className={EDIT_INPUT_CLASS}
                      />
                    ) : (
                      <p className={EDITABLE_VIEW_CLASS}>{query.data.dob ? formatDobDisplay(query.data.dob) : '—'}</p>
                    )}
                  </Field>

                  <Field label="Giới tính">
                    {editing ? (
                      <div className="flex h-[42px] items-center gap-5">
                        <label className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            className="round-checkbox"
                            checked={form.gender === 'male'}
                            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.checked ? 'male' : '' }))}
                          />
                          Nam
                        </label>
                        <label className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            className="round-checkbox"
                            checked={form.gender === 'female'}
                            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.checked ? 'female' : '' }))}
                          />
                          Nữ
                        </label>
                      </div>
                    ) : (
                      <p className={EDITABLE_VIEW_CLASS}>{query.data.gender === 'male' ? 'Nam' : query.data.gender === 'female' ? 'Nữ' : '—'}</p>
                    )}
                  </Field>
                  <Field label="Vai trò" locked>
                    <p className={LOCKED_VALUE_CLASS}>{query.data.roleNames.map(roleLabel).join(', ') || '—'}</p>
                  </Field>
                  <Field label="Trạng thái làm việc" locked>
                    <p className={LOCKED_VALUE_CLASS}>{employmentStatusName ?? '—'}</p>
                  </Field>
                </div>

                {editing && (
                  <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <Button type="button" variant="secondary" onClick={handleCancelEdit} disabled={updateMutation.isPending}>
                      Huỷ
                    </Button>
                    <Button type="button" loading={updateMutation.isPending} onClick={handleSave}>
                      Lưu thay đổi
                    </Button>
                  </div>
                )}
                {updateMutation.isError && (
                  <div className="mt-3">
                    <ErrorBanner message={updateMutation.error instanceof ApiError ? updateMutation.error.message : 'Không lưu được, thử lại.'} />
                  </div>
                )}
              </div>

              <form onSubmit={(e) => void handleChangePassword(e)} className="relative rounded-lg border border-slate-200 p-6 pt-8">
                <span className={SECTION_BADGE_CLASS}>Bảo mật</span>
                <p className="mb-4 text-xs text-slate-500">Cần đúng mật khẩu hiện tại. Đổi xong, mọi phiên đăng nhập khác bị đăng xuất.</p>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="my-account-current-password" className="mb-1 block text-sm font-semibold text-slate-800">
                      Mật khẩu hiện tại <span className="text-rose-500">*</span>
                    </label>
                    <PasswordInput
                      id="my-account-current-password"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="my-account-new-password" className="mb-1 block text-sm font-semibold text-slate-800">
                      Mật khẩu mới <span className="text-rose-500">*</span>
                    </label>
                    <PasswordInput
                      id="my-account-new-password"
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                      placeholder="Tối thiểu 8 ký tự"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="my-account-confirm-password" className="mb-1 block text-sm font-semibold text-slate-800">
                      Xác nhận mật khẩu mới <span className="text-rose-500">*</span>
                    </label>
                    <PasswordInput
                      id="my-account-confirm-password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>

                {newPassword.length > 0 && newPassword.length < 8 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                    <WarningCircle size={13} weight="fill" aria-hidden="true" />
                    Mật khẩu mới cần tối thiểu 8 ký tự.
                  </p>
                )}
                {passwordsMismatch && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                    <WarningCircle size={13} weight="fill" aria-hidden="true" />
                    Mật khẩu xác nhận không khớp.
                  </p>
                )}
                {passwordsMatch && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                    <CheckCircle size={13} weight="fill" aria-hidden="true" />
                    Mật khẩu xác nhận khớp.
                  </p>
                )}
                {pwError && <p className="mt-2 text-xs font-semibold text-rose-600">{pwError}</p>}
                {pwSuccess && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                    <CheckCircle size={13} weight="fill" aria-hidden="true" />
                    Đã đổi mật khẩu thành công.
                  </p>
                )}

                <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
                  <Button type="submit" loading={pwSubmitting} disabled={!canSubmitPassword}>
                    Đổi mật khẩu
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}