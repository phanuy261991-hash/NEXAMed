/**
 * Mảng rỗng DÙNG CHUNG, tham chiếu ổn định. Dùng thay cho `query.data?.items ?? []` khi kết quả đi vào mảng phụ thuộc của
 * `useMemo`/`useEffect`: `?? []` tạo mảng mới mỗi lần render nên hook chạy lại mỗi lần khi dữ liệu chưa về
 * (cảnh báo `react-hooks/exhaustive-deps`). KHÔNG sửa nội dung mảng này.
 */
export const EMPTY_LIST: never[] = [];
