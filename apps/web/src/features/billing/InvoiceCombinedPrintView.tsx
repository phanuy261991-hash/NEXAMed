import type { CombinedInvoicePrintResponse, Invoice, InvoiceStatus } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

// Trình duyệt mặc định BỎ nền khi in — nhãn "CHƯA THU" nền đen chữ trắng sẽ biến mất nếu không ép.
const KEEP_BACKGROUND = '[print-color-adjust:exact] [-webkit-print-color-adjust:exact]';

const STATUS_LABEL: Record<Exclude<InvoiceStatus, 'CANCELLED'>, { text: string; className: string }> = {
  PAID: { text: 'ĐÃ THU', className: 'border-slate-800' },
  UNPAID: { text: 'CHƯA THU', className: `border-slate-800 bg-slate-900 text-white ${KEEP_BACKGROUND}` },
  REFUNDED: { text: 'ĐÃ HOÀN TIỀN', className: 'border-dashed border-slate-800' },
};

function groupTitle(invoice: Invoice): string {
  if (invoice.invoiceType === 'SERVICE') {
    return `Dịch vụ khám · ${invoice.invoiceNo}`;
  }
  if (invoice.invoiceType === 'PARACLINICAL') {
    const orderNos = [...new Set(invoice.lines.map((l) => l.clinicalOrderNo).filter((n): n is string => n !== null))];
    return `Cận lâm sàng${orderNos.length > 0 ? ` · Phiếu chỉ định ${orderNos.join(', ')}` : ''} · ${invoice.invoiceNo}`;
  }
  const issueNos = [...new Set(invoice.lines.map((l) => l.stockIssueNo).filter((n): n is string => n !== null))];
  return `Tiền thuốc${issueNos.length > 0 ? ` · Phiếu xuất ${issueNos.join(', ')}` : ''} · ${invoice.invoiceNo}`;
}

function InvoiceGroup({ invoice }: { invoice: Invoice }) {
  const status = invoice.status === 'CANCELLED' ? null : STATUS_LABEL[invoice.status];
  const perLine = invoice.discountMode === 'PER_LINE';
  return (
    <div className="mt-2 break-inside-avoid">
      <div className={`flex items-center justify-between gap-3 border-t-2 border-slate-800 bg-slate-200 px-2 py-1 ${KEEP_BACKGROUND}`}>
        <p className="min-w-0 truncate text-xs font-bold uppercase tracking-wide">{groupTitle(invoice)}</p>
        {status && <span className={`flex-shrink-0 rounded-[3px] border-[1.5px] px-2 text-[11px] font-bold ${status.className}`}>{status.text}</span>}
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-800 text-left">
            <th className="w-7 px-2 py-1">#</th>
            <th className="py-1">Nội dung</th>
            <th className="w-12 py-1 text-center">SL</th>
            <th className="w-24 py-1 text-right">Đơn giá</th>
            {perLine && <th className="w-24 py-1 text-right">Chiết khấu</th>}
            <th className="w-28 px-2 py-1 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="px-2 py-1">{i + 1}</td>
              <td className="py-1 font-semibold">{line.examTypeName}</td>
              <td className="py-1 text-center">{line.quantity}</td>
              <td className="py-1 text-right">{formatVnd(line.unitPrice)}</td>
              {perLine && <td className="py-1 text-right">{line.discountAmount > 0 ? `-${formatVnd(line.discountAmount)}` : '—'}</td>}
              <td className="px-2 py-1 text-right">{formatVnd(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col items-end gap-0.5 px-2 pt-1 text-[13px]">
        {invoice.discountAmount > 0 && (
          <>
            <span>Cộng: {formatVnd(invoice.totalAmount)}</span>
            <span>
              Chiết khấu{invoice.discountMode === 'TOTAL' && invoice.discountType === 'PERCENT' ? ` ${invoice.discountValue}%` : ''}: -{formatVnd(invoice.discountAmount)}
            </span>
          </>
        )}
        <span className="font-bold">Cộng nhóm: {formatVnd(invoice.dueAmount)}</span>
        {/* #203 — phiếu còn "ĐÃ THU" nhưng đã hoàn MỘT PHẦN theo dòng thuốc (phiếu REFUNDED toàn phần đã có nhãn riêng). */}
        {invoice.status === 'PAID' && invoice.refundedAmount > 0 && <span>Đã hoàn tiền thuốc: -{formatVnd(invoice.refundedAmount)}</span>}
      </div>
    </div>
  );
}

/**
 * Bản in "Phiếu thu tổng hợp" — gộp MỌI phiếu thu chưa huỷ của 1 lượt khám thành 1 tờ (mockup đã duyệt 2026-09-30).
 * Không phải hoá đơn mới: chỉ là cách trình bày lúc in, mỗi nhóm giữ nguyên số phiếu + trạng thái của chính nó. Khung/
 * đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `INVOICE_COMBINED` (#211). CHỈ MỘT trong
 * `InvoicePrintView`/view này được render tại một thời điểm (người gọi tự chọn). Nhận dữ liệu qua props.
 */
export function InvoiceCombinedPrintView({
  collectedByName,
  paymentMethodName,
  data,
}: {
  collectedByName: string;
  /** Tên hiển thị của mã phương thức (`reference_catalog` PAYMENT_METHOD) — người gọi truyền vào vì component thuần này không tự tra. */
  paymentMethodName: (code: string) => string;
  data: CombinedInvoicePrintResponse;
}) {
  const { invoices, totals } = data;
  const head = invoices[0];
  if (!head) return null;

  // Chỉ phiếu đã thu (kể cả đã hoàn) mới có dòng thanh toán thật — gộp theo phương thức.
  const byMethod = new Map<string, number>();
  for (const invoice of invoices) {
    for (const p of invoice.payments) {
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
    }
  }

  const summaryRows: { label: string; value: string; strong?: boolean }[] = [{ label: `Tổng cộng (${totals.invoiceCount} phiếu)`, value: formatVnd(totals.grossAmount) }];
  if (totals.discountAmount > 0) {
    summaryRows.push({ label: 'Chiết khấu', value: `-${formatVnd(totals.discountAmount)}` });
  }
  const finalIsPaid = totals.unpaidAmount === 0 && totals.refundedAmount === 0;
  summaryRows.push({ label: 'Tổng đã thu', value: formatVnd(totals.paidAmount), strong: finalIsPaid });
  if (totals.refundedAmount > 0) {
    summaryRows.push({ label: 'Đã hoàn tiền', value: `-${formatVnd(totals.refundedAmount)}` });
    if (totals.unpaidAmount === 0) {
      summaryRows.push({ label: 'Thực thu', value: formatVnd(totals.paidAmount - totals.refundedAmount), strong: true });
    }
  }
  if (totals.unpaidAmount > 0) {
    summaryRows.push({ label: 'Còn phải thu', value: formatVnd(totals.unpaidAmount), strong: true });
  }

  return (
    <PrintDocument
      documentType="INVOICE_COMBINED"
      title="Phiếu thu"
      subtitle={
        <p>
          Số phiếu:{' '}
          {invoices.map((inv, i) => (
            <span key={inv.id}>
              {i > 0 && ' · '}
              <strong>{inv.invoiceNo}</strong>
            </span>
          ))}
        </p>
      }
      signatureDateText={formatPrintDate(new Date().toISOString())}
      signatures={[{ label: 'Người thu', name: collectedByName }]}
    >
      <div className="text-[13px]">
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
          <p>
            Họ tên khách hàng: <strong>{head.fullName}</strong>
          </p>
          <p>
            Mã bệnh nhân: <strong>{head.patientCode}</strong>
          </p>
          <p>
            Mã lượt khám: <strong>{head.encounterNo}</strong>
          </p>
          <p>
            Khoa: <strong>{head.departmentName}</strong>
          </p>
        </div>

        {invoices.map((invoice) => (
          <InvoiceGroup key={invoice.id} invoice={invoice} />
        ))}

        <div className="mt-3 flex justify-between gap-6 border-t-2 border-slate-800 pt-2">
          <div className="flex-1 text-xs">
            {byMethod.size > 0 && (
              <>
                <p className="mb-0.5 font-bold">Thanh toán đã ghi nhận</p>
                {[...byMethod.entries()].map(([method, amount]) => (
                  <p key={method}>
                    {paymentMethodName(method)}: {formatVnd(amount)}
                  </p>
                ))}
              </>
            )}
          </div>
          <div className="flex w-72 flex-col gap-0.5">
            {summaryRows.map((row) => (
              <div key={row.label} className={`flex justify-between ${row.strong ? 'mt-1 border-t border-slate-800 pt-1 text-base font-bold' : ''}`}>
                <span>{row.label}</span>
                <span className={row.strong ? '' : 'font-semibold'}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PrintDocument>
  );
}
