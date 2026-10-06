import type { Invoice } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

/**
 * Bản in phiếu thu (BIL-02) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `INVOICE` ("Quản lý
 * mẫu in", docs/DECISIONS.md #211): A4/A5 in bảng dịch vụ; K80 (máy in nhiệt) xếp mỗi dịch vụ thành 2 dòng, 1 cột.
 * Không có chữ ký số (phiếu thu không phải hồ sơ lâm sàng, không thuộc phạm vi Thông tư 46) — chỉ ghi tên người thu.
 * Nhận dữ liệu qua props, không tự gọi API.
 */
export function InvoicePrintView({
  collectedByName,
  paymentMethodLabel,
  invoice,
}: {
  collectedByName: string;
  /** Tên hiển thị đã resolve từ mã `reference_catalog` category PAYMENT_METHOD (không tự tra ở component thuần này). */
  paymentMethodLabel: string;
  invoice: Invoice;
}) {
  const perLine = invoice.discountMode === 'PER_LINE';
  return (
    <PrintDocument
      documentType="INVOICE"
      title="Phiếu thu"
      subtitle={
        <p>
          Số: <strong>{invoice.invoiceNo}</strong>
        </p>
      }
      signatureDateText={formatPrintDate(invoice.paidAt ?? new Date().toISOString())}
      signatures={[{ label: 'Người thu', name: collectedByName }]}
    >
      {({ compact }) => (
        <>
          <div className={`mt-4 grid gap-y-1 ${compact ? 'grid-cols-1' : 'grid-cols-2 gap-x-6'}`}>
            <p>
              Họ tên khách hàng: <strong>{invoice.fullName}</strong>
            </p>
            <p>
              Mã bệnh nhân: <strong>{invoice.patientCode}</strong>
            </p>
            <p>
              Mã lượt khám: <strong>{invoice.encounterNo}</strong>
            </p>
            <p>
              Khoa: <strong>{invoice.departmentName}</strong>
            </p>
          </div>

          {compact ? (
            <div className="mt-3 border-t border-dashed border-slate-500">
              {invoice.lines.map((line) => (
                <div key={line.id} className="border-b border-dashed border-slate-300 py-1">
                  <p className="font-semibold">{line.examTypeName}</p>
                  <div className="flex justify-between">
                    <span>
                      {line.quantity} × {formatVnd(line.unitPrice)}
                    </span>
                    <span>{formatVnd(line.lineTotal)}</span>
                  </div>
                  {perLine && line.discountAmount > 0 && <p className="text-right">Chiết khấu: -{formatVnd(line.discountAmount)}</p>}
                </div>
              ))}
            </div>
          ) : (
            // Cột "Chiết khấu" CHỈ hiện khi mode PER_LINE (từng dòng có mức riêng), ẩn hẳn cho mọi phiếu không dùng tính năng này.
            <table className="mt-6 w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-800 text-left">
                  <th className="w-8 py-1.5">#</th>
                  <th className="py-1.5">Dịch vụ</th>
                  <th className="w-16 py-1.5 text-center">SL</th>
                  <th className="w-24 py-1.5 text-right">Đơn giá</th>
                  <th className="w-28 py-1.5 text-right">Thành tiền</th>
                  {perLine && <th className="w-24 py-1.5 text-right">Chiết khấu</th>}
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, i) => (
                  <tr key={line.id} className="border-b border-slate-300 align-top">
                    <td className="py-1.5">{i + 1}</td>
                    <td className="py-1.5 font-semibold">{line.examTypeName}</td>
                    <td className="py-1.5 text-center">{line.quantity}</td>
                    <td className="py-1.5 text-right">{formatVnd(line.unitPrice)}</td>
                    <td className="py-1.5 text-right">{formatVnd(line.lineTotal)}</td>
                    {perLine && <td className="py-1.5 text-right">{line.discountAmount > 0 ? `-${formatVnd(line.discountAmount)}` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className={`mt-3 flex flex-col items-end gap-1 pt-2 ${compact ? 'border-t border-dashed border-slate-500' : 'border-t-2 border-slate-800'}`}>
            <span>Tạm tính: {formatVnd(invoice.totalAmount)}</span>
            {invoice.discountAmount > 0 && (
              <span>
                Chiết khấu{invoice.discountMode === 'TOTAL' && invoice.discountType === 'PERCENT' ? ` (${invoice.discountValue}%)` : ''}: -{formatVnd(invoice.discountAmount)}
              </span>
            )}
            <span className="text-base font-bold">Cần thu: {formatVnd(invoice.dueAmount)}</span>
            {/* #203 — hoàn tiền (một phần theo dòng thuốc, hoặc toàn phần khi huỷ lượt khám): in đủ để khách đối chiếu số đã trả với số thực thu. */}
            {invoice.refundedAmount > 0 && (
              <>
                <span>Đã hoàn tiền: -{formatVnd(invoice.refundedAmount)}</span>
                <span className="text-base font-bold">Thực thu: {formatVnd(invoice.dueAmount - invoice.refundedAmount)}</span>
              </>
            )}
          </div>
          {invoice.refunds.length > 0 && (
            <div className="mt-2 text-xs">
              {invoice.refunds.map((r) => (
                <p key={r.id}>
                  {r.refundNo}: {r.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')} (-{formatVnd(r.totalAmount)})
                </p>
              ))}
            </div>
          )}

          <p className="mt-2">
            Phương thức: <strong>{paymentMethodLabel}</strong>
          </p>
        </>
      )}
    </PrintDocument>
  );
}
