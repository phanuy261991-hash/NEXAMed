import type { ReactNode } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { ReleaseEntry, ReleaseNotes as ReleaseNotesData, SoftwareUpdateStatus } from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { RELEASE_CHANNEL_LABELS } from '../../shared/version/app-version';
import { formatHistoryResult } from './software-update-view';
import { ReleaseNoteGroups, countReleaseNoteLines } from './ReleaseNoteGroups';
import { useCheckSoftwareUpdateMutation, useSoftwareUpdateStatusQuery } from './software-update.queries';
import { formatReleaseDate } from './support-info';
import { useSystemVersionQuery } from './system.queries';

const CHANNEL_TONE = { stable: 'info', beta: 'warning', dev: 'neutral' } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function ReleaseNotes({ entry }: { entry: ReleaseEntry }) {
  return <ReleaseNoteGroups notes={entry.notes} />;
}

/**
 * "Có gì mới trong bản đang chạy" (mockup https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026; chủ dự án CHỐT chỉ hiện bản đang chạy, KHÔNG hiện "Các bản trước"): hiện `notes` của `GET /system/version`
 * (ghi chú ĐÓNG KÈM phần mềm) nên hiện ngay cả khi chưa có máy chủ phát hành. Bản chưa có ghi chú thì ẩn cả khối. Không tự tải dữ liệu: thẻ "Cập nhật phần mềm" chỉ hiện sau khi `/system/version` đã tải xong
 * (xem `useSoftwareUpdateVisible`), nên không có trạng thái đang tải/lỗi riêng cho khối này; `/system/version` lỗi thì cả thẻ ẩn theo.
 */
function BundledReleaseNotes({ currentVersion, notes: current }: { currentVersion: string; notes: ReleaseNotesData | null }) {
  if (current === null || countReleaseNoteLines(current) === 0) return null;
  return (
    <BoxedSection badge={`Có gì mới trong bản ${currentVersion}`}>
      <ReleaseNoteGroups notes={current} />
    </BoxedSection>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
      <Warning size={16} weight="fill" aria-hidden="true" className="mt-0.5 flex-none" />
      <span>{children}</span>
    </div>
  );
}

/** Khối kết quả theo `status.state` — mỗi trạng thái một khối riêng, đúng mockup đã duyệt (#236). */
function ResultBlock({ status, checking, onCheck }: { status: SoftwareUpdateStatus; checking: boolean; onCheck: () => void }) {
  const lastChecked = status.lastCheckedAt ? <p className="text-sm font-medium text-slate-500">Kiểm tra lần cuối: {formatDateTimeVn(status.lastCheckedAt)}</p> : null;

  if (status.state === 'not_configured') {
    return (
      <BoxedSection badge="Máy chủ phát hành">
        <div className="space-y-3">
          <p className="text-base font-semibold text-slate-900">Chưa cấu hình máy chủ phát hành</p>
          <p className="max-w-3xl text-sm font-medium text-slate-600">
            Địa chỉ máy chủ phát hành do nhà cung cấp cấu hình khi bàn giao, không nhập được trên giao diện này. Hiện bản cài đặt của bạn chưa được cấu hình; cập nhật bằng gói cài đặt như hiện nay.
          </p>
          <Button type="button" variant="secondary" disabled>
            Kiểm tra cập nhật
          </Button>
        </div>
      </BoxedSection>
    );
  }

  if (status.state === 'error') {
    return (
      <BoxedSection badge="Kết quả kiểm tra">
        <div className="space-y-3">
          <ErrorBanner message={`${status.errorMessage ?? 'Không kiểm tra được bản mới.'} Kiểm tra kết nối mạng của máy chủ rồi thử lại.`} />
          {lastChecked}
          <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
            Thử lại
          </Button>
        </div>
      </BoxedSection>
    );
  }

  if (status.state === 'update_available' && status.latest) {
    const { latest } = status;
    return (
      <BoxedSection badge="Có phiên bản mới">
        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-slate-500">Phiên bản mới</dt>
              <dd className="text-3xl font-semibold tabular-nums text-slate-900">{latest.version}</dd>
            </div>
            <Field label="Ngày phát hành">{formatReleaseDate(latest.releasedAt)}</Field>
            <Field label="Loại cập nhật">{latest.requiresMigration ? <StatusBadge tone="warning">Có thay đổi cơ sở dữ liệu</StatusBadge> : <StatusBadge tone="neutral">Không đổi cơ sở dữ liệu</StatusBadge>}</Field>
          </dl>
          <ReleaseNotes entry={latest} />
          {status.needsIntermediateVersion && latest.minimumFromVersion && (
            <Notice>Phiên bản đang chạy ({status.currentVersion}) quá cũ để nâng thẳng lên bản này. Cần cập nhật lên bản {latest.minimumFromVersion} trước.</Notice>
          )}
          <Notice>Cập nhật tự động chưa được hỗ trợ ở phiên bản này. Để cập nhật, cài gói mới theo hướng dẫn của nhà cung cấp; nên sao lưu trước.</Notice>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled title="Chưa hỗ trợ cập nhật tự động">
              Cập nhật ngay
            </Button>
            <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
              Kiểm tra lại
            </Button>
          </div>
          {lastChecked}
        </div>
      </BoxedSection>
    );
  }

  return (
    <BoxedSection badge="Kết quả kiểm tra">
      <div className="space-y-3">
        {status.state === 'up_to_date' ? (
          <p className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
            <StatusBadge tone="success">Mới nhất</StatusBadge>
            Bạn đang dùng phiên bản mới nhất của kênh {RELEASE_CHANNEL_LABELS[status.channel]}.
          </p>
        ) : (
          <p className="text-base font-semibold text-slate-900">Chưa kiểm tra lần nào kể từ khi máy chủ khởi động.</p>
        )}
        {lastChecked}
        <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
          Kiểm tra cập nhật
        </Button>
      </div>
    </BoxedSection>
  );
}

function HistoryTable({ history }: { history: SoftwareUpdateStatus['history'] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">Lịch sử kiểm tra gần đây</h3>
      {history.length === 0 ? (
        <p className="px-4 py-4 text-sm font-medium text-slate-500">Chưa có lần kiểm tra nào.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b-2 border-blue-600 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-700">Thời gian</th>
              <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-700">Người thực hiện</th>
              <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-700">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.map((item) => (
              <tr key={item.at}>
                <td className="px-3 py-2 text-center font-medium tabular-nums text-slate-900">{formatDateTimeVn(item.at)}</td>
                <td className="px-3 py-2 text-left font-medium text-slate-900">{item.byName ?? '—'}</td>
                <td className="px-3 py-2 text-center font-medium text-slate-900">{formatHistoryResult(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * "Cấu hình hệ thống → Cập nhật phần mềm" (docs/DECISIONS.md #236, bước 2, mockup đã duyệt): phiên bản hiện tại + kết quả kiểm tra bản mới + lịch sử kiểm tra.
 * Chỉ KIỂM TRA và HIỂN THỊ — nút "Cập nhật ngay" tắt cho tới khi có bộ cập nhật thật. Kênh Ổn định/Thử nghiệm và địa chỉ máy chủ phát hành do nhà cung cấp đặt, ở đây chỉ xem.
 * Pill chỉ hiện ở `ClinicConfigPage.tsx` khi tài khoản có `software_update.read` và hệ thống chạy một công ty (không phải SaaS).
 */
export function SoftwareUpdatePane() {
  const query = useSoftwareUpdateStatusQuery(true);
  const versionQuery = useSystemVersionQuery();
  const checkMutation = useCheckSoftwareUpdateMutation();

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorBanner message="Không tải được trạng thái cập nhật phần mềm." onRetry={() => void query.refetch()} />;

  const status = query.data;
  const releasedAt = versionQuery.data?.releasedAt ?? null;
  const check = () => checkMutation.mutate();

  return (
    <div className="space-y-6">
      <BoxedSection badge="Phiên bản hiện tại">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-slate-500">Phiên bản</dt>
            <dd className="text-3xl font-semibold tabular-nums text-slate-900">{status.currentVersion}</dd>
          </div>
          <Field label="Kênh theo dõi">
            <StatusBadge tone={CHANNEL_TONE[versionQuery.data?.channel ?? 'stable']}>{RELEASE_CHANNEL_LABELS[versionQuery.data?.channel ?? status.channel]}</StatusBadge>
          </Field>
          <Field label="Ngày phát hành">{formatReleaseDate(releasedAt)}</Field>
          {status.configured && status.releaseServerUrl && (
            <div className="sm:col-span-3">
              <dt className="text-sm font-medium text-slate-500">Máy chủ phát hành (do nhà cung cấp cấu hình, không sửa được)</dt>
              <dd className="break-all text-base font-semibold text-slate-900">{status.releaseServerUrl}</dd>
            </div>
          )}
        </dl>
      </BoxedSection>

      <BundledReleaseNotes currentVersion={status.currentVersion} notes={versionQuery.data?.notes ?? null} />

      <ResultBlock status={status} checking={checkMutation.isPending} onCheck={check} />
      {checkMutation.isError && <ErrorBanner message="Không gửi được yêu cầu kiểm tra. Thử lại." />}

      <HistoryTable history={status.history} />
    </div>
  );
}
