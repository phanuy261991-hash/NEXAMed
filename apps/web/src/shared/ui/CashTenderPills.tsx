import { DENOMINATIONS } from './DenominationCounter';

/**
 * Dãy pill mệnh giá tiền VNĐ — bấm CỘNG DỒN vào `value` hiện tại (kiểu POS thật, chốt qua
 * `AskUserQuestion`), không thay thế. Dùng chung `DENOMINATIONS` với `DenominationCounter.tsx`
 * (tránh nhân bản danh sách mệnh giá). Component THUẦN (`value`/`onChange`), không biết gì về
 * nghiệp vụ hoá đơn/ví — viết ở `shared/ui` với chủ đích tái dùng ngay cho bất kỳ ô nhập tiền mặt
 * nào khác sau này (CLAUDE.md).
 */
export function CashTenderPills({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DENOMINATIONS.slice()
        .reverse()
        .map((denom) => (
          <button
            key={denom}
            type="button"
            onClick={() => onChange(value + denom)}
            className="rounded-full border-2 border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
          >
            +{denom / 1000}k
          </button>
        ))}
      <button
        type="button"
        onClick={() => onChange(0)}
        className="rounded-full border-2 border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 transition-colors hover:border-rose-300"
      >
        Xoá
      </button>
    </div>
  );
}
