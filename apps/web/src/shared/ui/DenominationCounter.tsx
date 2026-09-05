import { useState } from 'react';
import { Minus, Plus } from '@phosphor-icons/react';
import { formatVnd } from '../format/currency';

/** Mệnh giá tiền giấy VNĐ đang lưu hành, từ lớn tới nhỏ. */
const DENOMINATIONS = [500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000];

/**
 * "Máy tính mệnh giá" — bảng đếm tiền mặt theo từng tờ, tự cộng tổng (mockup "Chốt ca" duyệt
 * 2026-09-03, redesign cột "Số tờ" chốt 2026-09-05 — `docs/DECISIONS.md` #120). Dùng CHUNG cho cả
 * popup Mở ca lẫn Chốt ca — đặt ở `shared/ui` với chủ đích tái dùng ngay từ lần viết đầu tiên
 * (CLAUDE.md). `value`/`onChange` là tổng tiền (số thật) — nơi gọi không cần quan tâm từng dòng
 * mệnh giá, chỉ dùng số cuối để lưu (v1 không lưu chi tiết đã đếm).
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
        <div className="text-center text-blue-600">Số tờ</div>
        <div className="text-right">Thành tiền</div>
      </div>
      <div className="scroll-hover max-h-64 overflow-y-auto">
        {DENOMINATIONS.map((denom) => {
          const qty = quantities[denom] ?? 0;
          return (
            <div key={denom} className="grid grid-cols-3 items-center px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <div className="text-sm font-semibold text-slate-800">{formatVnd(denom)}</div>
              {/* Control tăng/giảm giá trị (thuần đổi số lượng, không phải "hành động" nghiệp vụ)
                  — viết `<button>` tay thay vì `Button` dùng chung: `Button` có sẵn `px-4` từ
                  variant, ép `px-0` qua className để nhồi vào ô 32px thua trận specificity (đúng
                  cảnh báo trong docstring `Button.tsx`) khiến icon bị nuốt mất, không hiện ra. */}
              <div className="flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setQuantity(denom, qty - 1)}
                  disabled={qty <= 0}
                  aria-label={`Giảm số tờ ${formatVnd(denom)}`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-500"
                >
                  <Minus size={13} weight="bold" aria-hidden="true" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={qty === 0 ? '' : qty}
                  onChange={(e) => setQuantity(denom, e.target.value === '' ? 0 : Number(e.target.value.replace(/\D/g, '')))}
                  aria-label={`Số tờ ${formatVnd(denom)}`}
                  placeholder="0"
                  className="h-8 w-12 rounded-md border border-slate-300 bg-slate-50 text-center text-sm font-bold text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(denom, qty + 1)}
                  aria-label={`Tăng số tờ ${formatVnd(denom)}`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:bg-slate-50 hover:text-blue-600"
                >
                  <Plus size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div className="text-right text-sm font-bold text-slate-900">{(qty * denom).toLocaleString('vi-VN')}</div>
            </div>
          );
        })}
      </div>
      {/* Dòng tổng — màu thương hiệu chính (`bg-blue-600`, mục 2.1 ui-guidelines), không dùng
          nền tối trung tính nữa (phản hồi trực tiếp 2026-09-05). */}
      <div className="flex items-center justify-between bg-blue-600 px-5 py-3">
        <span className="text-xs font-bold uppercase tracking-wide text-blue-100">Tổng tiền mặt đếm được</span>
        <span className="text-lg font-bold text-white">{formatVnd(value)}</span>
      </div>
    </div>
  );
}
