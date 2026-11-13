import type { PurchaseOrderDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatVnd } from '../../shared/format/currency';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { formatDayVn } from './stock-request-meta';

/**
 * Bản in "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `PURCHASE_ORDER` (#211); file này chỉ giữ phần THÂN.
 * Đầu phiếu theo chi nhánh của KHO NHẬN. Đơn giá là giá DỰ KIẾN (không phải giá vốn). Nhận dữ liệu qua props, không tự gọi API.
 */
export function PurchaseOrderPrintView({ order }: { order: PurchaseOrderDetail }) {
  const unitNameByCode = useUnitNameByCode();
  const hasPrices = order.lines.some((l) => l.expectedUnitCost !== null);

  return (
    <PrintDocument
      documentType="PURCHASE_ORDER"
      branchId={order.branchId}
      title="Đơn đặt hàng nhà cung cấp"
      subtitle={
        <p>
          Số: <strong>{order.orderNo}</strong>
        </p>
      }
      signatures={[
        { label: 'Người lập đơn', name: order.createdByName },
        { label: order.requiresMainApproval ? 'Người duyệt (chi nhánh chính)' : 'Người duyệt', name: order.approvedByName },
        { label: 'Nhà cung cấp xác nhận', name: null },
        { label: 'Kế toán', name: null },
      ]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Nhà cung cấp: <strong>{order.supplierName}</strong>
        </p>
        <p>
          Kho nhận: <strong>{order.warehouseName}</strong>
        </p>
        <p>
          Ngày lập: <strong>{formatPrintDate(order.createdAt)}</strong>
        </p>
        <p>
          Giao dự kiến: <strong>{order.expectedDate ? formatDayVn(order.expectedDate) : '—'}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên hàng</th>
            <th className="w-16 py-1.5">ĐVT</th>
            <th className="w-20 py-1.5 text-right">Số lượng</th>
            {hasPrices && <th className="w-28 py-1.5 text-right">Đơn giá dự kiến</th>}
            {hasPrices && <th className="w-28 py-1.5 text-right">Thành tiền</th>}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">
                {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
                {line.lineNote && <span className="block text-xs font-normal text-slate-600">{line.lineNote}</span>}
              </td>
              <td className="py-1.5">{unitLabel(unitNameByCode, line.unitCode)}</td>
              <td className="py-1.5 text-right">{line.quantity}</td>
              {hasPrices && <td className="py-1.5 text-right">{line.expectedUnitCost !== null ? formatVnd(line.expectedUnitCost) : ''}</td>}
              {hasPrices && <td className="py-1.5 text-right">{line.expectedUnitCost !== null ? formatVnd(line.lineAmount) : ''}</td>}
            </tr>
          ))}
        </tbody>
        {hasPrices && (
          <tfoot>
            <tr>
              <td colSpan={5} className="py-1.5 text-right font-semibold">
                Tổng dự kiến
              </td>
              <td className="py-1.5 text-right font-semibold">{formatVnd(order.totalAmount)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {order.note && (
        <p className="mt-3">
          <span className="font-semibold">Điều khoản / ghi chú:</span> {order.note}
        </p>
      )}
    </PrintDocument>
  );
}
