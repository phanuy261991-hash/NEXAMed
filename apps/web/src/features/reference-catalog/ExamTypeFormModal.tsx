import { useMemo, useState } from 'react';
import { Plus, Trash, Warning, X } from '@phosphor-icons/react';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { SearchableCombobox } from '../../shared/ui/SearchableCombobox';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Textarea } from '../../shared/ui/Textarea';
import { Button } from '../../shared/ui/Button';
import { formatVnd } from '../../shared/format/currency';
import { useReferenceCatalogQuery } from './reference-catalog.queries';
import type { ExamTypePriceInput, ReferenceCatalogItem } from '@nexamed/shared';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

function makeDraftId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Math.random().toString(36).slice(2)}`;
}

interface PriceDraftRow extends ExamTypePriceInput {
  draftId: string;
}

/** `effectiveTo` bỏ trống = vô thời hạn — coi như hiệu lực tới hết thời gian khi so trùng lấn. */
function rangesOverlap(aFrom: string, aTo: string | undefined, bFrom: string, bTo: string | undefined): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/**
 * Modal Thêm mới/Sửa "Dịch vụ khám" (category EXAM_TYPE, reference_catalog) — RIÊNG khỏi
 * `ReferenceCatalogPane`'s `ItemFormModal` dùng chung (docs/DECISIONS.md #079): duy nhất category
 * này có khối "Đơn giá dịch vụ" — danh sách nhiều dòng đơn giá (Loại giá dịch vụ × Đơn vị tính ×
 * khoảng ngày hiệu lực), quản lý như bản nháp cục bộ (thêm/xoá dòng) rồi gửi TOÀN BỘ mảng lúc bấm
 * "Lưu" — bulk-replace ở server trong CÙNG transaction tạo/sửa dịch vụ (đúng khuôn `PUT
 * .../diagnoses`). Mockup duyệt qua nhiều vòng chỉnh (bố cục 2 khối, combobox tìm kiếm cho "Đơn vị
 * tính", label cố định — không dùng label nổi) trước khi code.
 */
export function ExamTypeFormModal({
  mode,
  item,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: ReferenceCatalogItem;
  submitting: boolean;
  submitError?: string;
  onCancel: () => void;
  onSubmit: (dto: { name: string; sortOrder: number; isActive: boolean; description?: string; examTypePrices: ExamTypePriceInput[] }) => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [description, setDescription] = useState(item?.description ?? '');
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);
  const [rows, setRows] = useState<PriceDraftRow[]>((item?.prices ?? []).map((p) => ({ ...p, draftId: makeDraftId() })));

  // Hàng nhập "thêm dòng đơn giá mới" — tách khỏi state của các dòng đã thêm ở trên.
  const [draftPriceType, setDraftPriceType] = useState('');
  const [draftAmount, setDraftAmount] = useState<number | undefined>(undefined);
  const [draftUnit, setDraftUnit] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  const priceTypeQuery = useReferenceCatalogQuery('PRICE_TYPE');
  const unitQuery = useReferenceCatalogQuery('UNIT');
  const priceTypeOptions: ComboboxOption[] = useMemo(
    () => (priceTypeQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    [priceTypeQuery.data],
  );
  const unitOptions: ComboboxOption[] = useMemo(() => (unitQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })), [unitQuery.data]);
  const priceTypeLabel = useMemo(() => new Map(priceTypeOptions.map((o) => [o.value, o.label])), [priceTypeOptions]);
  const unitLabel = useMemo(() => new Map(unitOptions.map((o) => [o.value, o.label])), [unitOptions]);

  const isNameInvalid = name.trim() === '';

  function resetDraftRowInputs() {
    setDraftPriceType('');
    setDraftAmount(undefined);
    setDraftUnit('');
    setDraftFrom('');
    setDraftTo('');
  }

  function handleAddRow() {
    setRowError(null);
    if (draftPriceType === '' || draftAmount === undefined || draftUnit === '' || draftFrom === '') {
      setRowError('Vui lòng nhập đủ Loại giá dịch vụ, Đơn giá, Đơn vị tính và Ngày hiệu lực (bắt buộc).');
      return;
    }
    if (draftTo !== '' && draftTo < draftFrom) {
      setRowError('Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực.');
      return;
    }
    const clash = rows.some((r) => r.priceTypeCode === draftPriceType && rangesOverlap(draftFrom, draftTo || undefined, r.effectiveFrom, r.effectiveTo));
    if (clash) {
      setRowError(`Đã có dòng "${priceTypeLabel.get(draftPriceType) ?? draftPriceType}" trùng khoảng ngày hiệu lực — mỗi Loại giá dịch vụ chỉ được 1 mức giá hiệu lực tại một thời điểm.`);
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        draftId: makeDraftId(),
        priceTypeCode: draftPriceType,
        amount: draftAmount,
        unitCode: draftUnit,
        effectiveFrom: draftFrom,
        effectiveTo: draftTo || undefined,
      },
    ]);
    resetDraftRowInputs();
  }

  function removeRow(draftId: string) {
    setRows((prev) => prev.filter((r) => r.draftId !== draftId));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isNameInvalid) return;
    onSubmit({
      name: name.trim(),
      sortOrder,
      isActive,
      description: description.trim() !== '' ? description.trim() : undefined,
      examTypePrices: rows.map(({ draftId: _draftId, ...rest }) => rest),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 py-8" role="dialog" aria-modal="true" aria-labelledby="exam-type-modal-title">
      <form className="w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl" onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="exam-type-modal-title" className="text-[16px] font-bold text-slate-900">
              {mode === 'create' ? 'Thêm mới Dịch vụ khám' : 'Sửa Dịch vụ khám'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Danh mục Chuyên môn · Dịch vụ khám</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Đóng"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="flex max-h-[72vh] flex-col gap-7 overflow-y-auto p-6">
          {/* Nhóm 1: Thông tin dịch vụ khám bệnh */}
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Thông tin Dịch vụ khám bệnh</span>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-code" className="text-sm font-semibold text-slate-800">
                  Mã
                </label>
                <input id="et-code" value={item?.code ?? ''} readOnly placeholder="Tự động" className={`${inputClassName} bg-slate-50 text-slate-800`} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <label htmlFor="et-name" className="text-sm font-semibold text-slate-800">
                  Tên dịch vụ <span className="text-rose-500">*</span>
                </label>
                <input id="et-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Khám tổng quát" className={inputClassName} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-status" className="text-sm font-semibold text-slate-800">
                  Trạng thái <span className="text-rose-500">*</span>
                </label>
                <select id="et-status" value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')} className={`${inputClassName} cursor-pointer`}>
                  <option value="1">Đang sử dụng</option>
                  <option value="0">Ngưng sử dụng</option>
                </select>
              </div>

              <div className="col-span-2 sm:col-span-4">
                <Textarea
                  id="et-description"
                  label="Mô tả"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ghi chú thêm về dịch vụ (tuỳ chọn)..."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-sort-order" className="text-sm font-semibold text-slate-800">
                  Thứ tự hiển thị
                </label>
                <input id="et-sort-order" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className={inputClassName} />
              </div>
            </div>
          </div>

          {/* Nhóm 2: Đơn giá dịch vụ */}
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Đơn giá dịch vụ</span>

            <div className="grid grid-cols-2 items-end gap-3 border-b border-slate-200 pb-5 sm:grid-cols-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-800">
                  Loại giá dịch vụ <span className="text-rose-500">*</span>
                </label>
                <SearchableCombobox id="et-price-type" value={draftPriceType} onChange={setDraftPriceType} options={priceTypeOptions} placeholder="Chọn loại giá..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-amount" className="text-sm font-semibold text-slate-800">
                  Đơn giá <span className="text-rose-500">*</span>
                </label>
                <MoneyInput id="et-amount" value={draftAmount} onChange={setDraftAmount} className={inputClassName} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-800">
                  Đơn vị tính <span className="text-rose-500">*</span>
                </label>
                <SearchableCombobox id="et-unit" value={draftUnit} onChange={setDraftUnit} options={unitOptions} placeholder="Chọn đơn vị..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-from" className="text-sm font-semibold text-slate-800">
                  Ngày hiệu lực <span className="text-rose-500">*</span>
                </label>
                <input id="et-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className={inputClassName} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="et-to" className="text-sm font-semibold text-slate-800">
                  Ngày kết thúc
                </label>
                <input id="et-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className={inputClassName} />
              </div>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-md border border-dashed border-blue-400 bg-blue-50 px-4 text-sm font-bold text-blue-600 hover:bg-blue-100"
              >
                <Plus size={14} weight="bold" aria-hidden="true" />
                Thêm
              </button>
            </div>

            {rowError && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
                <Warning size={15} weight="fill" className="flex-none" aria-hidden="true" />
                {rowError}
              </div>
            )}

            <div className="mt-4 min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="scroll-hover overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                      <th className="px-4 py-2.5 text-left">Loại giá dịch vụ</th>
                      <th className="px-4 py-2.5 text-center">Đơn giá</th>
                      <th className="px-4 py-2.5 text-center">Đơn vị tính</th>
                      <th className="px-4 py-2.5 text-center">Ngày hiệu lực</th>
                      <th className="px-4 py-2.5 text-center">Ngày kết thúc</th>
                      <th className="w-12 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center font-medium italic text-slate-400">
                          Không có đơn giá dịch vụ
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.draftId} className="border-b border-slate-200 last:border-0">
                          <td className="px-4 py-2 text-left font-semibold text-slate-900">{priceTypeLabel.get(row.priceTypeCode) ?? row.priceTypeCode}</td>
                          <td className="px-4 py-2 text-center font-bold text-slate-900">{formatVnd(row.amount)}</td>
                          <td className="px-4 py-2 text-center font-medium text-slate-600">{unitLabel.get(row.unitCode) ?? row.unitCode}</td>
                          <td className="px-4 py-2 text-center font-medium text-slate-600">{row.effectiveFrom}</td>
                          <td className="px-4 py-2 text-center font-medium text-slate-600">{row.effectiveTo ?? '—'}</td>
                          <td className="px-4 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeRow(row.draftId)}
                              aria-label="Xoá dòng"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash size={15} weight="regular" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {submitError && (
            <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              <Warning size={18} weight="fill" className="flex-none" aria-hidden="true" />
              {submitError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={isNameInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}