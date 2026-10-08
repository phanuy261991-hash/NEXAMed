import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import type { BackupConfigResponse } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EditIconButton } from '../../shared/ui/EditIconButton';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useHasPermission } from '../auth/usePermission';
import { useBackupConfigQuery, useRunBackupNowMutation, useUpdateBackupConfigMutation } from './clinic.queries';

const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const valueChipClassName = 'rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-base font-bold text-blue-700';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const label = `${String(h).padStart(2, '0')}:00`;
  return { value: String(h), label };
});

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

function isValidRetention(text: string): boolean {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= MIN_RETENTION_DAYS && n <= MAX_RETENTION_DAYS;
}

const ALERT_REASON_TEXT: Record<string, string> = {
  NEVER_RUN: 'Chưa từng sao lưu thành công lần nào. Kiểm tra lại cấu hình sao lưu tự động.',
  LAST_RUN_FAILED: 'Kiểm tra lại hạ tầng sao lưu (thư mục đích, dung lượng ổ đĩa, dịch vụ backup).',
  STALE: 'Đã quá lâu chưa có bản sao lưu thành công. Kiểm tra lại lịch sao lưu.',
};

function ConfigRow({ title, description, children, divider = true }: { title: string; description?: ReactNode; children: ReactNode; divider?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-5 ${divider ? 'border-t border-slate-100 pt-4' : ''}`}>
      <div>
        <p className="text-[14.5px] font-bold text-slate-900">{title}</p>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">{description}</p>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function StatusBlock({ data, canManage }: { data: BackupConfigResponse; canManage: boolean }) {
  const runMutation = useRunBackupNowMutation();
  const { status } = data;
  const waiting = data.runRequestedAt !== null;

  let badge: ReactNode;
  let detail: string;
  if (status.lastRunOk === false) {
    badge = <StatusBadge tone="danger">Lỗi</StatusBadge>;
    detail = status.lastError ? `Lần chạy gần nhất thất bại: ${status.lastError}` : 'Lần chạy gần nhất thất bại.';
  } else if (status.lastSuccessAt) {
    badge = <StatusBadge tone="success">Thành công</StatusBadge>;
    detail = `Thành công lúc ${formatDateTimeVn(status.lastSuccessAt)}`;
  } else {
    badge = <StatusBadge tone="neutral">Chưa có lần nào</StatusBadge>;
    detail = 'Chưa có bản sao lưu nào được ghi nhận.';
  }

  return (
    <div className={sectionBoxClassName}>
      <span className={sectionBadgeClassName}>Trạng thái</span>

      <div className="flex items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2.5">
            {badge}
            <p className="text-[14.5px] font-bold text-slate-900">{detail}</p>
          </div>
          {status.lastRunOk === false && status.lastSuccessAt && (
            <p className="mt-1.5 text-[13px] text-slate-500">Lần thành công gần nhất: {formatDateTimeVn(status.lastSuccessAt)}</p>
          )}
          {waiting && (
            <p role="status" className="mt-1.5 text-[13px] font-semibold text-slate-700">
              Đã gửi yêu cầu — chạy trong vài chục giây.
            </p>
          )}
        </div>
        {canManage && (
          <Button type="button" variant="secondary" loading={runMutation.isPending} disabled={waiting} onClick={() => runMutation.mutate()}>
            Sao lưu ngay
          </Button>
        )}
      </div>

      {status.needsAttention && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          <Warning size={16} weight="fill" aria-hidden="true" className="flex-none" />
          {status.reason ? ALERT_REASON_TEXT[status.reason] : 'Sao lưu đang cần được kiểm tra.'}
        </div>
      )}
      {runMutation.isError && <div className="mt-3"><ErrorBanner message="Không gửi được yêu cầu sao lưu. Thử lại." /></div>}
    </div>
  );
}

/**
 * "Cấu hình hệ thống → Sao lưu dữ liệu" (docs/DECISIONS.md #217) — bố cục đã duyệt: khối "Trạng thái" (lần
 * sao lưu gần nhất + "Sao lưu ngay") và khối "Cấu hình" (bật/tắt, giờ chạy theo giờ Việt Nam, số ngày giữ,
 * thư mục đích chỉ đọc). Sửa/Lưu/Huỷ tường minh, PUT cả 3 trường cùng lúc. Chỉ có `system_backup.read` thì
 * chỉ xem. Pill chỉ hiện ở `ClinicConfigPage.tsx` khi máy có container sao lưu (`available=true`).
 */
export function BackupConfigPane() {
  const canManage = useHasPermission('system_backup', 'manage');
  const query = useBackupConfigQuery(true);
  const mutation = useUpdateBackupConfigMutation();
  const { flashVisible, triggerFlash } = useSaveFlash(3000);

  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [hourVn, setHourVn] = useState('2');
  const [retentionDays, setRetentionDays] = useState('14');

  function resetDraft(data: BackupConfigResponse) {
    setEnabled(data.config.enabled);
    setHourVn(String(data.config.hourVn));
    setRetentionDays(String(data.config.retentionDays));
  }

  // Đang sửa dở thì KHÔNG ghi đè bản nháp khi trạng thái tự làm mới (polling lúc "Sao lưu ngay").
  useEffect(() => {
    if (query.data && !editing) resetDraft(query.data);
  }, [query.data, editing]);

  if (query.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (query.isError) {
    return <ErrorBanner message="Không tải được cấu hình sao lưu." onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  const invalid = editing && !isValidRetention(retentionDays);

  function handleCancel() {
    resetDraft(data);
    setEditing(false);
    mutation.reset();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !isValidRetention(retentionDays) || mutation.isPending) return;
    mutation.mutate(
      { enabled, hourVn: Number(hourVn), retentionDays: Number(retentionDays) },
      {
        onSuccess: () => {
          setEditing(false);
          triggerFlash();
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <StatusBlock data={data} canManage={canManage} />

      <form onSubmit={handleSubmit} className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Cấu hình</span>

        {canManage && !editing && (
          <div className="absolute -top-4 right-4 bg-white">
            <EditIconButton onClick={() => setEditing(true)} />
          </div>
        )}

        <div className="space-y-4">
          <ConfigRow
            divider={false}
            title="Tự động sao lưu hằng ngày"
            description="Tắt thì chỉ còn nút “Sao lưu ngay”; cảnh báo vẫn hiện nếu quá lâu chưa có bản sao lưu thành công."
          >
            {editing ? (
              <label className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={enabled}
                  disabled={mutation.isPending}
                  onChange={(e) => setEnabled(e.target.checked)}
                  aria-label="Tự động sao lưu hằng ngày"
                />
                <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-teal peer-disabled:opacity-60" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </label>
            ) : (
              <StatusBadge tone={data.config.enabled ? 'success' : 'neutral'}>{data.config.enabled ? 'Đang bật' : 'Đang tắt'}</StatusBadge>
            )}
          </ConfigRow>

          <ConfigRow title="Giờ chạy (giờ Việt Nam)" description="Hệ thống tự quy đổi sang giờ của máy chủ; áp dụng cho lần chạy kế tiếp, không cần khởi động lại.">
            {editing ? (
              <div className="w-32">
                <Combobox id="backup-hour-vn" value={hourVn} options={HOUR_OPTIONS} onChange={setHourVn} disabled={mutation.isPending} />
              </div>
            ) : (
              <span className={valueChipClassName}>{HOUR_OPTIONS[data.config.hourVn]?.label}</span>
            )}
          </ConfigRow>

          <ConfigRow
            title="Số ngày giữ bản sao lưu"
            description="Bản sao lưu cơ sở dữ liệu cũ hơn số ngày này sẽ tự xoá. Ảnh đính kèm cũng được sao lưu cùng lịch này (không nén, không dọn theo số ngày giữ)."
          >
            {editing ? (
              <>
                <input
                  id="backup-retention-days"
                  type="number"
                  min={MIN_RETENTION_DAYS}
                  max={MAX_RETENTION_DAYS}
                  value={retentionDays}
                  disabled={mutation.isPending}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  aria-label="Số ngày giữ bản sao lưu"
                  className="w-20 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="text-sm text-slate-500">ngày</span>
              </>
            ) : (
              <span className={valueChipClassName}>{data.config.retentionDays} ngày</span>
            )}
          </ConfigRow>

          <ConfigRow
            title="Thư mục lưu bản sao"
            description={
              <>
                Chỉ xem. Muốn đổi thư mục: sửa <span className="font-semibold text-slate-800">BACKUP_HOST_DIR</span> trong file <span className="font-semibold text-slate-800">.env</span> rồi chạy{' '}
                <span className="font-semibold text-slate-800">docker compose restart backup</span>.
              </>
            }
          >
            <span className="max-w-sm break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800">
              {data.destinationDir ?? 'Chưa xác định'}
            </span>
          </ConfigRow>
        </div>

        {editing && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={mutation.isPending}>
              Huỷ
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={invalid}>
              Lưu
            </Button>
          </div>
        )}

        {mutation.isError && (
          <div className="mt-3">
            <ErrorBanner message="Không lưu được cấu hình sao lưu. Thử lại." />
          </div>
        )}
      </form>

      {flashVisible && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu cấu hình sao lưu.
        </div>
      )}
    </div>
  );
}
