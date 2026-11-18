import type { ReactNode } from 'react';
import { useWindowedRows } from '../../shared/hooks/useWindowedRows';

/**
 * Bảng dài tự CUỘN ẢO (chỉ dựng các dòng đang nhìn thấy) khi vượt ngưỡng này, và phần dòng cuộn trong khung cao tối đa 65% màn hình nếu nơi gọi chưa giới hạn chiều cao.
 * Đo 17/11/2026 (docs/DECISIONS.md #303): báo cáo "Chất lượng" 605 dòng dựng ~4.500 phần tử làm luồng chính bị chặn ~580 ms trên máy văn phòng cũ. Bảng ngắn giữ cách dựng cũ.
 */
const WINDOW_MIN_ROWS = 80;
const WINDOW_DEFAULT_HEIGHT_CLASS = 'max-h-[65vh]';
const ROW_ESTIMATE_PX = 44;

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

/** Một ô của hàng nhóm cột phía trên đầu bảng: gộp `span` cột, có gạch chân màu; bỏ `label` để chừa trống. */
export interface ReportGridGroupHeader {
  span: number;
  label?: string;
  tone?: 'slate' | 'green';
}

const GROUP_TONE_CLASS = { slate: 'border-slate-400 text-slate-700', green: 'border-emerald-700 text-emerald-800' } as const;

const ALIGN_CLASS = { left: 'text-left', right: 'text-right tabular-nums', center: 'text-center' } as const;

export function ReportGridTable({
  groupHeaders,
  columns,
  rows,
  footer,
  minWidth = 0,
  ariaLabel,
  emptyText,
  maxBodyHeightClass,
}: {
  /** Hàng nhóm cột trên đầu bảng (ví dụ "GHI NHẬN" gộp 5 cột); tổng `span` phải bằng số cột. */
  groupHeaders?: readonly ReportGridGroupHeader[];
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
  const windowed = rows.length > WINDOW_MIN_ROWS;
  const win = useWindowedRows(windowed ? rows.length : 0, ROW_ESTIMATE_PX);
  const rowClass = 'grid items-center gap-x-3 border-b border-slate-50 px-4 py-2.5 text-sm text-slate-800';
  const cells = (row: ReactNode[]) =>
    row.map((value, i) => (
      <div key={i} role="cell" className={`min-w-0 ${cell(columns[i]!)}`}>
        {value}
      </div>
    ));

  if (rows.length === 0 && emptyText) return <p className="px-4 py-6 text-center text-sm text-slate-600">{emptyText}</p>;

  return (
    <div className="scroll-hover overflow-x-auto">
      <div role="table" aria-label={ariaLabel} style={minWidth > 0 ? { minWidth } : undefined}>
        {groupHeaders && (
          <div role="presentation" style={{ gridTemplateColumns: template }} className="grid gap-x-3 px-4 pb-0.5 pt-3 text-[13px] font-semibold uppercase tracking-wide">
            {groupHeaders.map((g, i) => (
              <div key={i} style={{ gridColumn: `span ${g.span}` }} className={g.label ? `border-b-2 pb-1 ${GROUP_TONE_CLASS[g.tone ?? 'slate']}` : undefined}>
                {g.label}
              </div>
            ))}
          </div>
        )}
        <div role="row" style={{ gridTemplateColumns: template }} className="grid gap-x-3 border-b border-slate-100 px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-800">
          {columns.map((c) => (
            <div key={c.header} role="columnheader" className={cell(c)}>
              {c.header}
            </div>
          ))}
        </div>
        <div
          ref={windowed ? win.scrollRef : undefined}
          className={windowed ? `scroll-hover overflow-y-auto ${maxBodyHeightClass ?? WINDOW_DEFAULT_HEIGHT_CLASS}` : maxBodyHeightClass ? `scroll-hover overflow-y-auto ${maxBodyHeightClass}` : undefined}
        >
          {windowed ? (
            <div style={win.containerStyle}>
              {win.rows.map((vr) => (
                <div key={vr.index} ref={win.measureRow} data-index={vr.index} role="row" aria-rowindex={vr.index + 2} style={{ ...win.rowStyle(vr.start), gridTemplateColumns: template }} className={rowClass}>
                  {cells(rows[vr.index]!)}
                </div>
              ))}
            </div>
          ) : (
            rows.map((row, r) => (
              <div key={r} role="row" style={{ gridTemplateColumns: template }} className={rowClass}>
                {cells(row)}
              </div>
            ))
          )}
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
