import { useState } from 'react';
import type { ManualStockIssueType } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { useStockReceiptsQuery } from './inventory.queries';

export const ISSUE_TYPE_OPTIONS: { value: ManualStockIssueType; label: string }[] = [
  { value: 'INTERNAL_ALLOCATION', label: 'Xuất dùng nội bộ' },
  { value: 'RETURN_TO_SUPPLIER', label: 'Xuất trả nhà cung cấp' },
  { value: 'WRITE_OFF', label: 'Xuất huỷ (hỏng/hết hạn)' },
];

export interface StockIssueHeaderValues {
  issueType: ManualStockIssueType;
  warehouseId: string;
  departmentId: string;
  supplierId: string;
  sourceReceiptId: string;
  occurredAt: string;
  note: string;
}

/**
 * Popup nhập "Thông tin phiếu xuất kho" — tách khỏi `StockIssueFormPage.tsx` (đúng mẫu đã áp dụng
 * cho `StockReceiptHeaderDialog.tsx`, phản hồi trực tiếp: chuyển toàn bộ trường header cố định sang
 * popup để nhường không gian cho khu vực tìm/thêm dòng hàng). "Phiếu nhập gốc" phụ thuộc "Nhà cung
 * cấp" đang chọn CỤC BỘ trong popup nên tự gọi `useStockReceiptsQuery` ở đây (không nhận qua props).
 */
export function StockIssueHeaderDialog({
  initial,
  warehouseOptions,
  departmentOptions,
  supplierOptions,
  warehouseLocked,
  allowSimpleClose,
  onCancel,
  onSave,
}: {
  initial: StockIssueHeaderValues;
  warehouseOptions: ComboboxOption[];
  departmentOptions: ComboboxOption[];
  supplierOptions: ComboboxOption[];
  /** `true` khi phiếu đã có dòng hàng — Kho xuất không đổi được nữa (lô/tồn đã tra theo đúng kho cũ). */
  warehouseLocked: boolean;
  allowSimpleClose: boolean;
  onCancel: () => void;
  onSave: (values: StockIssueHeaderValues) => void;
}) {
  const [issueType, setIssueType] = useState<ManualStockIssueType>(initial.issueType);
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId);
  const [departmentId, setDepartmentId] = useState(initial.departmentId);
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [sourceReceiptId, setSourceReceiptId] = useState(initial.sourceReceiptId);
  const [occurredAt, setOccurredAt] = useState(initial.occurredAt);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);

  const isReturnToSupplier = issueType === 'RETURN_TO_SUPPLIER';
  const sourceReceiptsQuery = useStockReceiptsQuery({ supplierId, receiptType: 'PURCHASE', status: 'POSTED', limit: 50 }, isReturnToSupplier && supplierId !== '');

  function handleSupplierChange(next: string) {
    setSupplierId(next);
    setSourceReceiptId('');
  }

  function handleSubmit() {
    if (!warehouseId) {
      setError('Phải chọn Kho xuất.');
      return;
    }
    if (issueType === 'INTERNAL_ALLOCATION' && !departmentId) {
      setError('Phiếu "Xuất dùng nội bộ" phải chọn Khoa/Phòng tiếp nhận.');
      return;
    }
    if (issueType === 'RETURN_TO_SUPPLIER' && !supplierId) {
      setError('Phiếu "Xuất trả nhà cung cấp" phải chọn Nhà cung cấp.');
      return;
    }
    if (!note.trim()) {
      setError('Phải nhập Lý do.');
      return;
    }
    onSave({
      issueType,
      warehouseId,
      departmentId: issueType === 'INTERNAL_ALLOCATION' ? departmentId : '',
      supplierId: issueType === 'RETURN_TO_SUPPLIER' ? supplierId : '',
      sourceReceiptId: issueType === 'RETURN_TO_SUPPLIER' ? sourceReceiptId : '',
      occurredAt,
      note: note.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="issue-header-dialog-title">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <p id="issue-header-dialog-title" className="text-base font-bold text-slate-900">
          Thông tin phiếu xuất kho
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Loại phiếu xuất <span className="text-rose-500">*</span>
            </label>
            <Combobox id="issue-type" value={issueType} onChange={(v) => setIssueType(v as ManualStockIssueType)} options={ISSUE_TYPE_OPTIONS} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Kho xuất <span className="text-rose-500">*</span>
            </label>
            <Combobox id="issue-warehouse" value={warehouseId} disabled={warehouseLocked} onChange={setWarehouseId} placeholder="— Chọn kho —" options={warehouseOptions} />
            {warehouseLocked && <p className="mt-1 text-xs text-slate-400">Đã có dòng hàng — không đổi được Kho xuất.</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Ngày xuất <span className="text-rose-500">*</span>
            </label>
            <DateInput id="issue-occurred-at" value={occurredAt} onChange={setOccurredAt} required />
          </div>
          {issueType === 'INTERNAL_ALLOCATION' && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-800">
                Khoa/Phòng tiếp nhận <span className="text-rose-500">*</span>
              </label>
              <Combobox id="issue-department" value={departmentId} onChange={setDepartmentId} placeholder="— Chọn Khoa/Phòng —" options={departmentOptions} />
            </div>
          )}
          {isReturnToSupplier && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-800">
                  Nhà cung cấp <span className="text-rose-500">*</span>
                </label>
                <Combobox id="issue-supplier" value={supplierId} onChange={handleSupplierChange} placeholder="— Chọn nhà cung cấp —" options={supplierOptions} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-800">Phiếu nhập gốc (tuỳ chọn)</label>
                <Combobox
                  id="issue-source-receipt"
                  value={sourceReceiptId}
                  disabled={!supplierId}
                  onChange={setSourceReceiptId}
                  placeholder={supplierId ? '— Không chọn —' : '— Chọn Nhà cung cấp trước —'}
                  options={(sourceReceiptsQuery.data?.items ?? []).map((r) => ({ value: r.id, label: `${r.receiptNo} · ${r.occurredAt.slice(0, 10).split('-').reverse().join('/')}` }))}
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Lý do <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Vd: cấp phát vật tư sát khuẩn tuần này..."
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
