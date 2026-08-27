import type { Invoice } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  return `Ngày ${String(d.getDate()).padStart(2, '0')} tháng ${String(d.getMonth() + 1).padStart(2, '0')} năm ${d.getFullYear()}`;
}

/**
 * Bố cục in phiếu thu (BIL-02) — dùng chung hạ tầng in với PRE-04 (`.print-area`/`@media print`,
 * `apps/web/src/app/index.css`), tái dùng đúng khuôn `PrescriptionPrintView.tsx`. Không có chữ ký
 * số (phiếu thu không phải hồ sơ lâm sàng, không thuộc phạm vi Thông tư 46) — chỉ ghi tên người
 * thu. Nhận dữ liệu qua props, không tự gọi API.
 */
export function InvoicePrintView({
  clinicName,
  clinicAddress,
  clinicPhone,
  printLogoUrl,
  collectedByName,
  paymentMethodLabel,
  invoice,
}: {
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  printLogoUrl: string | null;
  collectedByName: string;
  /** Tên hiển thị đã resolve từ mã `reference_catalog` category PAYMENT_METHOD (không tự tra ở component thuần này). */
  paymentMethodLabel: string;
  invoice: Invoice;
}) {
  return (
    <div className="print-area hidden bg-white p-10 text-slate-900 print:block">
      <div className="flex items-center gap-4 border-b-2 border-slate-800 pb-3">
        {printLogoUrl && <img src={printLogoUrl} alt="" className="h-16 w-16 object-contain" />}
        <div>
          <p className="text-lg font-bold uppercase">{clinicName}</p>
          {clinicAddress && <p className="text-sm">Địa chỉ: {clinicAddress}</p>}
          {clinicPhone && <p className="text-sm">Điện thoại: {clinicPhone}</p>}
        </div>
      </div>

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Phiếu thu</h1>
      <p className="text-center text-sm">
        Số: <strong>{invoice.invoiceNo}</strong>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
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

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Dịch vụ</th>
            <th className="w-16 py-1.5 text-center">SL</th>
            <th className="w-24 py-1.5 text-right">Đơn giá</th>
            <th className="w-28 py-1.5 text-right">Thành tiền</th>
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
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end border-t-2 border-slate-800 pt-2 text-base font-bold">
        <span>Tổng cộng: {formatVnd(invoice.totalAmount)}</span>
      </div>

      <p className="mt-2 text-sm">Phương thức: <strong>{paymentMethodLabel}</strong></p>

      <div className="mt-10 flex justify-end">
        <div className="text-center text-sm">
          <p>{formatPrintDate(invoice.paidAt ?? new Date().toISOString())}</p>
          <p className="mt-1 font-semibold">Người thu</p>
          <p className="mt-16 font-semibold">{collectedByName}</p>
        </div>
      </div>
    </div>
  );
}
