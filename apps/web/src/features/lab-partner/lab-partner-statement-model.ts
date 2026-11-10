import type { LabPartnerStatementResponse, LabPartnerStatementRow } from '@nexamed/shared';
import { formatDobDisplay } from '../../shared/format/date';
import { formatVndPlain } from '../../shared/format/currency';
import { formatDateTimeVn } from '../../shared/format/time';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';
import type { ReportPrintSpec } from '../../shared/print/report-print-spec';

/** Phần thuần của bảng kê mẫu gửi đối tác (docs/DECISIONS.md #291 GĐ4): nhãn trạng thái, thời gian trả, bản in — có test, không phụ thuộc React. */

/** "5 giờ 50 phút", "6 giờ", "40 phút", "2 ngày 3 giờ"; `null` (chưa nhận kết quả) → "—". */
export function formatTurnaround(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)} ngày ${hours % 24} giờ`;
  if (hours === 0) return `${rest} phút`;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

export interface StatementStateView {
  label: string;
  tone: StatusBadgeTone;
}

/** Đã có kết quả → xanh; chờ kết quả → vàng, quá hạn → đỏ; đối tác không nhận → xám. */
export function statementStateView(row: Pick<LabPartnerStatementRow, 'state' | 'late'>): StatementStateView {
  if (row.state === 'DONE') return { label: 'Đã có kết quả', tone: 'success' };
  if (row.state === 'REJECTED') return { label: 'Không nhận', tone: 'neutral' };
  return row.late ? { label: 'Quá hạn', tone: 'danger' } : { label: 'Chờ kết quả', tone: 'warning' };
}

export type StatementBasis = 'RECEIVED' | 'SENT';
export type StatementStatusFilter = 'ALL' | 'DONE' | 'WAITING' | 'LATE' | 'REJECTED';

export const STATEMENT_STATUS_OPTIONS: { value: StatementStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'DONE', label: 'Đã có kết quả' },
  { value: 'WAITING', label: 'Chờ kết quả' },
  { value: 'LATE', label: 'Quá hạn' },
  { value: 'REJECTED', label: 'Không nhận' },
];

const money = (value: number): string => formatVndPlain(value);

/** Chỉ hiện cột Chi nhánh khi bảng kê có mẫu của từ 2 chi nhánh trở lên (công ty 1 chi nhánh: giao diện không đổi, #231). */
export function statementHasMultipleBranches(rows: readonly Pick<LabPartnerStatementRow, 'branchName'>[]): boolean {
  return new Set(rows.map((r) => r.branchName).filter((n): n is string => !!n)).size > 1;
}

/** Ngày kế tiếp của `YYYY-MM-DD` (cộng một ngày theo lịch, không phụ thuộc múi giờ máy) — đầu kỳ đối chiếu = sau mốc chốt gần nhất. */
export function nextDateString(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function statementPeriodLabel(from: string, to: string, basis: StatementBasis): string {
  const range = from || to ? `Từ ${from ? formatDobDisplay(from) : 'đầu'} đến ${to ? formatDobDisplay(to) : 'nay'}` : 'Toàn bộ lịch sử';
  return `${range} · Tính theo ${basis === 'RECEIVED' ? 'ngày nhận kết quả' : 'ngày gửi'}`;
}

/**
 * Bản in "Bảng kê mẫu xét nghiệm gửi đối tác" (mockup màn 8): mỗi dòng một dịch vụ, dòng Cộng chỉ gồm mẫu ĐÃ CÓ KẾT QUẢ, dưới bảng có số dư đầu kỳ/phát sinh/đã thanh toán/số dư cuối kỳ
 * và hai ô ký (phòng khám, đối tác). Mẫu chờ kết quả hiện "dự kiến" và không cộng; mẫu đối tác không nhận hiện 0.
 */
export function buildLabPartnerStatementPrintSpec(
  data: Pick<LabPartnerStatementResponse, 'items' | 'summary' | 'truncated'>,
  ctx: { supplierCode: string; supplierName: string; from: string; to: string; basis: StatementBasis },
): ReportPrintSpec {
  const { items, summary } = data;
  const showBranch = statementHasMultipleBranches(items);
  const columns = [
    { header: 'STT', width: '34px', align: 'center' as const },
    { header: 'Mã ống', width: '84px', align: 'center' as const },
    { header: 'Bệnh nhân' },
    { header: 'Dịch vụ' },
    ...(showBranch ? [{ header: 'Chi nhánh', width: '84px' }] : []),
    { header: 'Gửi lúc', width: '92px', align: 'center' as const },
    { header: 'Nhận kết quả lúc', width: '92px', align: 'center' as const },
    { header: 'Thời gian trả', width: '78px', align: 'center' as const },
    { header: 'Thành tiền (đ)', width: '86px', align: 'right' as const },
  ];
  const rows = items.map((r, i) => [
    String(i + 1),
    r.tubeSid ?? '—',
    `${r.patientName} (${r.patientCode})`,
    r.serviceName,
    ...(showBranch ? [r.branchName ?? '—'] : []),
    formatDateTimeVn(r.sentAt),
    r.receivedAt ? formatDateTimeVn(r.receivedAt) : r.state === 'REJECTED' ? 'Đối tác không nhận' : 'Chưa có',
    formatTurnaround(r.turnaroundMinutes),
    r.state === 'WAITING' ? `${money(r.amount)} (dự kiến)` : money(r.amount),
  ]);
  const totalColumns = columns.length;
  const totalRow = Array.from({ length: totalColumns }, () => '');
  totalRow[0] = `Cộng ${summary.doneCount} mẫu đã có kết quả`;
  totalRow[totalColumns - 1] = money(summary.doneAmount);

  const notes: string[] = [];
  if (summary.waitingCount > 0) notes.push(`Chờ kết quả (chưa tính vào nợ): ${summary.waitingCount} mẫu, dự kiến ${money(summary.waitingAmount)} đ.`);
  if (summary.rejectedCount > 0) notes.push(`Đối tác không nhận: ${summary.rejectedCount} mẫu, không tính tiền.`);
  if (data.truncated) notes.push('Chỉ in phần đầu của kỳ — thu hẹp khoảng ngày để in đủ.');

  return {
    title: 'Bảng kê mẫu xét nghiệm gửi đối tác',
    subtitleLines: [`Đối tác: ${ctx.supplierName} (${ctx.supplierCode})`, statementPeriodLabel(ctx.from, ctx.to, ctx.basis)],
    infoLines: [`Số dư đầu kỳ: ${money(summary.openingBalance)} · Phát sinh trong kỳ: ${money(summary.periodAccrued)} · Đã thanh toán trong kỳ: ${money(summary.periodPaid)} · Số dư cuối kỳ: ${money(summary.closingBalance)}`],
    sections: [{ columns, rows, totalRows: items.length > 0 ? [totalRow] : undefined, emptyText: 'Không có mẫu nào trong kỳ.' }],
    note: notes.length > 0 ? notes.join(' ') : undefined,
    signatures: ['Đại diện phòng khám', 'Đại diện đối tác'],
  };
}
