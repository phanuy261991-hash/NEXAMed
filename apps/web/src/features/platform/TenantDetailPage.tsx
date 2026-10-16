import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Buildings, Clock, Users } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PlatformTenantDetail, ResetTenantAdminPasswordResponse } from '@nexamed/shared';
import { copyText } from '../../shared/format/clipboard';
import { formatDateTimeVn } from '../../shared/format/time';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { EditIconButton } from '../../shared/ui/EditIconButton';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Textarea } from '../../shared/ui/Textarea';
import { AuditTable } from './AuditTable';
import { PlatformApiError } from './platform.api';
import { formatDateVn, loginHostOf } from './platform-format';
import { useAuditLogsQuery, useResetAdminPasswordMutation, useSuspendTenantMutation, useTenantQuery, useUnsuspendTenantMutation, useUpdateTenantMutation } from './platform.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';

function Info({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/** "Thông tin vận hành": xem + sửa tại chỗ (liên hệ + ghi chú nội bộ). Mã công ty/tên miền phụ KHÔNG sửa được. */
function OperationsInfo({ tenant }: { tenant: PlatformTenantDetail }) {
  const mutation = useUpdateTenantMutation(tenant.id);
  const [editing, setEditing] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [operatorNote, setOperatorNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setContactName(tenant.contactName ?? '');
    setContactPhone(tenant.contactPhone ?? '');
    setContactEmail(tenant.contactEmail ?? '');
    setOperatorNote(tenant.operatorNote ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contactName.trim() || !contactPhone.trim() || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        version: tenant.version,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim() || undefined,
        operatorNote: operatorNote.trim() || undefined,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Không lưu được. Thử lại.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="relative">
      <BoxedSection badge="Thông tin vận hành">
        {!editing && (
          <div className="absolute -top-4 right-4 bg-white">
            <EditIconButton onClick={startEditing} />
          </div>
        )}
        {editing ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
            <div>
              <label htmlFor="e-contact" className="mb-1 block text-sm font-semibold text-slate-800">
                Người liên hệ <span className="text-rose-500">*</span>
              </label>
              <input id="e-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClassName} autoFocus />
            </div>
            <div>
              <label htmlFor="e-phone" className="mb-1 block text-sm font-semibold text-slate-800">
                Số điện thoại <span className="text-rose-500">*</span>
              </label>
              <input id="e-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="e-mail" className="mb-1 block text-sm font-semibold text-slate-800">
                Email
              </label>
              <input id="e-mail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClassName} />
            </div>
            <div className="md:col-span-3">
              <Textarea id="e-note" label="Ghi chú nội bộ" value={operatorNote} onChange={(e) => setOperatorNote(e.target.value)} rows={3} />
            </div>
            {error && (
              <div className="md:col-span-3">
                <ErrorBanner message={error} />
              </div>
            )}
            <div className="flex justify-end gap-2 md:col-span-3">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={mutation.isPending}>
                Huỷ
              </Button>
              <Button type="submit" loading={mutation.isPending} disabled={!contactName.trim() || !contactPhone.trim()}>
                Lưu
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
            <Info label="Người liên hệ">{tenant.contactName ?? '—'}</Info>
            <Info label="Số điện thoại">{tenant.contactPhone ?? '—'}</Info>
            <Info label="Email">{tenant.contactEmail ?? '—'}</Info>
            <Info label="Ngày bắt đầu">{formatDateVn(tenant.createdAt)}</Info>
            <Info label="Ghi chú nội bộ" className="md:col-span-2">
              {tenant.operatorNote ?? '—'}
            </Info>
          </dl>
        )}
      </BoxedSection>
    </form>
  );
}

/** Đặt lại mật khẩu của tài khoản quản trị đầu tiên của công ty: xác nhận → hiện mật khẩu tạm MỘT lần kèm nút sao chép. */
function ResetAdminPasswordDialog({ tenant, onClose }: { tenant: PlatformTenantDetail; onClose: () => void }) {
  const mutation = useResetAdminPasswordMutation(tenant.id);
  const [result, setResult] = useState<ResetTenantAdminPasswordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setResult(await mutation.mutateAsync());
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Không đặt lại được mật khẩu. Thử lại.');
    }
  }

  async function handleCopy() {
    if (!result) return;
    const ok = await copyText(`Địa chỉ đăng nhập: ${tenant.loginUrl ?? ''}\nTên đăng nhập: ${result.adminUsername}\nMật khẩu tạm: ${result.temporaryPassword}`);
    setCopied(ok ? 'ok' : 'failed');
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <form onSubmit={handleConfirm} className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="reset-title" className="text-base font-semibold text-slate-900">
          Đặt lại mật khẩu quản trị của "{tenant.name}"?
        </h2>
        {result ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Đã đặt lại mật khẩu cho <span className="font-semibold">{result.adminFullName}</span> ({result.adminUsername}). Mật khẩu chỉ hiện một lần; người dùng bị buộc đổi ở lần đăng nhập đầu, mọi phiên cũ đã bị đăng xuất.
            </p>
            <p className="rounded-md border border-emerald-500 bg-emerald-50 px-3 py-2 text-lg font-semibold tracking-wide text-slate-900">{result.temporaryPassword}</p>
            <div className="flex items-center justify-between gap-2">
              <span role="status" aria-live="polite" className={`text-sm font-semibold ${copied === 'failed' ? 'text-rose-700' : 'text-emerald-700'}`}>
                {copied === 'ok' ? 'Đã sao chép' : copied === 'failed' ? 'Không sao chép được' : ''}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                  Sao chép
                </Button>
                <Button type="button" onClick={onClose}>
                  Đóng
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm font-medium text-slate-600">
              Hệ thống đặt mật khẩu tạm mới cho tài khoản quản trị đầu tiên của công ty và đăng xuất các phiên cũ của tài khoản đó. Công ty tự thao tác phần còn lại.
            </p>
            {error && (
              <div className="mt-3">
                <ErrorBanner message={error} />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
                Huỷ
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                Đặt lại mật khẩu
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** Chi tiết một công ty khách hàng (docs/DECISIONS.md #237): trạng thái + khoá/mở khoá (bắt buộc lý do), thông tin vận hành, số đếm, đặt lại mật khẩu quản trị, nhật ký của công ty này. */
export function TenantDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useTenantQuery(id);
  const auditQuery = useAuditLogsQuery(id);
  const suspend = useSuspendTenantMutation(id);
  const unsuspend = useUnsuspendTenantMutation(id);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [unsuspendError, setUnsuspendError] = useState<string | null>(null);

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    const notFound = query.error instanceof PlatformApiError && query.error.status === 404;
    return (
      <div className="space-y-3">
        <ErrorBanner message={notFound ? 'Không tìm thấy công ty này.' : 'Không tải được thông tin công ty.'} onRetry={notFound ? undefined : () => void query.refetch()} />
        <Button type="button" variant="secondary" onClick={() => navigate('/')}>
          Về danh sách
        </Button>
      </div>
    );
  }

  const tenant = query.data;
  const active = tenant.status === 'active';

  async function handleUnsuspend() {
    setUnsuspendError(null);
    try {
      await unsuspend.mutateAsync(tenant.version);
    } catch (err) {
      setUnsuspendError(err instanceof PlatformApiError ? err.message : 'Không mở khoá được. Thử lại.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{tenant.name}</h1>
          <p className="text-sm font-medium text-slate-500">
            Mã: <span className="font-semibold text-slate-800">{tenant.code ?? '—'}</span> · {loginHostOf(tenant.loginUrl) ?? 'chưa có tên miền phụ'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={active ? 'success' : 'neutral'}>{active ? 'Đang hoạt động' : 'Tạm ngưng'}</StatusBadge>
          {active ? (
            <Button type="button" variant="danger" onClick={() => setSuspendOpen(true)}>
              Khoá công ty
            </Button>
          ) : (
            <Button type="button" loading={unsuspend.isPending} onClick={() => void handleUnsuspend()}>
              Mở khoá công ty
            </Button>
          )}
        </div>
      </div>

      {!active && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          Công ty đang tạm ngưng: người dùng không đăng nhập được. Dữ liệu vẫn được giữ nguyên, mở khoá là dùng lại ngay.
          {tenant.suspendedReason && <span className="font-medium"> Lý do: {tenant.suspendedReason}{tenant.suspendedByName ? ` (${tenant.suspendedByName}, ${tenant.suspendedAt ? formatDateTimeVn(tenant.suspendedAt) : ''})` : ''}.</span>}
        </p>
      )}
      {unsuspendError && <ErrorBanner message={unsuspendError} />}

      <OperationsInfo tenant={tenant} />

      <StatCardRow
        items={[
          { icon: Users, tone: 'slate', label: 'Tài khoản đang hoạt động', value: String(tenant.activeUserCount) },
          { icon: Buildings, tone: 'slate', label: 'Chi nhánh', value: String(tenant.branchCount) },
          { icon: Clock, tone: 'blue', label: 'Đăng nhập gần nhất', value: tenant.lastLoginAt ? formatDateTimeVn(tenant.lastLoginAt) : '—' },
        ]}
      />
      <p className="text-xs font-medium text-slate-500">Khu này không hiển thị bệnh nhân, hồ sơ hay số liệu doanh thu của công ty, chỉ có số đếm vận hành.</p>

      <div>
        <Button type="button" variant="secondary" onClick={() => setResetOpen(true)}>
          Đặt lại mật khẩu quản trị của công ty
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">Nhật ký vận hành của công ty này</h3>
        {auditQuery.isPending ? <Skeleton className="m-4 h-16" /> : auditQuery.isError ? <p className="px-4 py-4 text-sm font-medium text-rose-600">Không tải được nhật ký.</p> : <AuditTable items={auditQuery.data.items} showTenant={false} />}
      </div>

      {suspendOpen && (
        <ReasonConfirmDialog
          title="Khoá công ty"
          rows={[{ label: 'Công ty', value: tenant.name }]}
          note="Mọi người dùng bị đăng xuất ngay. Dữ liệu giữ nguyên."
          confirmLabel="Khoá công ty"
          confirmVariant="danger"
          onConfirm={(reason) => suspend.mutateAsync({ version: tenant.version, reason: reason.trim() })}
          onDone={() => setSuspendOpen(false)}
          onClose={() => setSuspendOpen(false)}
        />
      )}
      {resetOpen && <ResetAdminPasswordDialog tenant={tenant} onClose={() => setResetOpen(false)} />}
    </div>
  );
}
