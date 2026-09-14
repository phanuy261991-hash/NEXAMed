import { Check } from '@phosphor-icons/react';

/**
 * Thanh tiến trình N bước cho luồng thao tác thật sự tuần tự (`.claude/docs/ui-guidelines.md` mục
 * 8.2 — chỉ dùng số bước kiểu wizard cho luồng tuần tự, không dùng cho breadcrumb điều hướng
 * thường). Trích từ `CloseShiftDialog.tsx` (lần dùng thứ hai — `EndOfDayDialog.tsx`, "Chế độ phòng
 * khám 1 người") khi có nơi dùng chung thật, theo CLAUDE.md.
 *
 * Lưới N cột ĐỀU NHAU — số và nhãn dùng chung một cột nên luôn thẳng hàng (bài học từ bản đầu tính
 * 2 hàng riêng theo 2 công thức flex khác nhau, bị lệch — xem lịch sử `docs/DECISIONS.md` #120).
 * Đường nối vẽ NGẦM phía sau bằng 2 nửa mỗi cột (nửa trái nối cột trước, nửa phải nối cột sau),
 * circle đè `z-10` lên trên.
 */
export function WizardStepper({ labels, currentStep }: { labels: readonly string[]; currentStep: number }) {
  return (
    <div className="mt-5 grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((label, i) => {
        const step = i + 1;
        const isDone = step < currentStep;
        const isActive = step === currentStep;
        return (
          <div key={label} className="relative flex flex-col items-center gap-2">
            {i > 0 && <div className={`absolute left-0 right-1/2 top-3.75 h-0.5 ${step <= currentStep ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
            {i < labels.length - 1 && <div className={`absolute left-1/2 right-0 top-3.75 h-0.5 ${isDone ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
            <div
              className={`relative z-10 flex h-7.5 w-7.5 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                isDone ? 'bg-emerald-600 text-white' : isActive ? 'bg-emerald-600 text-white ring-4 ring-emerald-100' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {isDone ? <Check size={14} weight="bold" aria-hidden="true" /> : step}
            </div>
            <span className={`text-center text-[12.5px] font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-500'}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
