import { useState } from 'react';
import type { StockReceiptType } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';

export const RECEIPT_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'PURCHASE', label: 'Nhập nhà cung cấp' },
  { value: 'OPENING_BALANCE', label: 'Nhập khởi tạo (Đầu kỳ)' },
  { value: 'RETURN_FROM_USE', label: 'Nhập hoàn trả từ bệnh nhân/khoa phòng' },
];

export interface StockReceiptHeaderValues {
  receiptType: StockReceiptType;
  warehouseId: string;
  supplierId: string;
  supplierInvoiceNo: string;
  occurredAt: string;
  note: string;
}

/**
 * Popup nhập "Thông tin phiếu nhập kho" (Loại phiếu/Kho/NCC/Mã hoá đơn/Ngày nhập/Ghi chú) — tách
 * khỏi `StockReceiptFormPage.tsx` (phản hồi trực tiếp): trước đây các trường này nằm CỐ ĐỊNH dạng ô
 * nhập ngay trên trang, chiếm chiều cao cố định lớn, đẩy khung bảng sản phẩm (khu vực thao tác chính
 * — tìm/thêm/sửa dòng hàng) bị bóp hẹp. Nay tách vào popup: mở lúc "Tạo phiếu" (lần đầu, chưa có gì
 * để hiển thị) hoặc bấm "Sửa" trên dải tóm tắt — trang chính chỉ còn hiện dải tóm tắt gọn, nhường hết
 * không gian còn lại cho khu vực thao tác nhập kho.
 *
 * Đổi "Loại phiếu" khi đã có dòng hàng KHÔNG bị chặn (dữ liệu vẫn an toàn — `buildPayload()` ở trang
 * cha tự lọc field không áp dụng lúc lưu) — chỉ hiện cảnh báo mềm ngay trong popup, không cần thêm 1
 * lớp popup xác nhận lồng nhau nữa vì bản thân việc phải bấm "Sửa" → đổi → "Lưu" đã là 3 bước chủ
 * đích, đủ chống bấm nhầm so với dropdown lộ thiên trước đây.
 */
export function StockReceiptHeaderDialog({
  initial,
  warehouseOptions,
  supplierOptions,
  hasLines,
  allowSimpleClose,
  onCancel,
  onSave,
}: {
  initial: StockReceiptHeaderValues;
  warehouseOptions: ComboboxOption[];
  supplierOptions: ComboboxOption[];
  hasLines: boolean;
  /** false khi đây là lần mở ĐẦU TIÊN lúc tạo phiếu mới (chưa có gì để quay lại xem) — "Huỷ" điều
   * hướng về danh sách thay vì chỉ đóng popup để trống trang phía sau. */
  allowSimpleClose: boolean;
  onCancel: () => void;
  onSave: (values: StockReceiptHeaderValues) => void;
}) {
  const [receiptType, setReceiptType] = useState<StockReceiptType>(initial.receiptType);
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId);
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(initial.supplierInvoiceNo);
  const [occurredAt, setOccurredAt] = useState(initial.occurredAt);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!warehouseId) {
      setError('Phải chọn Kho.');
      return;
    }
    if (receiptType === 'PURCHASE' && !supplierId) {
      setError('Phiếu nhập nhà cung cấp phải chọn Nhà cung cấp.');
      return;
    }
    onSave({ receiptType, warehouseId, supplierId: receiptType === 'PURCHASE' ? supplierId : '', supplierInvoiceNo, occurredAt, note });
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-header-dialog-title">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <p id="receipt-header-dialog-title" className="text-base font-bold text-slate-900">
          Thông tin phiếu nhập kho
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Loại phiếu <span className="text-rose-500">*</span>
            </label>
            <Combobox id="receipt-type" value={receiptType} onChange={(v) => setReceiptType(v as StockReceiptType)} options={RECEIPT_TYPE_OPTIONS} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Kho <span className="text-rose-500">*</span>
            </label>
            <Combobox id="receipt-warehouse" value={warehouseId} onChange={setWarehouseId} placeholder="— Chọn kho —" options={warehouseOptions} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Ngày nhập <span className="text-rose-500">*</span>
            </label>
            <DateInput id="receipt-occurred-at" value={occurredAt} onChange={setOccurredAt} required />
          </div>
          {receiptType === 'PURCHASE' && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-800">
                Nhà cung cấp <span className="text-rose-500">*</span>
              </label>
              <Combobox id="receipt-supplier" value={supplierId} onChange={setSupplierId} placeholder="— Chọn NCC —" options={supplierOptions} />
            </div>
          )}
          {receiptType === 'PURCHASE' && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-800">Mã hoá đơn NCC</label>
              <input
                type="text"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900"
              />
            </div>
          )}
        </div>

        {hasLines && receiptType !== initial.receiptType && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Danh sách hàng đã nhập sẽ được giữ nguyên khi đổi Loại phiếu — các trường không áp dụng cho loại phiếu mới (Nhà cung cấp/Chiết khấu/Thanh toán) sẽ tự bỏ qua lúc lưu.
          </p>
        )}

        <div className="mt-3">
          <label className="mb-1 block text-sm font-semibold text-slate-800">Ghi chú</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900"
          />
        </div>

        {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {allowSimpleClose ? 'Huỷ' : '← Quay lại danh sách'}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}
