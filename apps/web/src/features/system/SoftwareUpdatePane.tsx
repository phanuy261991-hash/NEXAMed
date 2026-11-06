import type { ReactNode } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { ReleaseNotes as ReleaseNotesData, SoftwareUpdateStatus, SystemVersion } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SectionCard } from '../../shared/ui/SectionCard';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { COPYRIGHT_INFO, formatCopyrightLine, listSupportContacts } from '../../shared/version/copyright-info';
import { DEPLOYMENT_MODE_LABELS, RELEASE_CHANNEL_LABELS } from '../../shared/version/app-version';
import { formatHistoryResult } from './software-update-view';
import { ReleaseNoteGroups, countReleaseNoteLines } from './ReleaseNoteGroups';
import { useCheckSoftwareUpdateMutation, useSoftwareUpdateStatusQuery } from './software-update.queries';
import { formatReleaseDate } from './support-info';
import { useSystemVersionQuery } from './system.queries';
import { useCopySupportInfo } from './use-copy-support-info';

const CHANNEL_TONE = { stable: 'info', beta: 'warning', dev: 'neutral' } as const;

/** Một dòng `nhãn | giá trị` có đường kẻ mảnh (cùng kiểu dòng thông tin của `ConfirmDialog`). */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 text-sm last:border-b-0">
      <dt className="flex-none text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * Thẻ thương hiệu bên trái (mockup chủ dự án chốt 06/11/2026): logo, tên sản phẩm, phiên bản đang chạy, ngày phát hành/chế độ triển khai/số bản dựng, rồi khối "Bản quyền" (dòng bản quyền,
 * "Cấp phép cho" tên phòng khám, thông tin hỗ trợ). Dòng liên hệ nào chưa có thông tin thì ẩn (`shared/version/copyright-info.ts`).
 */
function BrandCard({ status, server, clinicName }: { status: SoftwareUpdateStatus; server: SystemVersion | null; clinicName: string | null }) {
  const { status: copyStatus, copy } = useCopySupportInfo(server);
  const channel = server?.channel ?? status.channel;
  const contacts = listSupportContacts(COPYRIGHT_INFO);
  return (
    <div className="min-w-[300px] flex-[0_1_380px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="px-7 pb-5 pt-7 text-center">
        <img src="/brand/nexamed-logo-horizontal.svg" alt="NEXA Med" className="mx-auto h-11 w-auto" />
        <p className="mt-3 text-sm font-medium text-slate-900">Phần Mềm Quản Lý Phòng Khám Chuyên Nghiệp</p>
      </div>
      <div className="border-b border-slate-200 px-7 pb-5">
        <div className="text-[13.5px] text-slate-600">{status.state === 'update_available' ? 'Phiên bản đang chạy' : 'Phiên bản'}</div>
        <div className="mt-0.5 flex items-center gap-3">
          <span className="text-[40px] font-semibold leading-tight tabular-nums text-slate-900">{status.currentVersion}</span>
          <StatusBadge tone={CHANNEL_TONE[channel]}>{RELEASE_CHANNEL_LABELS[channel]}</StatusBadge>
        </div>
        <dl className="mt-3.5">
          <InfoRow label="Ngày phát hành">{formatReleaseDate(server?.releasedAt ?? null)}</InfoRow>
          {server && <InfoRow label="Chế độ triển khai">{DEPLOYMENT_MODE_LABELS[server.deploymentMode]}</InfoRow>}
          {server && <InfoRow label="Số bản dựng">{server.build}</InfoRow>}
        </dl>
      </div>
      <div className="space-y-3 px-7 pb-6 pt-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Bản quyền</h2>
        <p className="text-sm leading-relaxed text-slate-800">{formatCopyrightLine(COPYRIGHT_INFO, new Date().getFullYear())}</p>
        <dl>
          {clinicName && <InfoRow label="Cấp phép cho">{clinicName}</InfoRow>}
          {contacts.map((c) => (
            <InfoRow key={c.label} label={c.label}>
              {c.value}
            </InfoRow>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={() => void copy()}>
            Sao chép thông tin gửi hỗ trợ
          </Button>
          <span role="status" aria-live="polite" className={`text-sm font-semibold ${copyStatus === 'failed' ? 'text-rose-700' : 'text-emerald-700'}`}>
            {copyStatus === 'ok' ? 'Đã sao chép' : copyStatus === 'failed' ? 'Không sao chép được, hãy chọn và sao chép thủ công' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * "Có gì mới trong bản đang chạy" (chỉ hiện bản đang chạy, KHÔNG hiện "Các bản trước" — chủ dự án chốt 30/10/2026): hiện `notes` của `GET /system/version` (ghi chú ĐÓNG KÈM phần mềm) nên hiện ngay
 * cả khi chưa có máy chủ phát hành. Bản chưa có ghi chú thì ẩn cả khối. Các nhóm mặc định thu gọn. Không tự tải dữ liệu: thẻ chỉ hiện sau khi `/system/version` đã tải xong (xem `useSoftwareUpdateVisible`).
 */
function BundledReleaseNotes({ currentVersion, releasedAt, notes, newerAvailable }: { currentVersion: string; releasedAt: string | null; notes: ReleaseNotesData | null; newerAvailable: boolean }) {
  if (notes === null) return null;
  const total = countReleaseNoteLines(notes);
  if (total === 0) return null;
  const date = releasedAt ? ` · phát hành ${formatReleaseDate(releasedAt)}` : '';
  return (
    <SectionCard title={newerAvailable ? `Có gì mới trong bản đang chạy ${currentVersion}` : `Có gì mới trong bản ${currentVersion}`} hint={`${total} thay đổi${date}`}>
      <ReleaseNoteGroups notes={notes} />
    </SectionCard>
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

/** Khối kết quả theo `status.state` — mỗi trạng thái một khung riêng, đúng mockup đã chốt (#236, thiết kế lại 06/11/2026). */
function ResultBlock({ status, checking, onCheck }: { status: SoftwareUpdateStatus; checking: boolean; onCheck: () => void }) {
  const lastChecked = status.lastCheckedAt ? `Kiểm tra lần cuối: ${formatDateTimeVn(status.lastCheckedAt)}` : 'Chưa kiểm tra lần nào';

  if (status.state === 'not_configured') {
    return (
      <SectionCard title="Kiểm tra cập nhật" hint={lastChecked}>
        <div className="space-y-3 p-5">
          <p className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            Chưa cấu hình máy chủ phát hành
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
            Địa chỉ máy chủ phát hành do nhà cung cấp cấu hình khi bàn giao, không nhập được trên giao diện này. Hiện bản cài đặt của bạn chưa được cấu hình; cập nhật bằng gói cài đặt như hiện nay.
          </p>
          <Button type="button" variant="secondary" disabled>
            Kiểm tra cập nhật
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (status.state === 'error') {
    return (
      <SectionCard title="Kiểm tra cập nhật" hint={lastChecked}>
        <div className="space-y-3 p-5">
          <ErrorBanner message={`${status.errorMessage ?? 'Không kiểm tra được bản mới.'} Kiểm tra kết nối mạng của máy chủ rồi thử lại.`} />
          <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
            Thử lại
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (status.state === 'update_available' && status.latest) {
    const { latest } = status;
    return (
      <SectionCard title="Có phiên bản mới" tone="info" hint={status.lastCheckedAt ? `Kiểm tra lúc ${formatDateTimeVn(status.lastCheckedAt)}` : undefined}>
        <dl className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-slate-100 p-5">
          <div>
            <dt className="text-[13.5px] text-slate-600">Phiên bản mới</dt>
            <dd className="text-[34px] font-semibold leading-tight tabular-nums text-blue-700">{latest.version}</dd>
          </div>
          <div>
            <dt className="text-[13.5px] text-slate-600">Ngày phát hành</dt>
            <dd className="text-base font-semibold text-slate-900">{formatReleaseDate(latest.releasedAt)}</dd>
          </div>
          <div>
            <dt className="text-[13.5px] text-slate-600">Loại cập nhật</dt>
            <dd className="mt-1">{latest.requiresMigration ? <StatusBadge tone="warning">Có thay đổi cơ sở dữ liệu</StatusBadge> : <StatusBadge tone="neutral">Không đổi cơ sở dữ liệu</StatusBadge>}</dd>
          </div>
        </dl>
        {countReleaseNoteLines(latest.notes) > 0 && (
          <div>
            <h3 className="px-5 pb-1 pt-3 text-[15px] font-semibold text-slate-900">Có gì mới trong bản {latest.version}</h3>
            <ReleaseNoteGroups notes={latest.notes} />
          </div>
        )}
        <div className="space-y-3.5 p-5">
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
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Kiểm tra cập nhật" hint={lastChecked}>
      <div className="space-y-3 p-5">
        {status.state === 'up_to_date' ? (
          <p className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
            <StatusBadge tone="success">Mới nhất</StatusBadge>
            Bạn đang dùng phiên bản mới nhất của kênh {RELEASE_CHANNEL_LABELS[status.channel]}.
          </p>
        ) : (
          <p className="text-base font-semibold text-slate-900">Chưa kiểm tra lần nào kể từ khi máy chủ khởi động.</p>
        )}
        <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
          Kiểm tra cập nhật
        </Button>
      </div>
    </SectionCard>
  );
}

function HistoryTable({ history }: { history: SoftwareUpdateStatus['history'] }) {
  return (
    <SectionCard title="Lịch sử kiểm tra gần đây">
      {history.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-600">Chưa có lần kiểm tra nào.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b-2 border-blue-600 bg-slate-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Thời gian</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Người thực hiện</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.map((item) => (
              <tr key={item.at}>
                <td className="px-4 py-2.5 font-medium tabular-nums text-slate-900">{formatDateTimeVn(item.at)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{item.byName ?? '—'}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{formatHistoryResult(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

/**
 * "Cấu hình hệ thống → Cập nhật phần mềm" (docs/DECISIONS.md #236, bước 2; THIẾT KẾ LẠI 06/11/2026 theo mockup chủ dự án chốt): thẻ thương hiệu + bản quyền bên trái; bên phải kết quả kiểm tra bản
 * mới, "Có gì mới" (các nhóm mặc định thu gọn) và lịch sử kiểm tra. Màn hẹp thì thẻ thương hiệu xếp trên. Chỉ KIỂM TRA và HIỂN THỊ — nút "Cập nhật ngay" tắt cho tới khi có bộ cập nhật thật. Kênh
 * Ổn định/Thử nghiệm và địa chỉ máy chủ phát hành do nhà cung cấp đặt (không còn hiện địa chỉ này ở giao diện). Pill chỉ hiện ở `ClinicConfigPage.tsx` khi tài khoản có `software_update.read` và hệ thống
 * chạy một công ty (không phải SaaS).
 */
export function SoftwareUpdatePane() {
  const query = useSoftwareUpdateStatusQuery(true);
  const versionQuery = useSystemVersionQuery();
  const checkMutation = useCheckSoftwareUpdateMutation();
  const clinicName = useClinicPrintHeaderQuery().data?.name ?? null;

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorBanner message="Không tải được trạng thái cập nhật phần mềm." onRetry={() => void query.refetch()} />;

  const status = query.data;
  const server = versionQuery.data ?? null;
  const check = () => checkMutation.mutate();

  return (
    <div className="flex flex-wrap items-start gap-6">
      <BrandCard status={status} server={server} clinicName={clinicName} />
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
        <ResultBlock status={status} checking={checkMutation.isPending} onCheck={check} />
        {checkMutation.isError && <ErrorBanner message="Không gửi được yêu cầu kiểm tra. Thử lại." />}
        <BundledReleaseNotes currentVersion={status.currentVersion} releasedAt={server?.releasedAt ?? null} notes={server?.notes ?? null} newerAvailable={status.state === 'update_available'} />
        <HistoryTable history={status.history} />
      </div>
    </div>
  );
}
