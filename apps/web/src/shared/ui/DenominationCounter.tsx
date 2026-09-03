import { useState } from 'react';
import { formatVnd } from '../format/currency';

/** Mệnh giá tiền giấy VNĐ đang lưu hành, từ lớn tới nhỏ. */
const DENOMINATIONS = [500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000];

/**
 * "Máy tính mệnh giá" — bảng đếm tiền mặt theo từng tờ, tự cộng tổng (mockup "Chốt ca" duyệt
 * 2026-09-03). Dùng CHUNG cho cả popup Mở ca lẫn Chốt ca — đặt ở `shared/ui` với chủ đích tái dùng
 * ngay từ lần viết đầu tiên (CLAUDE.md). `value`/`onChange` là tổng tiền (số thật) — nơi gọi không
 * cần quan tâm từng dòng mệnh giá, chỉ dùng số cuối để lưu (v1 không lưu chi tiết đã đếm).
 */
export function DenominationCounter({ value, onChange }: { value: number; onChange: (total: number) => void }) {
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  function setQuantity(denom: number, qty: number) {
    const next = { ...quantities, [denom]: Math.max(0, qty) };
    setQuantities(next);
    onChange(DENOMINATIONS.reduce((sum, d) => sum + (next[d] ?? 0) * d, 0));
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-3 bg-slate-100 border-b-2 border-blue-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-800">
        <div>Mệnh giá</div>
        <div className="text-center">Số lượng</div>
        <div className="text-right">Thành tiền</div>
      </div>
      <div className="scroll-hover max-h-56 overflow-y-auto">
        {DENOMINATIONS.map((denom) => {
          const qty = quantities[denom] ?? 0;
          return (
            <div key={denom} className="grid grid-cols-3 items-center px-4 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <div className="text-sm font-semibold text-slate-800">{formatVnd(denom)}</div>
              <div className="flex justify-center">
                <input
                  type="number"
                  min={0}
                  value={qty === 0 ? '' : qty}
                  onChange={(e) => setQuantity(denom, e.target.value === '' ? 0 : Number(e.target.value))}
                  className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="text-right text-sm font-bold text-slate-900">{(qty * denom).toLocaleString('vi-VN')}</div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between bg-slate-900 px-5 py-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Tổng tiền mặt đếm được</span>
        <span className="text-lg font-bold text-white">{formatVnd(value)}</span>
      </div>
    </div>
  );
}
