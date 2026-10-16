import { useEffect, useState } from 'react';
import { Info } from '@phosphor-icons/react';
import type { ReleaseNotes } from '@nexamed/shared';
import { copyText } from '../../shared/format/clipboard';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { DEPLOYMENT_MODE_LABELS, RELEASE_CHANNEL_LABELS, WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../../shared/version/app-version';
import { buildSupportInfo, formatReleaseDate } from './support-info';
import { useSystemVersionQuery } from './system.queries';

const CHANNEL_TONE = { stable: 'info', beta: 'warning', dev: 'neutral' } as const;

const NOTE_GROUPS: { key: keyof Pick<ReleaseNotes, 'features' | 'improvements' | 'fixes'>; title: string }[] = [
  { key: 'features', title: 'Tính năng mới' },
  { key: 'improvements', title: 'Cải tiến' },
  { key: 'fixes', title: 'Sửa lỗi' },
];

/**
 * Hộp "Giới thiệu" — phiên bản phần mềm đang chạy (docs/DECISIONS.md #236, mockup đã duyệt): phiên bản, kênh, ngày phát hành, chế độ triển khai, ghi chú phát hành của bản này, và mục "Thông tin kỹ thuật"
 * gập sẵn (mã bản dựng, phiên bản cơ sở dữ liệu, phiên bản máy chủ/web) kèm nút sao chép gửi hỗ trợ. Mở từ menu người dùng ở thanh trên — mọi tài khoản đăng nhập đều mở được.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const query = useSystemVersionQuery();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const server = query.data ?? null;
  const web = { version: WEB_VERSION, build: WEB_BUILD_ID };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleCopy() {
    const ok = await copyText(buildSupportInfo(server, web, navigator.userAgent));
    setCopied(ok ? 'ok' : 'failed');
  }

  const notes = server?.notes ?? null;
  const hasNotes = notes !== null && notes.features.length + notes.improvements.length + notes.fixes.length > 0;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="scroll-hover flex-1 space-y-6 overflow-y-auto p-6">
          <ModalHeader icon={Info} title="Giới thiệu NEXAMed" subtitle="Phần mềm quản lý phòng khám" onClose={onClose} />
          <h2 id="about-title" className="sr-only">
            Giới thiệu NEXAMed
          </h2>

          <BoxedSection badge="Phiên bản đang chạy">
            {query.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : server ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm font-medium text-slate-500">Phiên bản</dt>
                  <dd className="text-3xl font-semibold tabular-nums text-slate-900">{server.version}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-slate-500">Kênh</dt>
                  <dd className="mt-1">
                    <StatusBadge tone={CHANNEL_TONE[server.channel]}>{RELEASE_CHANNEL_LABELS[server.channel]}</StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-slate-500">Ngày phát hành</dt>
                  <dd className="text-base font-semibold text-slate-900">{formatReleaseDate(server.releasedAt)}</dd>
                </div>
                <div className="sm:col-span-3">
                  <dt className="text-sm font-medium text-slate-500">Chế độ triển khai</dt>
                  <dd className="text-base font-semibold text-slate-900">{DEPLOYMENT_MODE_LABELS[server.deploymentMode]}</dd>
                </div>
              </dl>
            ) : (
              <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                Không đọc được thông tin phiên bản từ máy chủ. Giao diện đang chạy bản {formatDisplayVersion(web.version, web.build)}.
                <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">
                  Thử lại
                </button>
              </div>
            )}
          </BoxedSection>

          {server && (
            <BoxedSection badge="Ghi chú phát hành của bản này">
              {hasNotes && notes ? (
                <div className="space-y-3">
                  {NOTE_GROUPS.filter((g) => notes[g.key].length > 0).map((g) => (
                    <div key={g.key}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{g.title}</h3>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-medium text-slate-800">
                        {notes[g.key].map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-medium text-slate-600">Chưa có ghi chú phát hành cho bản này.</p>
              )}
            </BoxedSection>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Thông tin kỹ thuật</summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-slate-500">Số bản dựng (máy chủ)</dt>
                <dd className="break-all text-sm font-semibold text-slate-900">{server ? server.build : '—'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Phiên bản cơ sở dữ liệu</dt>
                <dd className="break-all text-sm font-semibold text-slate-900">{server?.schemaVersion ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Máy chủ (API)</dt>
                <dd className="text-sm font-semibold text-slate-900">{server ? formatDisplayVersion(server.version, server.build) : '—'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Giao diện (Web)</dt>
                <dd className="text-sm font-semibold text-slate-900">{formatDisplayVersion(web.version, web.build)}</dd>
              </div>
            </dl>
          </details>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-6 py-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
              Sao chép thông tin gửi hỗ trợ
            </Button>
            <span role="status" aria-live="polite" className={`text-sm font-semibold ${copied === 'failed' ? 'text-rose-700' : 'text-emerald-700'}`}>
              {copied === 'ok' ? 'Đã sao chép' : copied === 'failed' ? 'Không sao chép được, hãy chọn và sao chép thủ công' : ''}
            </span>
          </div>
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
