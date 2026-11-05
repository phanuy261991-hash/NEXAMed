/**
 * Tải ĐỦ các trang của một danh sách phân trang con trỏ trước khi in báo cáo (docs/DECISIONS.md #287): bản in phải đủ dữ liệu theo bộ lọc, không chỉ phần đã cuộn tới. Gọi THẲNG hàm API với
 * trang lớn (không đi qua `useInfiniteQuery` của màn hình, vốn tải ít dòng mỗi lần) để in hàng nghìn dòng không phải đợi hàng trăm lượt gọi. Dừng khi hết trang hoặc khi đã có từ `cap`
 * dòng (`capped = true` để bản in ghi chú rõ). Lỗi tải trang nào cũng được ném ra (đi qua hộp báo lỗi chung của mutation) thay vì in dang dở.
 */
export async function loadAllByCursor<P extends { items: unknown[]; nextCursor: string | null }>(fetchPage: (cursor: string | undefined) => Promise<P>, cap: number): Promise<{ pages: P[]; capped: boolean }> {
  const pages: P[] = [];
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    pages.push(page);
    count += page.items.length;
    if (!page.nextCursor) return { pages, capped: false };
    if (count >= cap) return { pages, capped: true };
    cursor = page.nextCursor;
  }
}

/** Kích thước trang khi tải để in — bằng mức tối đa máy chủ cho phép. */
export const PRINT_LOAD_PAGE_SIZE = 100;
