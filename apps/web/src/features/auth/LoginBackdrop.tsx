import type { CSSProperties } from 'react';
import { Bandaids, ClipboardText, Drop, Flask, Heart, Heartbeat, Pill, Plus, Stethoscope, Syringe, Thermometer, type Icon } from '@phosphor-icons/react';

/**
 * Nền phía sau cửa sổ đăng nhập: biểu tượng y khoa lơ lửng chuyển động nhẹ (mockup đã duyệt 16/10/2026, mức "Rõ"). Chỉ hiện từ màn hình vừa trở lên (điện thoại không có nền).
 * Màn hình lớn (24 inch Full HD, 27 inch QHD trở lên) thì cỡ biểu tượng và quãng trôi nhân hệ số --s (1 → 1,25 → 1,5) để nền không thưa. Toàn bộ chuyển động là CSS (`.login-float` ở `app/index.css`), không JS, không thư viện. Biểu tượng nằm ở vùng rìa nên phần lớn bị cửa sổ đăng nhập che khi màn hình hẹp,
 * hiện nhiều hơn trên màn hình rộng.
 */
type Tone = 'teal' | 'blue' | 'slate';
const TONE_CLASS: Record<Tone, string> = { teal: 'text-brand-teal', blue: 'text-blue-600', slate: 'text-slate-500' };

interface Floater {
  icon: Icon;
  left: number; // % chiều ngang
  top: number; // % chiều dọc
  size: number; // px
  tone: Tone;
  opacity: number;
  dx: number; // px trôi ngang
  dy: number; // px trôi dọc
  r0: number; // độ xoay đầu
  r1: number; // độ xoay cuối
  seconds: number; // chu kỳ một chiều
  delay: number; // giây (âm = đã chạy dở ngay từ đầu)
}

// Đã áp mức "Rõ" của mockup: cỡ ×1,3, quãng trôi ×3,4, chu kỳ ×0,5, độ đậm +0,22 (tối đa 0,8), xoay ×1,8, phồng 1,1.
const FLOATERS: readonly Floater[] = [
  { icon: Plus, left: 2.5, top: 7, size: 52, tone: 'teal', opacity: 0.67, dx: 41, dy: -61, r0: -11, r1: 14, seconds: 5.5, delay: 0 },
  { icon: Stethoscope, left: 5.5, top: 24, size: 60, tone: 'blue', opacity: 0.6, dx: -34, dy: 54, r0: 7, r1: -13, seconds: 7, delay: -3 },
  { icon: Pill, left: 2, top: 41, size: 49, tone: 'slate', opacity: 0.64, dx: 48, dy: -41, r0: -18, r1: 11, seconds: 6, delay: -5 },
  { icon: Heart, left: 6, top: 58, size: 44, tone: 'teal', opacity: 0.67, dx: -27, dy: -54, r0: 9, r1: -9, seconds: 5, delay: -2 },
  { icon: Thermometer, left: 2.5, top: 74, size: 55, tone: 'blue', opacity: 0.58, dx: 34, dy: 48, r0: -5, r1: 13, seconds: 7.5, delay: -7 },
  { icon: Drop, left: 6, top: 90, size: 39, tone: 'teal', opacity: 0.72, dx: -41, dy: -34, r0: 0, r1: 16, seconds: 4.5, delay: -1 },
  { icon: Syringe, left: 14, top: 3, size: 57, tone: 'slate', opacity: 0.62, dx: 54, dy: 34, r0: -11, r1: 11, seconds: 6.5, delay: -4 },
  { icon: Heartbeat, left: 30, top: 4, size: 65, tone: 'teal', opacity: 0.64, dx: -48, dy: 41, r0: 5, r1: -7, seconds: 8, delay: -9 },
  { icon: ClipboardText, left: 46, top: 2.5, size: 49, tone: 'blue', opacity: 0.58, dx: 34, dy: -27, r0: -9, r1: 9, seconds: 6, delay: -6 },
  { icon: Bandaids, left: 62, top: 4, size: 60, tone: 'slate', opacity: 0.62, dx: -41, dy: 48, r0: 14, r1: -11, seconds: 7, delay: -2 },
  { icon: Flask, left: 78, top: 3, size: 52, tone: 'teal', opacity: 0.64, dx: 41, dy: 41, r0: -7, r1: 11, seconds: 5.5, delay: -8 },
  { icon: Plus, left: 90, top: 5, size: 42, tone: 'blue', opacity: 0.62, dx: -34, dy: 48, r0: 13, r1: -5, seconds: 5, delay: -3 },
  { icon: Heart, left: 94, top: 22, size: 52, tone: 'blue', opacity: 0.58, dx: -41, dy: -48, r0: -11, r1: 11, seconds: 6.5, delay: -5 },
  { icon: Pill, left: 91, top: 38, size: 57, tone: 'teal', opacity: 0.66, dx: 34, dy: 54, r0: 11, r1: -14, seconds: 6, delay: -1 },
  { icon: Stethoscope, left: 95, top: 53, size: 49, tone: 'slate', opacity: 0.62, dx: -27, dy: -41, r0: -7, r1: 9, seconds: 7.5, delay: -10 },
  { icon: Syringe, left: 92, top: 69, size: 55, tone: 'teal', opacity: 0.64, dx: 41, dy: -54, r0: 7, r1: -11, seconds: 5.5, delay: -4 },
  { icon: Thermometer, left: 95, top: 86, size: 47, tone: 'blue', opacity: 0.6, dx: -34, dy: -34, r0: 9, r1: -9, seconds: 6.5, delay: -7 },
  { icon: Drop, left: 16, top: 92, size: 42, tone: 'blue', opacity: 0.62, dx: 41, dy: -48, r0: 0, r1: 14, seconds: 5, delay: -3 },
  { icon: ClipboardText, left: 32, top: 91, size: 52, tone: 'teal', opacity: 0.62, dx: -41, dy: -34, r0: -9, r1: 11, seconds: 7, delay: -6 },
  { icon: Plus, left: 48, top: 93, size: 39, tone: 'slate', opacity: 0.64, dx: 34, dy: -48, r0: 14, r1: -11, seconds: 4.5, delay: -2 },
  { icon: Flask, left: 64, top: 90, size: 55, tone: 'blue', opacity: 0.58, dx: -48, dy: -41, r0: 7, r1: -9, seconds: 6, delay: -9 },
  { icon: Heartbeat, left: 80, top: 92, size: 60, tone: 'teal', opacity: 0.64, dx: 41, dy: -41, r0: -5, r1: 7, seconds: 7.5, delay: -5 },
  { icon: Bandaids, left: 10, top: 14, size: 39, tone: 'teal', opacity: 0.52, dx: 27, dy: 34, r0: 11, r1: -11, seconds: 8.5, delay: -8 },
  { icon: Heart, left: 88, top: 14, size: 36, tone: 'slate', opacity: 0.52, dx: -27, dy: 41, r0: -11, r1: 9, seconds: 8, delay: -11 },
];

export function LoginBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 hidden overflow-hidden [--s:1] desktop:block min-[1920px]:[--s:1.25] min-[2560px]:[--s:1.5]" aria-hidden="true">
      {FLOATERS.map((f, i) => {
        const IconComponent = f.icon;
        const style = {
          left: `${f.left}%`,
          width: `calc(${f.size}px * var(--s))`,
          height: `calc(${f.size}px * var(--s))`,
          top: `${f.top}%`,
          opacity: f.opacity,
          '--dx': `${f.dx}px`,
          '--dy': `${f.dy}px`,
          '--r0': `${f.r0}deg`,
          '--r1': `${f.r1}deg`,
          '--sc': 1.1,
          '--t': `${f.seconds}s`,
          '--d': `${f.delay}s`,
        } as CSSProperties;
        return (
          <span key={i} className={`login-float absolute ${TONE_CLASS[f.tone]}`} style={style}>
            <IconComponent size="100%" weight="regular" />
          </span>
        );
      })}
    </div>
  );
}
