/**
 * Vòng tròn % tiến độ — dùng chung cho MỌI nơi cần hiện 1 chỉ số hoàn thành dạng vòng tròn (ví dụ
 * "Đã đăng ký N/M ca" ở `MyWorkSchedulePage.tsx`). Vẽ bằng 2 vòng `<circle>` chồng nhau
 * (nền nhạt + vòng tiến độ dùng `strokeDasharray`), không dùng thư viện ngoài — component nhỏ, tự
 * vẽ SVG rẻ hơn kéo thêm dependency.
 */
export function ProgressRing({ percent, size = 56, strokeWidth = 6 }: { percent: number; size?: number; strokeWidth?: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-slate-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-blue-600 transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums text-slate-800">{Math.round(clamped)}%</span>
    </div>
  );
}
