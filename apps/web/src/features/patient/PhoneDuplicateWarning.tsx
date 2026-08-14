import { formatDobDisplay } from '../../shared/format/date';
import { usePatientByPhoneQuery } from './patient.queries';

/**
 * Cảnh báo mềm khi SĐT đã dùng cho hồ sơ khác — KHÔNG chặn lưu (yêu cầu chủ dự án: SĐT được phép
 * trùng thật sự, ví dụ một phụ huynh dùng chung SĐT cho nhiều con; chỉ CCCD mới chặn trùng, xem
 * `patient.national_id_hash` unique constraint). Đặt ở `features/patient/` (không phải
 * `shared/ui`) vì gắn chặt với `usePatientByPhoneQuery` của domain bệnh nhân — dùng lại được ở cả
 * `PatientFormFields` (form Thêm mới/Sửa/tạo nhanh trong `PatientPicker`, vì cả ba đều render qua
 * cùng component form) mà không cần định nghĩa lại.
 */
export function PhoneDuplicateWarning({ phone, excludePatientId }: { phone: string; excludePatientId?: string }) {
  const query = usePatientByPhoneQuery(phone, excludePatientId);
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <p className="mt-1.5 text-xs text-amber-700">
      Số điện thoại này đã dùng cho: {items.map((p) => `${p.fullName} (${p.patientCode}, sinh ${formatDobDisplay(p.dob)})`).join(', ')}. Vẫn có thể
      lưu bình thường (ví dụ người thân
      dùng chung số điện thoại).
    </p>
  );
}
