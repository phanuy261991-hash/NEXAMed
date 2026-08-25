import type { PrescriptionItem } from '@nexamed/shared';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  return `Ngày ${String(d.getDate()).padStart(2, '0')} tháng ${String(d.getMonth() + 1).padStart(2, '0')} năm ${d.getFullYear()}`;
}

/**
 * Bố cục in đơn thuốc (PRE-04) — CHƯA CÓ mẫu chính thức (plan.md T5 còn treo lúc viết), dựng bố
 * cục chuẩn tạm theo thông tin bắt buộc thường thấy trên đơn thuốc VN, điều chỉnh lại khi có mẫu
 * thật (xem `docs/DECISIONS.md`). Nhận dữ liệu qua props (không tự gọi API/tự lấy dữ liệu) để dùng
 * lại được cho BIL-02 sau này chỉ cần đổi component nội dung — chỉ phần khung `.print-area`/kỹ
 * thuật `@media print` (`apps/web/src/app/index.css`) là dùng chung thật sự.
 */
export function PrescriptionPrintView({
  clinicName,
  clinicAddress,
  clinicPhone,
  printLogoUrl,
  doctorName,
  patientFullName,
  patientDob,
  patientGender,
  items,
  signedAt,
}: {
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  printLogoUrl: string | null;
  doctorName: string;
  patientFullName: string;
  patientDob: string;
  patientGender: string;
  items: PrescriptionItem[];
  signedAt: string;
}) {
  return (
    <div className="print-area hidden bg-white p-10 text-slate-900 print:block">
      <div className="flex items-center gap-4 border-b-2 border-slate-800 pb-3">
        {printLogoUrl && <img src={printLogoUrl} alt="" className="h-16 w-16 object-contain" />}
        <div>
          <p className="text-lg font-bold uppercase">{clinicName}</p>
          {clinicAddress && <p className="text-sm">Địa chỉ: {clinicAddress}</p>}
          {clinicPhone && <p className="text-sm">Điện thoại: {clinicPhone}</p>}
        </div>
      </div>

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Đơn thuốc</h1>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <p>
          Họ tên bệnh nhân: <strong>{patientFullName}</strong>
        </p>
        <p>
          Ngày sinh: <strong>{patientDob}</strong>
        </p>
        <p>
          Giới tính: <strong>{patientGender}</strong>
        </p>
        <p>
          Bác sĩ khám: <strong>{doctorName}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên thuốc</th>
            <th className="py-1.5">Liều dùng</th>
            <th className="py-1.5">Tần suất</th>
            <th className="w-16 py-1.5 text-center">Số ngày</th>
            <th className="w-16 py-1.5 text-center">SL</th>
            <th className="py-1.5">Hướng dẫn</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">{item.drugName}</td>
              <td className="py-1.5">{item.dose}</td>
              <td className="py-1.5">{item.frequency}</td>
              <td className="py-1.5 text-center">{item.durationDays}</td>
              <td className="py-1.5 text-center">{item.quantity}</td>
              <td className="py-1.5">{item.instruction ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-10 flex justify-end">
        <div className="text-center text-sm">
          <p>{formatPrintDate(signedAt)}</p>
          <p className="mt-1 font-semibold">Bác sĩ kê đơn</p>
          <p className="mt-16 font-semibold">{doctorName}</p>
        </div>
      </div>
    </div>
  );
}
