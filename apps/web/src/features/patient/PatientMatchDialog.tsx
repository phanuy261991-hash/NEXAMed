import { IdentificationCard, Warning, X } from '@phosphor-icons/react';
import type { PatientSummary } from '@nexamed/shared';
import { formatDobDisplay } from '../../shared/format/date';
import { Button } from '../../shared/ui/Button';

/**
 * Popup "phát hiện hồ sơ trùng" DÙNG CHUNG cho mọi tình huống cần người dùng quyết định — tra
 * trùng SĐT (nhiều kết quả), nghi trùng tên+ngày sinh lúc submit (PAT-03) — thay cho các banner
 * phẳng cũ (yêu cầu chủ dự án: nổi bật hơn, không lẫn vào giữa trang). `variant='info'` (tra SĐT —
 * SĐT được phép trùng thật, chỉ là gợi ý) dùng tông xanh; `variant='warning'` (nghi trùng PAT-03 —
 * tên+ngày sinh khớp, khả năng cao là cùng một người) dùng tông hổ phách. Mỗi hồ sơ nghi trùng bấm
 * được thẳng để CHỌN LUÔN (khoá form theo hồ sơ đó) — không chỉ là thông tin tham khảo, hợp nhất
 * với luồng khớp SĐT/CCCD đang dùng cùng cơ chế `pendingMatchId`.
 */
export function PatientMatchDialog({
  variant,
  title,
  description,
  candidates,
  onPick,
  onCreateNew,
  onClose,
  creating,
}: {
  variant: 'info' | 'warning';
  title: string;
  description: string;
  candidates: PatientSummary[];
  onPick: (patient: PatientSummary) => void;
  /** "Vẫn tạo mới" — chỉ có ý nghĩa ở luồng PAT-03 (đang chờ xác nhận trước khi tạo hồ sơ mới). */
  onCreateNew?: () => void;
  onClose: () => void;
  creating?: boolean;
}) {
  const tone =
    variant === 'warning'
      ? { ring: 'ring-amber-100', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', Icon: Warning }
      : { ring: 'ring-blue-100', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', Icon: IdentificationCard };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="patient-match-title">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative px-6 pb-5 pt-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} weight="bold" />
          </button>

          <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-full ring-8 ${tone.iconBg} ${tone.ring}`}>
            <tone.Icon size={22} weight="fill" className={tone.iconColor} />
          </div>

          <h2 id="patient-match-title" className="text-[16px] font-bold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{description}</p>

          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto scroll-hover">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50"
                >
                  <span>
                    <span className="block text-[13.5px] font-semibold text-slate-900">{p.fullName}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {p.patientCode} · sinh {formatDobDisplay(p.dob)}
                    </span>
                  </span>
                  <span className="flex-none rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">Chọn</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            {onCreateNew ? 'Huỷ' : 'Đóng'}
          </Button>
          {onCreateNew && (
            <Button type="button" loading={creating} onClick={onCreateNew}>
              Vẫn tạo mới
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}