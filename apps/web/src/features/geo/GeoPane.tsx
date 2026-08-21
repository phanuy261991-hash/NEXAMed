import { useMemo, useState } from 'react';
import { Info, MagnifyingGlass, MapPinLine } from '@phosphor-icons/react';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { useProvincesQuery, useWardsQuery } from './geo.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const READONLY_NOTE =
  'Danh mục hành chính theo dữ liệu chính thức của Bộ Nội vụ (sáp nhập 2025) — chỉ đọc, không có thao tác Thêm/Sửa/Xoá qua giao diện.';

/** Mặc định Thành phố Hồ Chí Minh — có dữ liệu ngay khi mở màn hình thay vì trang trắng chờ chọn. */
const DEFAULT_WARD_PROVINCE_CODE = '29';

/**
 * 2 chế độ chỉ đọc cho `province`/`ward` (docs/DECISIONS.md #038, #039) — dùng làm nội dung cột
 * phải trong trang "Danh mục". `mode="ward"` mặc định chọn sẵn 1 tỉnh (xem
 * `DEFAULT_WARD_PROVINCE_CODE`) — tái dùng `useWardsQuery` cascading đã có cho form địa chỉ bệnh
 * nhân, không tải cả ~3321 dòng một lúc.
 */
export function GeoPane({ mode }: { mode: 'province' | 'ward' }) {
  const [search, setSearch] = useState('');
  const [provinceCode, setProvinceCode] = useState(mode === 'ward' ? DEFAULT_WARD_PROVINCE_CODE : '');

  const provincesQuery = useProvincesQuery();
  const wardsQuery = useWardsQuery(provinceCode);

  const provinceOptions = useMemo(
    () => (provincesQuery.data?.items ?? []).map((p) => ({ value: p.code, label: p.name })),
    [provincesQuery.data],
  );

  const provinceRows = useMemo(() => {
    const all = provincesQuery.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [provincesQuery.data, search]);

  const wardRows = useMemo(() => {
    const all = wardsQuery.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q));
  }, [wardsQuery.data, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
        <Info size={15} weight="regular" className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
        <span>{READONLY_NOTE}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {mode === 'ward' && (
          <div className="w-64">
            <Combobox
              id="geo-province-filter"
              value={provinceCode}
              onChange={(v) => {
                setProvinceCode(v);
                setSearch('');
              }}
              options={provinceOptions}
              placeholder="Chọn Tỉnh/Thành..."
            />
          </div>
        )}
        <div className="relative w-64">
          <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={mode === 'province' ? 'Tìm theo mã hoặc tên tỉnh...' : 'Tìm theo mã hoặc tên phường/xã...'}
            disabled={mode === 'ward' && provinceCode === ''}
            className={`${inputClassName} pl-8 disabled:bg-slate-50 disabled:text-slate-400`}
          />
        </div>
      </div>

      {mode === 'province' && (
        <>
          {provincesQuery.isError && <ErrorBanner message="Không tải được danh mục Tỉnh/Thành." onRetry={() => provincesQuery.refetch()} />}
          {provincesQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {provincesQuery.isSuccess && (
            <GeoTable rows={provinceRows.map((p) => ({ code: p.code, name: p.name }))} emptyLabel="Không tìm thấy tỉnh/thành nào" />
          )}
        </>
      )}

      {mode === 'ward' && (
        <>
          {provinceCode === '' && (
            <EmptyState icon={MapPinLine} title="Chọn Tỉnh/Thành để xem danh sách" description="Danh sách phường/xã lọc theo tỉnh đã chọn — không hiển thị cả 3.321 phường/xã cùng lúc." />
          )}
          {provinceCode !== '' && wardsQuery.isError && (
            <ErrorBanner message="Không tải được danh mục Phường/Xã." onRetry={() => wardsQuery.refetch()} />
          )}
          {provinceCode !== '' && wardsQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {provinceCode !== '' && wardsQuery.isSuccess && (
            <GeoTable rows={wardRows.map((w) => ({ code: w.code, name: w.name }))} emptyLabel="Không tìm thấy phường/xã nào" />
          )}
        </>
      )}
    </div>
  );
}

function GeoTable({ rows, emptyLabel }: { rows: { code: string; name: string }[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <EmptyState icon={MagnifyingGlass} title={emptyLabel} description="Thử từ khoá khác hoặc bỏ bộ lọc tìm kiếm." />;
  }
  return (
    <div className="scroll-hover flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="w-28 px-4 py-2.5 text-center">Mã</th>
            <th className="px-4 py-2.5 text-left">Tên</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-slate-200 last:border-0">
              <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{r.code}</td>
              <td className="px-4 py-2 text-left font-medium text-slate-900">{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
