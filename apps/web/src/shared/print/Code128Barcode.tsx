import type { CSSProperties } from 'react';
import { code128Bars } from './code128';

/**
 * Mã vạch Code 128 dạng SVG (docs/DECISIONS.md #220). Co giãn theo khung chứa (`className` đặt chiều rộng/cao) — các vạch luôn nguyên số mô-đun trong hệ toạ độ SVG nên
 * không bị nhoè khi in; `preserveAspectRatio="none"` để chiều cao tự do theo khung. Màu vạch lấy từ `currentColor` (mặc định đen khi in).
 */
export function Code128Barcode({ value, className = '', style, title }: { value: string; className?: string; style?: CSSProperties; title?: string }) {
  const { bars, totalModules } = code128Bars(value);
  return (
    <svg
      viewBox={`0 0 ${totalModules} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? `Mã vạch ${value}`}
      className={className}
      style={style}
      fill="currentColor"
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={1} />
      ))}
    </svg>
  );
}
