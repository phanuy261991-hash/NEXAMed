import { useMemo, useState } from 'react';
import { MagnifyingGlass, UsersThree, X } from '@phosphor-icons/react';
import type { PatientSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';
import { formatAddressLine } from '../patient/patient-form.utils';
import { usePatientByNationalIdQuery, usePatientsQuery, useRecentPatientsQuery } from '../patient/patient.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const thClassName = 'border-b-2 border-blue-600 px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-800';
const thClassNameLeft = `${thClassName} text-left`;
const SKELETON_ROW_COUNT = 5;

/**
 * "Tìm kiếm khách hàng" (Sprint 5, ảnh tham khảo chủ dự án gửi) — icon cạnh ô "Mã bệnh nhân" ở
 * `ReceptionIntakeForm.tsx` mở popup này, tìm theo Họ tên/Điện thoại/CCCD, bấm "Chọn" ở 1 dòng để
 * điền form. Tái dùng đúng pipeline `pendingMatchId` đã có (nơi gọi tự set), không viết logic fill trùng lặp.
 *
 * Cơ chế tìm (đã hỏi và chốt, xem plan): CCCD có giá trị → khớp TUYỆT ĐỐI qua
 * `GET /patients/by-national-id` (số đã mã hoá 1 chiều bằng hash, không tìm được theo phần). Ngược
 * lại gộp Họ tên/SĐT vào tham số `q` sẵn có của `GET /patients` (ưu tiên SĐT nếu cả hai đều điền —
 * định danh chính xác hơn) — KHÔNG có endpoint tìm kết hợp 3 trường AND thật sự (ngoài phạm vi yêu
 * cầu gốc). Cột "Trạng thái" trong ảnh tham khảo đã BỎ — `patient` không có khái niệm này, tránh
 * bịa dữ liệu (đã hỏi và chốt). Cột "Số CCCD" hiện dạng che (`nationalIdMasked`) — không hiện CCCD
 * đầy đủ như ảnh tham khảo, giữ đúng quy ước che PII đã có toàn hệ thống.
 *
 * Tiêu đề cột + 5 dòng dữ liệu MỚI TẠO gần đây hiện SẴN trước khi gõ tiêu chí (đã hỏi và chốt sắp
 * theo hồ sơ mới nhất — `sort=created_desc`, `useRecentPatientsQuery`) — thay cho khung trống ban
 * đầu, đúng "Ideal State" luôn có gì đó để nhìn theo `.claude/docs/ui-guidelines.md` mục 3.
 */
export function PatientSearchDialog({ onClose, onPick }: { onClose: () => void; onPick: (patient: PatientSummary) => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');

  const nationalIdSearchActive = nationalId.trim() !== '';
  const generalQuery = phone.trim() !== '' ? phone.trim() : fullName.trim();
  const hasQuery = nationalIdSearchActive || generalQuery.trim() !== '';

  const nationalIdQuery = usePatientByNationalIdQuery(nationalId);
  const generalSearchQuery = usePatientsQuery(generalQuery, !nationalIdSearchActive && generalQuery.trim() !== '');
  const recentQuery = useRecentPatientsQuery(!hasQuery);

  const provincesQuery = useProvincesQuery();
  const wardsQuery = useAllWardsQuery();
  const provinceNameByCode = useMemo(
    () => Object.fromEntries((provincesQuery.data?.items ?? []).map((p) => [p.code, p.name])),
    [provincesQuery.data],
  );
  const wardNameByCode = useMemo(() => Object.fromEntries((wardsQuery.data?.items ?? []).map((w) => [w.code, w.name])), [wardsQuery.data]);

  let results: PatientSummary[];
  let isLoading: boolean;
  if (nationalIdSearchActive) {
    results = nationalIdQuery.data?.items ?? [];
    isLoading = nationalIdQuery.isLoading;
  } else if (hasQuery) {
    results = generalSearchQuery.data?.pages.flatMap((page) => page.items) ?? [];
    isLoading = generalSearchQuery.isLoading;
  } else {
    results = recentQuery.data?.items ?? [];
    isLoading = recentQuery.isLoading;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 py-10" role="dialog" aria-modal="true" aria-labelledby="patient-search-title">
      <div className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <h2 id="patient-search-title" className="text-[16px] font-bold uppercase tracking-wide text-slate-900">
            Tìm kiếm khách hàng
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ" className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
            <X size={15} weight="bold" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2.5 border-b border-slate-200 px-6 py-4">
          <div className="min-w-40 flex-1">
            <label htmlFor="search-fullname" className="mb-1 block text-sm font-semibold text-slate-800">
              Họ tên
            </label>
            <input id="search-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClassName} />
          </div>
          <div className="min-w-40 flex-1">
            <label htmlFor="search-phone" className="mb-1 block text-sm font-semibold text-slate-800">
              Điện thoại
            </label>
            <input id="search-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClassName} />
          </div>
          <div className="min-w-40 flex-1">
            <label htmlFor="search-nationalid" className="mb-1 block text-sm font-semibold text-slate-800">
              CCCD
            </label>
            <input id="search-nationalid" value={nationalId} onChange={(e) => setNationalId(e.target.value)} className={inputClassName} />
          </div>
          <Button type="button" className="h-[42px]">
            <MagnifyingGlass size={15} weight="bold" />
            Tìm kiếm
          </Button>
        </div>

        {!hasQuery && (
          <p className="border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs font-medium text-slate-500">
            Đang hiện {SKELETON_ROW_COUNT} khách hàng mới đăng ký gần đây nhất — nhập tiêu chí ở trên để tìm chính xác hơn.
          </p>
        )}

        <div className="max-h-[50vh] overflow-y-auto scroll-hover">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th className={thClassNameLeft}>Họ tên</th>
                <th className={thClassName}>Số CCCD</th>
                <th className={thClassName}>Số điện thoại</th>
                <th className={thClassNameLeft}>Địa chỉ</th>
                <th className={thClassName}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-4 py-2.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Skeleton className="mx-auto h-4 w-20" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Skeleton className="mx-auto h-4 w-24" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Skeleton className="mx-auto h-6 w-14" />
                    </td>
                  </tr>
                ))}
              {!isLoading && results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <UsersThree size={28} weight="regular" className="mx-auto mb-2 text-slate-300" aria-hidden="true" />
                    <p className="text-sm text-slate-400">
                      {hasQuery ? 'Không tìm thấy khách hàng nào khớp.' : 'Chưa có khách hàng nào trong hệ thống.'}
                    </p>
                  </td>
                </tr>
              )}
              {!isLoading &&
                results.map((patient) => (
                  <tr key={patient.id} className="border-b border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{patient.fullName}</td>
                    <td className="px-4 py-2.5 text-center font-medium text-slate-600">{patient.nationalIdMasked ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center font-medium text-slate-600">{patient.phone}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-600">{formatAddressLine(patient.address, provinceNameByCode, wardNameByCode) || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Button type="button" variant="secondary" onClick={() => onPick(patient)} className="px-2.5 py-1 text-xs">
                        Chọn
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}