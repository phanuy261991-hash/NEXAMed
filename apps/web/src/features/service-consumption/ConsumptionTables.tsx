import { Trash } from '@phosphor-icons/react';
import type { ConsumptionRecordLine, DrugItemType } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { removeDraftLine, updateDraftQuantity, type ConsumptionDraftLine } from './consumption-model';

const TH = 'px-2 py-2.5 text-center';
const HEAD_ROW = 'border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800';

function ItemTypeBadge({ itemType }: { itemType: DrugItemType }) {
  return itemType === 'SUPPLY' ? <StatusBadge tone="info">Vật tư</StatusBadge> : <StatusBadge tone="success">Thuốc</StatusBadge>;
}

function ItemCell({ name, code }: { name: string; code: string }) {
  return (
    <td className="px-2.5 py-2.5 text-left">
      <div className="font-semibold text-slate-900">{name}</div>
      <div className="text-xs text-slate-500">{code}</div>
    </td>
  );
}

/**
 * Bảng vật tư/thuốc ĐANG SOẠN (định mức hoặc vật tư đã dùng chưa lưu). `showLot` thêm cột Lô với chữ "Tự chọn theo hạn dùng" — lô do máy chủ chọn
 * lúc lưu (FEFO), người dùng không chọn tay. Số lượng luôn theo đơn vị CƠ SỞ của mặt hàng.
 */
export function ConsumptionDraftTable({
  lines,
  onChange,
  disabled,
  showLot,
  emptyText,
  idPrefix,
}: {
  lines: ConsumptionDraftLine[];
  onChange: (lines: ConsumptionDraftLine[]) => void;
  disabled?: boolean;
  showLot?: boolean;
  emptyText: string;
  /** Tiền tố id ô số lượng (nhiều bảng cùng trang). */
  idPrefix: string;
}) {
  const unitNameByCode = useUnitNameByCode();
  const colSpan = showLot ? 6 : 5;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className={HEAD_ROW}>
            <th className="px-2.5 py-2.5 text-left">Vật tư / thuốc</th>
            <th className={`${TH} w-24`}>Loại</th>
            {showLot && <th className={`${TH} w-52`}>Lô</th>}
            <th className={`${TH} w-28`}>Số lượng</th>
            <th className={`${TH} w-24`}>Đơn vị</th>
            <th className="w-14 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center font-medium italic text-slate-400">
                {emptyText}
              </td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.drugId} className="border-b border-slate-100 last:border-0">
              <ItemCell name={l.drugName} code={l.drugCode} />
              <td className="px-2 py-2.5 text-center">
                <ItemTypeBadge itemType={l.itemType} />
              </td>
              {showLot && <td className="px-2 py-2.5 text-center text-slate-600">Tự chọn theo hạn dùng</td>}
              <td className="px-2 py-2.5 text-center">
                <input
                  id={`${idPrefix}-qty-${l.drugId}`}
                  type="text"
                  inputMode="numeric"
                  aria-label={`Số lượng ${l.drugName}`}
                  disabled={disabled}
                  value={l.quantity}
                  onChange={(e) => onChange(updateDraftQuantity(lines, l.drugId, e.target.value))}
                  // Bảng này nằm trong form của màn chứa nó (vd. "Duyệt & trả kết quả"): Enter ở ô số lượng không được gửi form đó.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-center text-[15px] font-normal tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                />
              </td>
              <td className="px-2 py-2.5 text-center text-slate-700">{l.baseUnitCode ? unitLabel(unitNameByCode, l.baseUnitCode) : '—'}</td>
              <td className="px-2 py-2.5 text-center">
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(removeDraftLine(lines, l.drugId))}
                    aria-label={`Xoá ${l.drugName}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100"
                  >
                    <Trash size={14} aria-hidden="true" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatExpiry(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/**
 * Bảng vật tư/thuốc ĐÃ GHI (chỉ đọc): mỗi dòng một lô — "số lô · HSD". `showCost` (máy chủ chỉ trả giá vốn cho người có quyền xem báo cáo chi phí) thêm
 * cột "Giá vốn" (theo đơn vị cơ sở) và "Thành tiền" từng dòng, để người quản lý đối chiếu với dòng tổng và báo cáo; người ghi không thấy hai cột này.
 */
export function ConsumptionRecordTable({ lines, showCost }: { lines: ConsumptionRecordLine[]; showCost: boolean }) {
  const unitNameByCode = useUnitNameByCode();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className={HEAD_ROW}>
            <th className="px-2.5 py-2.5 text-left">Vật tư / thuốc</th>
            <th className={`${TH} w-24`}>Loại</th>
            <th className={`${TH} w-52`}>Lô</th>
            <th className={`${TH} w-28`}>Số lượng</th>
            <th className={`${TH} w-24`}>Đơn vị</th>
            {showCost && <th className={`${TH} w-28`}>Giá vốn</th>}
            {showCost && <th className={`${TH} w-32`}>Thành tiền</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, index) => (
            <tr key={`${l.drugId}-${l.batchNo ?? ''}-${index}`} className="border-b border-slate-100 last:border-0">
              <ItemCell name={l.drugName} code={l.drugCode} />
              <td className="px-2 py-2.5 text-center">
                <ItemTypeBadge itemType={l.itemType} />
              </td>
              <td className="px-2 py-2.5 text-center text-slate-700">
                {l.batchNo ? (
                  <>
                    {l.batchNo}
                    {l.expiryDate && <span className="text-slate-500"> · HSD {formatExpiry(l.expiryDate)}</span>}
                  </>
                ) : (
                  <span className="text-slate-500">Không theo lô</span>
                )}
              </td>
              <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">{l.quantity}</td>
              <td className="px-2 py-2.5 text-center text-slate-700">{l.baseUnitCode ? unitLabel(unitNameByCode, l.baseUnitCode) : '—'}</td>
              {showCost && <td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{l.unitCost === null ? '—' : formatVnd(l.unitCost)}</td>}
              {showCost && <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">{l.unitCost === null ? '—' : formatVnd(l.unitCost * l.quantity)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
