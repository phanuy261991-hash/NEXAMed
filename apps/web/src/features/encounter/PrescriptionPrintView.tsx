import type { PrescriptionItem } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatDoseSummaryPreview as formatDoseSummary } from './prescription-dose-preview';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';

/**
 * Bản in đơn thuốc (PRE-04) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `PRESCRIPTION`
 * ("Quản lý mẫu in", docs/DECISIONS.md #211), file này chỉ giữ phần THÂN (thông tin bệnh nhân + bảng thuốc). Nhận dữ
 * liệu qua props, không tự gọi API nghiệp vụ.
 */
export function PrescriptionPrintView({
  doctorName,
  patientFullName,
  patientDob,
  patientGender,
  diagnosisLabel,
  items,
  signedAt,
}: {
  doctorName: string;
  patientFullName: string;
  patientDob: string;
  patientGender: string;
  /** Chẩn đoán của lượt khám (ví dụ "Viêm họng cấp (J02.9) / Sốt (R50.9)"); rỗng thì không in dòng này. */
  diagnosisLabel?: string;
  items: PrescriptionItem[];
  signedAt: string;
}) {
  const unitNameByCode = useUnitNameByCode();
  return (
    <PrintDocument documentType="PRESCRIPTION" title="Đơn thuốc" signatureDateText={formatPrintDate(signedAt)} signatures={[{ label: 'Bác sĩ kê đơn', name: doctorName }]}>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
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
        {diagnosisLabel && (
          <p className="col-span-2">
            Chẩn đoán: <strong>{diagnosisLabel}</strong>
          </p>
        )}
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên thuốc</th>
            <th className="py-1.5">Liều dùng theo buổi</th>
            <th className="w-16 py-1.5 text-center">Số ngày</th>
            <th className="w-20 py-1.5 text-center">SL</th>
            <th className="py-1.5">Hướng dẫn</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">{item.drugName}</td>
              <td className="py-1.5">{formatDoseSummary(item)}</td>
              <td className="py-1.5 text-center">{item.durationDays}</td>
              <td className="py-1.5 text-center">
                {item.quantity} {item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : ''}
              </td>
              <td className="py-1.5">{item.instruction ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintDocument>
  );
}
