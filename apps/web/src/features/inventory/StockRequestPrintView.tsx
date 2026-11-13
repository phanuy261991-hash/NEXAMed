import type { StockRequestDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatDayVn, REQUEST_LINE_STATUS_META, REQUEST_PRIORITY_LABEL, REQUEST_STATUS_META } from './stock-request-meta';

/**
 * Bản in "Phiếu yêu cầu cấp hàng" (docs/DECISIONS.md #298) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `STOCK_REQUEST` (#211); file này chỉ giữ phần THÂN.
 * Đầu phiếu theo chi nhánh của BÊN XIN. Không in giá vốn/thành tiền; tồn của bên xin chỉ là số lượng chụp lúc gửi. Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockRequestPrintView({ request }: { request: StockRequestDetail }) {
  const crossBranch = request.requestingBranchId !== request.supplyingBranchId;
  const place = (branch: string, warehouse: string) => (crossBranch ? `${branch} / ${warehouse}` : warehouse);

  return (
    <PrintDocument
      documentType="STOCK_REQUEST"
      branchId={request.requestingBranchId}
      title="Phiếu yêu cầu cấp hàng"
      subtitle={
        <p>
          Số: <strong>{request.requestNo}</strong>
        </p>
      }
      signatures={[
        { label: 'Người lập phiếu', name: request.createdByName },
        { label: 'Trưởng phòng', name: null },
        { label: 'Thủ kho cấp', name: request.acceptedByName },
        { label: 'Người nhận hàng', name: null },
      ]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Kho xin: <strong>{place(request.requestingBranchName, request.requestingWarehouseName)}</strong>
        </p>
        <p>
          Kho cấp: <strong>{place(request.supplyingBranchName, request.supplyingWarehouseName)}</strong>
        </p>
        <p>
          Ngày lập: <strong>{formatPrintDate(request.createdAt)}</strong>
        </p>
        <p>
          Mức khẩn: <strong>{REQUEST_PRIORITY_LABEL[request.priority]}</strong>
        </p>
        <p>
          Ngày cần hàng: <strong>{request.neededBy ? formatDayVn(request.neededBy) : '—'}</strong>
        </p>
        <p>
          Trạng thái: <strong>{REQUEST_STATUS_META[request.status].label}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-10 py-1.5">STT</th>
            <th className="py-1.5">Mặt hàng</th>
            <th className="w-16 py-1.5">ĐVT</th>
            <th className="w-20 py-1.5 text-right">Tồn lúc gửi</th>
            <th className="w-16 py-1.5 text-right">Số xin</th>
            <th className="w-16 py-1.5 text-right">Số cấp</th>
            <th className="py-1.5 text-left">Tình trạng / ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {request.lines.map((line, i) => {
            const note = [REQUEST_LINE_STATUS_META[line.displayStatus].label, line.decisionReason, line.withdrawReason, line.lineNote].filter(Boolean).join(': ');
            return (
              <tr key={line.id} className="border-b border-slate-300 align-top">
                <td className="py-1.5">{i + 1}</td>
                <td className="py-1.5 font-semibold">
                  {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
                </td>
                <td className="py-1.5">{line.unitCode ?? ''}</td>
                <td className="py-1.5 text-right">{line.requesterStockSnapshot ?? '—'}</td>
                <td className="py-1.5 text-right">{line.requestedQty}</td>
                <td className="py-1.5 text-right">{line.allocatedQty}</td>
                <td className="py-1.5">{note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {request.note && (
        <p className="mt-3">
          <span className="font-semibold">Ghi chú phiếu:</span> {request.note}
        </p>
      )}
      {request.rejectionReason && (
        <p className="mt-1">
          <span className="font-semibold">Lý do từ chối:</span> {request.rejectionReason}
        </p>
      )}
    </PrintDocument>
  );
}
