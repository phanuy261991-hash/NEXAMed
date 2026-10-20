/**
 * Mã đơn thuốc chuẩn Bộ Y tế `xxxxxyyyyyyy-z` (docs/DECISIONS.md #242) tách màu 3 phần cho dễ đọc: 5 số mã cơ sở KCB (xanh), 7 số bộ đếm, hậu tố loại đơn (xám).
 * Mã không đúng khuôn (ví dụ mã nội bộ cũ `DT2610000001`) hiện nguyên văn. Cấm font-mono (ui-guidelines mục 9) nên dùng số có độ rộng đều `tabular-nums`.
 */
export function PrescriptionNationalCode({ code, className = '' }: { code: string; className?: string }) {
  const m = /^(\d{5})(\d{7})(-[A-Z])$/.exec(code);
  if (!m) return <span className={`font-semibold tabular-nums text-slate-800 ${className}`}>{code}</span>;
  return (
    <span className={`font-semibold tabular-nums ${className}`}>
      <span className="text-blue-700">{m[1]}</span>
      <span className="text-slate-900">{m[2]}</span>
      <span className="text-slate-500">{m[3]}</span>
    </span>
  );
}
