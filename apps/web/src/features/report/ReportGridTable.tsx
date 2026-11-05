import type { ReactNode } from 'react';

/**
 * Bảng lưới của báo cáo điều hành (mockup đã duyệt): đầu bảng chữ HOA nhỏ nền trắng, dòng cách nhau bằng đường kẻ rất mảnh, dòng cộng nền xám nhạt. Đầu bảng và mọi dòng dùng CÙNG
 * `gridTemplateColumns` và CÙNG khoảng cách cột nên luôn thẳng hàng (ui-guidelines mục 9). Hẹp hơn `minWidth` thì cuộn ngang trong khung. Nhận ô dạng `ReactNode` để nơi gọi tự tô màu/thanh tỉ lệ.
 */
export interface ReportGridColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Độ rộng cột theo CSS grid (`'90px'`, `'minmax(150px, 1fr)'`); mặc định chia đều. */
  width?: string;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right tabular-nums', center: 'text-center' } as const;

export function ReportGridTable({
  columns,
  rows,
  footer,
  minWidth = 0,
  ariaLabel,
  emptyText,
  maxBodyHeightClass,
}: {
  columns: readonly ReportGridColumn[];
  rows: readonly ReactNode[][];
  /** Dòng cộng (cùng số cột). */
  footer?: readonly ReactNode[];
  minWidth?: number;
  ariaLabel: string;
  /** Chữ hiện thay cho bảng khi không có dòng nào. */
  emptyText?: string;
  /** Giới hạn chiều cao phần dòng (ví dụ `max-h-[420px]`) để bảng dài cuộn trong khung; bỏ trống = không giới hạn. */
  maxBodyHeightClass?: string;
}) {
  const template = columns.map((c) => c.width ?? 'minmax(0, 1fr)').join(' ');
  const cell = (c: ReportGridColumn) => ALIGN_CLASS[c.align ?? 'left'];

  if (rows.length === 0 && emptyText) return <p className="px-4 py-6 text-center text-sm text-slate-600">{emptyText}</p>;

  return (
    <div className="scroll-hover overflow-x-auto">
      <div role="table" aria-label={ariaLabel} style={minWidth > 0 ? { minWidth } : undefined}>
        <div role="row" style={{ gridTemplateColumns: template }} className="grid gap-x-3 border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {columns.map((c) => (
            <div key={c.header} role="columnheader" className={cell(c)}>
              {c.header}
            </div>
          ))}
        </div>
        <div className={maxBodyHeightClass ? `scroll-hover overflow-y-auto ${maxBodyHeightClass}` : undefined}>
          {rows.map((row, r) => (
            <div key={r} role="row" style={{ gridTemplateColumns: template }} className="grid items-center gap-x-3 border-b border-slate-50 px-4 py-2.5 text-sm text-slate-800">
              {row.map((value, i) => (
                <div key={i} role="cell" className={`min-w-0 ${cell(columns[i]!)}`}>
                  {value}
                </div>
              ))}
            </div>
          ))}
        </div>
        {footer && (
          <div role="row" style={{ gridTemplateColumns: template }} className="grid items-center gap-x-3 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">
            {footer.map((value, i) => (
              <div key={i} role="cell" className={cell(columns[i]!)}>
                {value}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
