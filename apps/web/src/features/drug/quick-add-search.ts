/**
 * Khi nào ô tìm hàng được coi là "tìm xong mà không có mặt hàng nào" để hiện dòng "Thêm mặt hàng mới" (docs/DECISIONS.md #298 bổ sung 2). Dùng chung cho Đơn đặt hàng NCC và Phiếu nhập kho.
 * Phải đủ ba điều kiện để không mở nhầm: kết quả về là của ĐÚNG chuỗi đang gõ (không phải chuỗi cũ do chống giật 300ms), truy vấn đã thành công và không còn đang tải lại, và thật sự không có mặt hàng nào
 * (mặt hàng chỉ bị ẩn vì đã có sẵn trong đơn thì KHÔNG tính, vì đó không phải mặt hàng chưa có trong danh mục).
 */
export function isNoItemMatch(input: { query: string; debouncedQuery: string; isSuccess: boolean; isFetching: boolean; rawResultCount: number }): boolean {
  const query = input.query.trim();
  return query !== '' && input.debouncedQuery.trim() === query && input.isSuccess && !input.isFetching && input.rawResultCount === 0;
}
