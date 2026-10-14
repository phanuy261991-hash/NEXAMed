export interface SegmentedToggleItem<T extends string = string> {
  id: T;
  label: string;
  /** Chấm số cạnh nhãn (ví dụ số lượt theo bộ lọc) — chỉ hiện khi truyền. */
  count?: number;
}

/**
 * Bộ chuyển dạng phân đoạn (nút liền nhau, mục đang chọn nền xanh đặc) — dùng để chia NHÓM danh sách ngay trên bảng (ví dụ "Xét nghiệm | CĐHA & Thăm dò chức năng | Chỉ định ra ngoài",
 * "Đã hoàn tất | Tất cả"). Khác `TabBar` (điều hướng giữa các khung nội dung) và `TwoOptionToggle` (chọn 1-trong-2 trong form). Trích xuất từ tab "Lịch sử khám chữa bệnh" khi có nơi dùng thứ hai
 * (menu Phiếu chỉ định / Tra cứu kết quả, docs/DECISIONS.md #232).
 */
export function SegmentedToggle<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: readonly SegmentedToggleItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-pressed={value === item.id}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${value === item.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1 tabular-nums opacity-80">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
