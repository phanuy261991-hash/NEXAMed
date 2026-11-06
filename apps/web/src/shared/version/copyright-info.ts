/**
 * Thông tin bản quyền và hỗ trợ của phần mềm, hiện ở trang "Cập nhật phần mềm" (mockup chủ dự án chốt 06/11/2026). MỘT nơi khai báo: đơn vị nào chưa có thông tin thì để `null` và giao diện
 * TỰ ẨN dòng đó (không hiện chữ giữ chỗ). Đơn vị sở hữu để trống thì dòng bản quyền ghi tên sản phẩm. Điền vào đây khi chủ dự án cung cấp.
 */
export interface CopyrightInfo {
  /** Tên đơn vị sở hữu bản quyền; `null` = chưa có. */
  owner: string | null;
  /** Năm công bố đầu tiên. */
  startYear: number;
  hotline: string | null;
  email: string | null;
  website: string | null;
}

export const COPYRIGHT_INFO: CopyrightInfo = {
  owner: null,
  startYear: 2026,
  hotline: null,
  email: null,
  website: null,
};

const PRODUCT_NAME = 'NEXA Med';

/** "© 2026 NEXA Med. Bảo lưu mọi quyền." — năm hiện tại lớn hơn năm đầu thì ghi khoảng ("2026–2027"). */
export function formatCopyrightLine(info: CopyrightInfo, currentYear: number): string {
  const years = currentYear > info.startYear ? `${info.startYear}–${currentYear}` : String(info.startYear);
  return `© ${years} ${info.owner ?? PRODUCT_NAME}. Bảo lưu mọi quyền.`;
}

/** Các dòng liên hệ hỗ trợ ĐÃ có thông tin, theo thứ tự Hỗ trợ, Email, Trang web. */
export function listSupportContacts(info: CopyrightInfo): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: 'Hỗ trợ', value: info.hotline },
    { label: 'Email', value: info.email },
    { label: 'Trang web', value: info.website },
  ];
  return rows.filter((r): r is { label: string; value: string } => r.value !== null && r.value.trim() !== '');
}
