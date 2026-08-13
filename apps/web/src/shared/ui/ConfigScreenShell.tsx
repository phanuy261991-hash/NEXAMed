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
  items: ConfigScreenItem[];
}

/**
 * Khung dùng chung cho "Two-panel Config Screen — Kiểu 2" (.claude/docs/ui-guidelines.md mục 10,
 * docs/DECISIONS.md #039/#040) — tách ra sau khi có lần dùng thứ hai (`CatalogAdminPage` và
 * `ClinicConfigPage`) theo `CLAUDE.md`: pill bar chọn nhóm lớn → cột trái liệt kê màn hình con của
 * pill đang chọn → nội dung cột phải do trang gọi tự quyết định (`children`). Pill bar và cột
 * trái LUÔN hiện dù chỉ có 1 pill/1 mục — không tự ẩn khi ít lựa chọn (đã hỏi và chốt giữ nguyên
 * chrome, tránh 2 trang cấu hình trông khác nhau chỉ vì số lượng mục khác nhau).
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
  activeItemKey: string;
  onSelectPill: (pillKey: string) => void;
  onSelectItem: (itemKey: string) => void;
  children: ReactNode;
}) {
  const activePill = pills.find((p) => p.key === activePillKey) ?? pills[0]!;

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{pageLabel}</h1>

      <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 px-6 py-3">
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
        <div className="w-60 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2.5">
          {activePill.items.map((item) => {
            const ItemIcon = item.icon;
            const active = item.key === activeItemKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectItem(item.key)}
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

        <div className="min-w-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
