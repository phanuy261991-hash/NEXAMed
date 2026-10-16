import { useEffect, useRef, useState, type RefObject } from 'react';

/** Thuộc tính đánh dấu khối chẩn đoán gốc trong trang (PrescriptionPanel) — thanh này chỉ hiện khi khối đó cuộn khuất. */
const DIAGNOSIS_ANCHOR_ATTR = 'data-diagnosis-anchor';

/**
 * Biến CSS đặt trên khung cuộn: chiều cao thanh chẩn đoán đang hiện (0 khi ẩn). Khối dính khác trong
 * cùng khung (vd ô "Thêm thuốc vào đơn") đặt `top-[calc(var(--sticky-diagnosis-h,0px)-1rem)]` để nằm
 * ngay dưới thanh này thay vì chồng lên.
 */
export const STICKY_DIAGNOSIS_HEIGHT_VAR = '--sticky-diagnosis-h';

export interface StickyDiagnosisBarItem {
  icd10Code: string;
  icd10Name: string;
  type: string;
}

/**
 * Thanh chẩn đoán dính trên đỉnh khung cuộn — ẨN khi khối chẩn đoán gốc (phần tử có
 * `data-diagnosis-anchor`) còn thấy, chỉ hiện khi khối đó cuộn khuất khỏi đỉnh khung. Không chiếm
 * chỗ trong luồng (wrapper cao 0) nên bật/tắt không làm nội dung nhảy. Phải đặt TRỰC TIẾP trong khung
 * cuộn có padding `p-4` (mép dính `-top-4` bù đúng padding đó).
 */
export function StickyDiagnosisBar({ diagnoses, scrollRef }: { diagnoses: StickyDiagnosisBarItem[]; scrollRef: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      const anchor = scroller.querySelector(`[${DIAGNOSIS_ANCHOR_ATTR}]`);
      // Không có khối gốc thì thanh là nơi duy nhất hiện chẩn đoán → luôn hiện.
      const nextShown = anchor ? anchor.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top : true;
      setShown(nextShown);
      scroller.style.setProperty(STICKY_DIAGNOSIS_HEIGHT_VAR, `${nextShown ? (barRef.current?.offsetHeight ?? 0) : 0}px`);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      scroller.style.removeProperty(STICKY_DIAGNOSIS_HEIGHT_VAR);
    };
  }, [scrollRef, diagnoses]);

  return (
    <div className="sticky -top-4 z-10 -mx-4 h-0">
      <div
        ref={barRef}
        aria-hidden={!shown}
        className={`absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 transition-opacity duration-150 ${
          shown ? 'opacity-100' : 'invisible opacity-0'
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Chẩn đoán</span>
        {diagnoses.map((d) => (
          <span
            key={d.icd10Code}
            className={
              d.type === 'PRIMARY'
                ? 'rounded-full border border-brand-teal bg-brand-teal-tint px-2.5 py-1 text-xs font-semibold text-brand-teal-active'
                : 'rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600'
            }
          >
            {d.icd10Code} — {d.icd10Name}
          </span>
        ))}
      </div>
    </div>
  );
}
