import { useEffect, useRef } from 'react';
import { Eye, Printer, Stethoscope } from '@phosphor-icons/react';
import type { PatientParaclinicalResultRow } from '@nexamed/shared';
import { formatClockTime } from '../../shared/format/time';
import { PrintButton } from '../../shared/print/PrintButton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { lookupStatusBadge } from '../clinical-order/clinical-order-book-labels';
import { formatDateStringVi, toVietnamDateString } from '../encounter/follow-up-date';
import type { ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  align: 'center' | 'left';
  onlyMultiBranch?: boolean;
  sticky?: 'right';
}

const LAB_COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Ngày', width: 100, align: 'center' },
  { key: 'branch', label: 'Chi nhánh', width: 130, align: 'center', onlyMultiBranch: true },
  { key: 'orderNo', label: 'Mã phiếu', width: 125, align: 'center' },
  { key: 'service', label: 'Dịch vụ', width: 190, align: 'left' },
  { key: 'abnormal', label: 'Chỉ số bất thường', width: 260, align: 'left' },
  { key: 'doctor', label: 'Bác sĩ chỉ định', width: 150, align: 'left' },
  { key: 'signer', label: 'Người duyệt', width: 140, align: 'left' },
  { key: 'status', label: 'Trạng thái', width: 115, align: 'center' },
  { key: 'action', label: 'Thao tác', width: 110, align: 'center', sticky: 'right' },
];

const IMAGING_COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Ngày', width: 100, align: 'center' },
  { key: 'branch', label: 'Chi nhánh', width: 130, align: 'center', onlyMultiBranch: true },
  { key: 'orderNo', label: 'Mã phiếu', width: 125, align: 'center' },
  { key: 'service', label: 'Dịch vụ', width: 190, align: 'left' },
  { key: 'conclusion', label: 'Kết luận', width: 260, align: 'left' },
  { key: 'images', label: 'Ảnh', width: 70, align: 'center' },
  { key: 'doctor', label: 'Bác sĩ chỉ định', width: 150, align: 'left' },
  { key: 'signer', label: 'Người duyệt', width: 140, align: 'left' },
  { key: 'status', label: 'Trạng thái', width: 115, align: 'center' },
  { key: 'action', label: 'Thao tác', width: 110, align: 'center', sticky: 'right' },
];

const DASH = <span className="text-slate-400">—</span>;

/**
 * Bảng "Danh sách kết quả" của tab Kết quả cận lâm sàng (docs/DECISIONS.md #234, mockup đã duyệt): mỗi dòng một dịch vụ đã duyệt, mới nhất ở trên, cuộn xuống tự tải thêm, tiêu đề
 * dính trên, cột Thao tác dính phải. Dòng của chi nhánh khác nền xanh nhạt (như tab Lịch sử khám). Chỉ hiển thị — dữ liệu và thao tác do nơi gọi truyền vào.
 */
export function PatientParaclinicalResultList({
  group,
  rows,
  multiBranch,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onView,
  onPrint,
  filtered,
}: {
  group: ParaclinicalGroup;
  rows: PatientParaclinicalResultRow[];
  multiBranch: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onView: (row: PatientParaclinicalResultRow) => void;
  onPrint: (row: PatientParaclinicalResultRow) => void;
  /** Đang có bộ lọc → thông báo rỗng khác nhau. */
  filtered: boolean;
}) {
  const columns = (group === 'lab' ? LAB_COLUMNS : IMAGING_COLUMNS).filter((c) => !c.onlyMultiBranch || multiBranch);
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // Cuộn tới đâu tự tải thêm tới đó: phần tử đệm cuối bảng, quan sát trong chính khung cuộn.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) onLoadMore();
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore, rows.length]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Stethoscope}
        title={filtered ? 'Không có kết quả nào khớp bộ lọc' : 'Bệnh nhân chưa có kết quả đã duyệt'}
        description={filtered ? 'Thử bỏ bớt bộ lọc hoặc đổi khoảng thời gian.' : 'Kết quả hiện ở đây sau khi được duyệt và trả cho bệnh nhân.'}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div ref={scrollRef} className="scroll-hover max-h-[460px] overflow-auto">
        <table className="text-sm" style={{ minWidth, width: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`border-b-2 border-blue-600 bg-slate-100 px-3 py-2.5 ${c.align === 'left' ? 'text-left' : 'text-center'} text-xs font-bold uppercase tracking-wide text-slate-800 ${
                    c.sticky ? 'sticky right-0 z-20' : ''
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              // Kết quả ở chi nhánh khác: nền xanh nhạt; ô dính cột phải đổi nền theo để không lộ khối trắng khi cuộn ngang.
              <tr key={row.itemId} className={`group border-b border-slate-100 hover:bg-slate-50 ${row.isOtherBranch ? 'bg-blue-50' : ''}`}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 align-middle ${c.align === 'left' ? 'text-left' : 'text-center'} ${
                      c.sticky ? `sticky right-0 z-[1] ${row.isOtherBranch ? 'bg-blue-50' : 'bg-white'} group-hover:bg-slate-50` : ''
                    }`}
                  >
                    {renderCell(c.key, row, group, onView, onPrint)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {hasNextPage && (
          <div ref={sentinelRef} className="px-3 py-3 text-center text-xs font-medium text-slate-500">
            {isFetchingNextPage ? 'Đang tải thêm…' : ' '}
          </div>
        )}
      </div>
    </div>
  );
}

function renderCell(key: string, row: PatientParaclinicalResultRow, group: ParaclinicalGroup, onView: (row: PatientParaclinicalResultRow) => void, onPrint: (row: PatientParaclinicalResultRow) => void) {
  switch (key) {
    case 'date':
      return (
        <>
          <div className="font-bold tabular-nums text-brand-teal">{formatDateStringVi(toVietnamDateString(row.signedAt))}</div>
          <div className="text-xs font-medium tabular-nums text-slate-500">{formatClockTime(row.signedAt)}</div>
        </>
      );
    case 'branch':
      return row.isOtherBranch ? (
        <span className="inline-block max-w-full truncate whitespace-nowrap rounded-md bg-blue-600 px-2 py-1 text-xs font-bold text-white" title={row.branchName ?? undefined}>
          {row.branchName ?? 'Chi nhánh khác'}
        </span>
      ) : row.branchName ? (
        <span className="block truncate font-medium text-slate-700" title={row.branchName}>
          {row.branchName}
        </span>
      ) : (
        DASH
      );
    case 'orderNo':
      return <span className="font-semibold tabular-nums text-slate-800">{row.orderNo}</span>;
    case 'service':
      return (
        <>
          <div className="line-clamp-2 font-semibold text-slate-900" title={row.serviceName}>
            {row.serviceName}
          </div>
          {row.categoryName && <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{row.categoryName}</div>}
        </>
      );
    case 'abnormal':
      return row.abnormals.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.abnormals.map((a, i) => (
            <span key={i} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold text-white ${a.flag === 'LOW' ? 'bg-amber-500' : 'bg-rose-600'}`}>
              {a.label} {a.valueText.replace('.', ',')}
              {a.unit ? ` ${a.unit}` : ''} {a.flag === 'HIGH' ? '↑' : a.flag === 'LOW' ? '↓' : '!'}
            </span>
          ))}
        </div>
      ) : row.evaluatedCount > 0 ? (
        <span className="text-xs font-semibold text-emerald-600">Không có chỉ số bất thường</span>
      ) : (
        DASH
      );
    case 'conclusion':
      return row.conclusionText ? (
        <div className="line-clamp-2 font-medium text-slate-700" title={row.conclusionText}>
          {row.conclusionText}
        </div>
      ) : (
        DASH
      );
    case 'images':
      return row.imageCount > 0 ? <span className="font-medium tabular-nums text-slate-700">{row.imageCount}</span> : DASH;
    case 'doctor':
      return row.doctorName ? <div className="truncate font-medium text-slate-700">{row.doctorName}</div> : DASH;
    case 'signer':
      return row.signedByName ? <div className="truncate font-medium text-slate-700">{row.signedByName}</div> : DASH;
    case 'status': {
      const badge = lookupStatusBadge(row.status);
      return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
    }
    case 'action':
      return (
        <div className="flex items-center justify-center gap-1.5">
          <RowActionButton icon={Eye} label="Xem kết quả" tone="primary" onClick={() => onView(row)} />
          <PrintButton
            documentType={group === 'lab' ? 'LAB_RESULT' : 'IMAGING_RESULT'}
            onPrint={() => onPrint(row)}
            renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In kết quả" tone="neutral" onClick={onClick} disabled={disabled} />}
          />
        </div>
      );
    default:
      return null;
  }
}
