import type { LabPartnerOption, LabPartnerPendingRow } from '@nexamed/shared';
import type { ReportPrintSpec } from '../../shared/print/report-print-spec';

/**
 * Phần thuần của hộp "Gửi mẫu đi" (docs/DECISIONS.md #291): chọn MỘT đối tác cho cả đợt, mỗi mẫu áp ĐÚNG giá của cặp (dịch vụ × đối tác).
 * Dòng mà đối tác đang chọn chưa có giá cho dịch vụ đó thì không gửi được (máy chủ cũng trả 422).
 */

export interface PartnerChoice {
  supplierId: string;
  supplierName: string;
}

/** Đối tác của một dòng theo id; `undefined` khi dịch vụ chưa có giá cho đối tác đó. */
export function optionFor(row: LabPartnerPendingRow, supplierId: string): LabPartnerOption | undefined {
  return row.options.find((o) => o.supplierId === supplierId);
}

/** Đối tác mặc định của dòng (đối tác mặc định xếp đầu); `null` khi dịch vụ chưa cấu hình đối tác nào. */
export function defaultOptionOf(row: LabPartnerPendingRow): LabPartnerOption | null {
  return row.options.find((o) => o.isDefault) ?? row.options[0] ?? null;
}

/** Danh sách đối tác để chọn ở hộp: gộp mọi đối tác xuất hiện trong các dòng, theo thứ tự gặp đầu tiên. */
export function partnerChoicesOf(rows: LabPartnerPendingRow[]): PartnerChoice[] {
  const seen = new Map<string, PartnerChoice>();
  for (const row of rows) {
    for (const o of row.options) if (!seen.has(o.supplierId)) seen.set(o.supplierId, { supplierId: o.supplierId, supplierName: o.supplierName });
  }
  return [...seen.values()];
}

/** Đối tác khởi đầu: đối tác mặc định xuất hiện nhiều nhất trong các dòng đã chọn (hoà thì dòng chọn trước thắng); không dòng nào có thì lấy đối tác đầu tiên của danh sách. */
export function initialPartnerId(selectedRows: LabPartnerPendingRow[], choices: PartnerChoice[]): string {
  const tally = new Map<string, number>();
  const order: string[] = [];
  for (const row of selectedRows) {
    const d = defaultOptionOf(row);
    if (!d) continue;
    if (!tally.has(d.supplierId)) order.push(d.supplierId);
    tally.set(d.supplierId, (tally.get(d.supplierId) ?? 0) + 1);
  }
  let best = '';
  for (const id of order) if (best === '' || (tally.get(id) ?? 0) > (tally.get(best) ?? 0)) best = id;
  return best !== '' ? best : (choices[0]?.supplierId ?? '');
}

/** Tập dòng được tích sẵn khi đổi đối tác: giữ những dòng đang tích mà đối tác mới có giá, bỏ phần còn lại. */
export function keepEligible(rows: LabPartnerPendingRow[], checked: ReadonlySet<string>, supplierId: string): Set<string> {
  return new Set(rows.filter((r) => checked.has(r.itemId) && optionFor(r, supplierId)).map((r) => r.itemId));
}

/** Tổng giá trả của các dòng đang tích cho đối tác đã chọn; `null` khi người xem không thấy giá vốn. */
export function totalCost(rows: LabPartnerPendingRow[], checked: ReadonlySet<string>, supplierId: string): number | null {
  let sum = 0;
  for (const r of rows) {
    if (!checked.has(r.itemId)) continue;
    const amount = optionFor(r, supplierId)?.amount;
    if (amount === null || amount === undefined) return null;
    sum += amount;
  }
  return sum;
}

/** Hạn chót giờ gửi: không ở tương lai, không trước giờ lấy mẫu của MỌI dòng đang tích. Trả thông báo lỗi tiếng Việt hoặc `null` khi hợp lệ. */
export function validateSentAt(sentAtIso: string | null, rows: LabPartnerPendingRow[], checked: ReadonlySet<string>, now: number = Date.now()): string | null {
  if (sentAtIso === null) return 'Nhập đủ ngày và giờ gửi mẫu.';
  const sentMs = new Date(sentAtIso).getTime();
  if (sentMs > now + 60_000) return 'Giờ gửi mẫu không được ở tương lai.';
  for (const r of rows) {
    if (!checked.has(r.itemId) || !r.collectedAt) continue;
    if (sentMs < new Date(r.collectedAt).getTime()) return `Giờ gửi không được trước giờ lấy mẫu của ống ${r.tubeSid ?? r.orderNo}.`;
  }
  return null;
}

/**
 * Phiếu giao mẫu (in kèm lúc gửi): danh sách mẫu giao cho MỘT đối tác, hai ô ký (bên giao/bên nhận). KHÔNG in giá trả (giá vốn, đối tác không cần và khách không được thấy).
 */
export function buildDeliverySlipSpec(input: { partnerName: string; sentAtText: string; senderName: string; note: string; rows: LabPartnerPendingRow[] }): ReportPrintSpec {
  return {
    title: 'Phiếu giao mẫu xét nghiệm',
    subtitleLines: [`Đối tác nhận mẫu: ${input.partnerName}`, `Giờ gửi: ${input.sentAtText}${input.senderName ? ` · Người gửi: ${input.senderName}` : ''}`],
    infoLines: [`Tổng số mẫu: ${input.rows.length}${input.note.trim() ? ` · Ghi chú: ${input.note.trim()}` : ''}`],
    sections: [
      {
        columns: [
          { header: 'STT', align: 'center', width: '40px' },
          { header: 'Mã ống', align: 'center', width: '100px' },
          { header: 'Bệnh nhân' },
          { header: 'Mã BN', align: 'center', width: '110px' },
          { header: 'Dịch vụ' },
          { header: 'Loại mẫu', align: 'center', width: '110px' },
        ],
        rows: input.rows.map((r, i) => [String(i + 1), r.tubeSid ?? '', r.patientName, r.patientCode, r.serviceName, r.specimenName ?? '']),
        emptyText: 'Chưa chọn mẫu nào.',
      },
    ],
    signatures: ['Đại diện phòng khám (bên giao)', 'Đại diện đối tác (bên nhận)'],
  };
}

const MAX_RESULT_BYTES = 10 * 1024 * 1024;

/** Kiểm tệp ở máy khách (máy chủ kiểm lại bằng magic-byte): phải là PDF, không rỗng, ≤ 10 MB. Trả thông báo lỗi tiếng Việt hoặc `null`. */
export function validatePdfFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return 'Tệp rỗng, chọn tệp khác.';
  if (file.size > MAX_RESULT_BYTES) return 'Tệp vượt quá 10 MB, chọn tệp nhỏ hơn.';
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'Chỉ nhận tệp PDF.';
  return null;
}

