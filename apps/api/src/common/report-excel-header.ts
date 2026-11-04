import type { Worksheet } from 'exceljs';

/**
 * Đầu chuẩn của MỌI bản Excel báo cáo (docs/DECISIONS.md #279, `docs/product/reporting-plan.md` mục 5): tên phòng khám (+ chi nhánh), tên báo cáo, kỳ, phạm vi, người xuất,
 * thời điểm xuất. Báo cáo mới gọi hàm này thay vì tự viết dòng tiêu đề riêng — để mọi bản xuất có cùng khung và người nhận biết số được chụp lúc nào, của ai.
 */
export interface ReportExcelHeader {
  clinicName: string;
  /** Tên chi nhánh khi báo cáo của MỘT chi nhánh (công ty 1 chi nhánh: bỏ trống). */
  branchName?: string | null;
  title: string;
  /** Kỳ báo cáo, `YYYY-MM-DD`. Báo cáo một ngày thì `from === to`. */
  from: string;
  to: string;
  /** Phạm vi chi nhánh dạng chữ ("Tất cả chi nhánh", "Chi nhánh Quận 1, Quận 3") — bỏ trống nếu không có bộ chọn phạm vi. */
  scopeLabel?: string | null;
  exportedByName: string;
  exportedAt: Date;
}

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60_000;

/** `YYYY-MM-DD` → `dd/mm/yyyy`. */
export function formatReportDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Thời điểm UTC → `dd/mm/yyyy HH:mm` giờ Việt Nam. */
export function formatReportDateTime(at: Date): string {
  const vn = new Date(at.getTime() + VIETNAM_UTC_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
}

export function formatReportPeriod(from: string, to: string): string {
  return from === to ? `Ngày ${formatReportDate(from)}` : `Từ ${formatReportDate(from)} đến ${formatReportDate(to)}`;
}

/**
 * Ghi đầu báo cáo vào đầu `sheet` và trả về SỐ DÒNG đã dùng (kể cả dòng trống ngăn cách) — nơi gọi ghi tiếp từ dòng `trả về + 1`.
 * Cột 1 chứa chữ; không gộp ô để bảng bên dưới vẫn tự do chia cột.
 */
export function addReportExcelHeader(sheet: Worksheet, header: ReportExcelHeader): number {
  const lines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: header.branchName ? `${header.clinicName} — ${header.branchName}` : header.clinicName, bold: true, size: 12 },
    { text: header.title.toUpperCase(), bold: true, size: 14 },
    { text: formatReportPeriod(header.from, header.to) },
  ];
  if (header.scopeLabel) lines.push({ text: `Phạm vi: ${header.scopeLabel}` });
  lines.push({ text: `Người xuất: ${header.exportedByName} · Lúc: ${formatReportDateTime(header.exportedAt)}` });

  for (const line of lines) {
    const row = sheet.addRow([line.text]);
    row.font = { bold: line.bold ?? false, size: line.size ?? 11 };
  }
  sheet.addRow([]);
  return lines.length + 1;
}
