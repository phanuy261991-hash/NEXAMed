export interface TabBarItem<T extends string = string> {
  id: T;
  label: string;
}

/**
 * Dải tab dùng chung (chốt 2026-09-25, chủ dự án phản hồi trực tiếp kiểu gạch chân cũ "không nổi
 * bật") — trích xuất từ `SupplierDetailPage.tsx`/`CashierShiftListPage.tsx`/`InvoiceListPage.tsx`/
 * `DrugCatalogPane.tsx` (trùng lặp lần 4, đúng ngưỡng phải gộp theo `CLAUDE.md`). Tab đang chọn nổi
 * bật bằng NỀN (`bg-blue-50 text-blue-700`, đúng ngôn ngữ thị giác "đoạn cuối breadcrumb" đã chốt ở
 * `ui-guidelines.md` mục 8.2), không còn viền gạch chân dưới.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: TabBarItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
            t.id === active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
