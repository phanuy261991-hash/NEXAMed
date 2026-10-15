import type { PlatformAuditEntry } from '@nexamed/shared';
import { formatDateTimeVn } from '../../shared/format/time';

/** Bảng nhật ký vận hành (dùng ở trang "Nhật ký vận hành" và cuối trang chi tiết công ty). `showTenant` hiện cột công ty bị tác động. */
export function AuditTable({ items, showTenant }: { items: PlatformAuditEntry[]; showTenant: boolean }) {
  if (items.length === 0) return <p className="px-4 py-4 text-sm font-medium text-slate-500">Chưa có thao tác nào.</p>;
  const headers = ['Thời gian', 'Người thực hiện', ...(showTenant ? ['Công ty'] : []), 'Thao tác'];
  return (
    <table className="w-full text-sm">
      <thead className="border-b-2 border-blue-600 bg-slate-100">
        <tr>
          {headers.map((header) => (
            <th key={header} className="whitespace-nowrap px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-700">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((item) => (
          <tr key={item.id}>
            <td className="whitespace-nowrap px-3 py-2 text-center font-medium tabular-nums text-slate-900">{formatDateTimeVn(item.occurredAt)}</td>
            <td className="px-3 py-2 text-left font-medium text-slate-900">{item.operatorName ?? '—'}</td>
            {showTenant && <td className="px-3 py-2 text-left font-medium text-slate-900">{item.targetTenantName ?? '—'}</td>}
            <td className="px-3 py-2 text-left font-medium text-slate-900">
              {item.actionLabel}
              {item.note && <span className="text-slate-600"> — lý do: {item.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
