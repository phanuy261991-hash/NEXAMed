import { useEffect, useRef, useState } from 'react';
import { Plus, Warning } from '@phosphor-icons/react';
import type { PatientAllergenItem } from '@nexamed/shared';

/** Chip 1 dị ứng — dùng chung cho phần hiện sẵn lẫn danh sách đầy đủ trong dropdown "xem thêm". */
function AllergenChip({ allergen }: { allergen: PatientAllergenItem }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-rose-700">
      {allergen.name} <span className="font-medium text-rose-600">({allergen.allergenGroupName})</span>
    </span>
  );
}

/**
 * Banner "CẢNH BÁO DỊ ỨNG" — chỉ hiện tối đa 2 chip đầu tiên (theo yêu cầu chủ dự án, tránh chiếm
 * quá nhiều chỗ ở dòng định danh chính); còn lại gộp vào nút "+N", rê chuột hoặc bấm vào mở dropdown
 * liệt kê ĐẦY ĐỦ dị nguyên. **Chưa có "mức độ nghiêm trọng"** — hệ thống hiện không lưu trường này
 * cho dị nguyên (`patient_allergen`/`allergen_catalog` chỉ có tên + nhóm), nên dropdown chỉ hiện tên
 * + nhóm như banner chính, không bịa số liệu mức độ.
 *
 * Trích xuất từ `EncounterConsultationPage.tsx` (2026-09-08, lần dùng thứ 2 là trang "Hồ sơ bệnh
 * nhân") — đúng nguyên tắc CLAUDE.md "trùng lặp lần 2 → trích xuất ra dùng chung".
 */
export function AllergyBanner({ allergens }: { allergens: PatientAllergenItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const VISIBLE_LIMIT = 2;
  const visible = allergens.slice(0, VISIBLE_LIMIT);
  const hiddenCount = allergens.length - visible.length;

  return (
    <span
      ref={containerRef}
      className="relative flex flex-wrap items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5"
      onMouseEnter={() => hiddenCount > 0 && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-rose-700">
        <Warning size={13} weight="fill" aria-hidden="true" />
        CẢNH BÁO DỊ ỨNG:
      </span>
      {visible.map((a) => (
        <AllergenChip key={a.id} allergen={a} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Xem thêm ${hiddenCount} dị ứng khác`}
          className="whitespace-nowrap rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 hover:bg-rose-200"
        >
          +{hiddenCount}
        </button>
      )}
      {open && hiddenCount > 0 && (
        <div className="scroll-hover absolute left-0 top-full z-20 mt-1.5 max-h-64 w-72 overflow-y-auto rounded-lg border border-rose-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-rose-700">Toàn bộ dị ứng ({allergens.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {allergens.map((a) => (
              <AllergenChip key={a.id} allergen={a} />
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Khung "Tiền sử dị ứng"/"Tiền sử bản thân"/"Tiền sử gia đình" — tiêu đề + nút "+ Thêm" (mở
 * `PatientHistoryDialog`, dùng chung cho cả 3 khung vì đó là dialog sửa cả 3 mục cùng lúc) trên
 * cùng 1 khung viền. Trích xuất cùng đợt với `AllergyBanner` (dùng lần 2 ở trang "Hồ sơ bệnh nhân").
 */
export function HistoryBoxCard({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex flex-shrink-0 items-center gap-1 rounded-full border border-dashed border-blue-400 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100"
        >
          <Plus size={11} weight="bold" aria-hidden="true" />
          Thêm
        </button>
      </div>
      {children}
    </div>
  );
}
