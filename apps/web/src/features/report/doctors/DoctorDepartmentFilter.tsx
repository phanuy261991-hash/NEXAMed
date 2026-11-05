import { useMemo, type ReactNode } from 'react';
import { Combobox } from '../../../shared/ui/Combobox';
import { useDepartmentOptionsQuery } from '../../department/department.queries';

/** Bộ lọc "Khoa" của trang báo cáo Bác sĩ: "Tất cả khoa" hoặc một Khoa. Danh sách Khoa tải lỗi thì vẫn xem được báo cáo (chỉ mất bộ lọc). */
export function DoctorDepartmentFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const query = useDepartmentOptionsQuery(false);
  const options = useMemo(() => [{ value: '', label: 'Tất cả khoa' }, ...(query.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))], [query.data]);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="doctor-report-department" className="text-sm font-semibold text-slate-800">
        Khoa
      </label>
      <div className="w-[200px]">
        <Combobox id="doctor-report-department" value={value} options={options} onChange={onChange} placeholder="Tất cả khoa" />
      </div>
    </div>
  );
}

/** Bộ lọc Khoa dùng chung của ba tab: id đang chọn (rỗng = mọi Khoa), tên Khoa cho bản in và ô chọn đặt cạnh bộ chọn Kỳ. */
export interface DoctorFilterState {
  departmentId: string;
  departmentLabel: string | null;
  control: ReactNode;
}
