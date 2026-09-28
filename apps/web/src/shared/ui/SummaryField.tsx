/**
 * 1 cặp label/giá trị trên dải tóm tắt "Thông tin phiếu..." — dùng cho các trang đã đổi model nhập
 * liệu header sang popup (`StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`): trang chính chỉ hiện
 * dải tóm tắt gọn kèm nút "Sửa", nhường không gian còn lại cho khu vực thao tác chính. Trích xuất
 * dùng chung khi phát hiện trùng lặp lần 2 theo CLAUDE.md.
 */
export function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="max-w-[220px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-900" title={value}>
        {value}
      </div>
    </div>
  );
}
