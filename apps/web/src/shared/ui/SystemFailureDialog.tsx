import { useEffect } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { CheckCircleIcon, ClockIcon, ShieldCheckIcon, WarningIcon, WifiSlashIcon, XIcon } from '@phosphor-icons/react';
import { SYSTEM_FAILURE_CONTENT, type FailureHeaderIcon, type FailureItemKind, type FailureTone } from '../errors/system-failure-content';
import { useSystemFailureStore } from '../errors/system-failure.store';
import { Button } from './Button';

const HEADER_ICON: Record<FailureHeaderIcon, Icon> = { offline: WifiSlashIcon, warning: WarningIcon };
const ITEM_ICON: Record<FailureItemKind, Icon> = { wait: ClockIcon, safe: ShieldCheckIcon, kept: CheckCircleIcon };
const TONE_CLASS: Record<FailureTone, string> = { amber: 'bg-amber-100 text-amber-700', rose: 'bg-rose-100 text-rose-700' };

/**
 * Hộp thông báo lỗi HỆ THỐNG khi đang thực hiện một thao tác (docs/DECISIONS.md #255, #273, ui-guidelines mục 17): mất mạng, máy chủ chưa bật, lỗi 5xx.
 * Đặt MỘT lần ở gốc ứng dụng; hiện đè lên trang, người dùng đóng lại để quay về form còn nguyên dữ liệu rồi bấm thử lại. Không hiện mã lỗi hay thông
 * điệp thô — chỉ lời giải thích tiếng Việt. Lỗi nghiệp vụ/kiểm tra hợp lệ (4xx) KHÔNG đi qua đây, vẫn hiện tại chỗ.
 * Bố cục (mockup phương án A, 31/10/2026): ô biểu tượng nền nhạt + tiêu đề + một câu dẫn, rồi ba dòng thông tin có biểu tượng tròn nhỏ. Nội dung ở `system-failure-content.ts`.
 */
export function SystemFailureDialog() {
  const kind = useSystemFailureStore((s) => s.kind);
  const close = useSystemFailureStore((s) => s.close);
  // Esc đóng hộp — cùng thao tác với mọi hộp xác nhận (`ConfirmDialog`).
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, close]);
  if (!kind) return null;
  const content = SYSTEM_FAILURE_CONTENT[kind];
  const HeaderIcon = HEADER_ICON[content.icon];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="system-failure-title">
      <div className="relative w-full max-w-[420px] rounded-[18px] border border-slate-200 bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </button>

        <div className="flex gap-3.5 pr-7">
          <span className={`flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[14px] ${TONE_CLASS[content.tone]}`}>
            <HeaderIcon size={22} weight="regular" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="system-failure-title" className="text-lg font-semibold leading-snug text-slate-900">
              {content.title}
            </h2>
            <p className="mt-0.5 text-[13.5px] text-slate-500">{content.lead}</p>
          </div>
        </div>

        <ul className="mt-5 flex flex-col gap-3.5">
          {content.items.map((item) => {
            const ItemIcon = ITEM_ICON[item.kind];
            return (
              <li key={item.label} className="flex items-start gap-3">
                <span className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full ${item.kind === 'wait' ? TONE_CLASS[content.tone] : 'bg-emerald-100 text-emerald-700'}`}>
                  <ItemIcon size={17} weight="bold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-slate-900">{item.label}</p>
                  <p className="text-[12.5px] text-slate-500">{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex justify-end">
          <Button type="button" autoFocus onClick={close}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
