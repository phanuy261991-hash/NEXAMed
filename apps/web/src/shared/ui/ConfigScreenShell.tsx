import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';

export interface ConfigScreenItem {
  key: string;
  label: string;
  icon: Icon;
}

export interface ConfigScreenPill {
  key: string;
  label: string;
  /**
   * Danh sách màn hình con của pill này. Bỏ trống/`undefined` khi pill đã tự là một màn hình lá
   * (chế độ "pill phẳng" — xem `docs/DECISIONS.md` #045) — khi đó KHÔNG render cột trái, nội dung
   * cột phải chiếm hết phần còn lại ngay sau thanh pill.
   */
  items?: ConfigScreenItem[];
}

/**
 * Khung dùng chung cho "Two-panel/One-panel Config Screen" (.claude/docs/ui-guidelines.md mục 10,
 * docs/DECISIONS.md #039/#040/#045) — tách ra sau khi có lần dùng thứ hai (`CatalogAdminPage` và
 * `ClinicConfigPage`) theo `CLAUDE.md`. Hai chế độ tuỳ theo `pill.items`:
 * - **Có `items`** (`ClinicConfigPage`): pill bar chọn nhóm lớn → cột trái liệt kê màn hình con của
 *   pill đang chọn → nội dung cột phải. Cột trái LUÔN hiện dù chỉ có 1 mục — không tự ẩn khi ít lựa
 *   chọn (đã hỏi và chốt giữ nguyên chrome ở #040, tránh 2 trang cấu hình trông khác nhau).
 * - **Không có `items`** (`CatalogAdminPage`, #045): mỗi pill đã tự là một màn hình lá — KHÔNG render
 *   cột trái, `activePillKey` chính là lựa chọn nội dung, nội dung cột phải sát ngay thanh pill.
 */
export function ConfigScreenShell({
  pageLabel,
  pills,
  activePillKey,
  activeItemKey,
  onSelectPill,
  onSelectItem,
  children,
}: {
  pageLabel: string;
  pills: ConfigScreenPill[];
  activePillKey: string;
  activeItemKey?: string;
  onSelectPill: (pillKey: string) => void;
  onSelectItem?: (itemKey: string) => void;
  children: ReactNode;
}) {
  const activePill = pills.find((p) => p.key === activePillKey) ?? pills[0]!;
  const items = activePill.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{pageLabel}</h1>

      <div className="scroll-hover flex flex-shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 px-6 py-3">
        {pills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            onClick={() => onSelectPill(pill.key)}
            className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              pill.key === activePillKey
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {items.length > 0 && (
          <div className="w-60 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2.5">
            {items.map((item) => {
              const ItemIcon = item.icon;
              const active = item.key === activeItemKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectItem?.(item.key)}
                  className={`mb-0.5 flex w-full items-center gap-2.5 rounded-r-md border-l-2 px-3 py-2 text-left text-sm font-medium transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <ItemIcon size={15} weight={active ? 'fill' : 'regular'} aria-hidden="true" className="flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
