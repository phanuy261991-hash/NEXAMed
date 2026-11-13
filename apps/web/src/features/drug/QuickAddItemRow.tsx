/**
 * Dòng cuối danh sách gợi ý của ô tìm hàng khi gõ không ra mặt hàng nào (docs/DECISIONS.md #298 bổ sung 2, mockup màn 2). Người có quyền thêm thuốc/vật tư thấy dòng hành động "Thêm mặt hàng mới"
 * mang sẵn tên vừa gõ (bấm hoặc Enter mở `QuickAddItemDialog`); người khác vẫn thấy "Không tìm thấy" kèm gợi ý nhờ quản lý thêm. Dùng chung cho Đơn đặt hàng NCC và Phiếu nhập kho.
 */
export function QuickAddItemRow({ query, canCreate, onOpen }: { query: string; canCreate: boolean; onOpen: () => void }) {
  const name = query.trim();
  if (!canCreate) {
    return <p className="px-3 py-2 text-sm text-slate-600">Không tìm thấy mặt hàng nào khớp. Nhờ quản lý thêm mặt hàng này ở Danh mục Thuốc &amp; Vật tư.</p>;
  }
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-3 bg-brand-teal-tint px-3 py-2.5 text-left text-sm hover:bg-brand-teal-tint/70">
      <span className="min-w-0 text-slate-900">
        <span className="font-semibold">Không có mặt hàng nào tên "{name}". </span>
        <span className="font-semibold text-brand-teal">Thêm mặt hàng mới "{name}"</span>
      </span>
      <kbd className="flex-shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-600">Enter</kbd>
    </button>
  );
}
