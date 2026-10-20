import type { PrescriptionDocument, PrescriptionItem } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { Code128Barcode } from '../../shared/print/Code128Barcode';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { PRESCRIPTION_KIND_TEXT } from '../../shared/ui/PrescriptionKindChip';
import { formatDoseSummaryPreview as formatDoseSummary } from './prescription-dose-preview';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';

interface PrescriptionPrintBodyProps {
  doctorName: string;
  patientFullName: string;
  patientDob: string;
  patientGender: string;
  /** Chẩn đoán của lượt khám (ví dụ "Viêm họng cấp (J02.9) / Sốt (R50.9)"); rỗng thì không in dòng này. */
  diagnosisLabel?: string;
  items: PrescriptionItem[];
  signedAt: string;
  /** Lời dặn bác sĩ của lượt khám (docs/DECISIONS.md #222) — rỗng thì không in. */
  advice?: string;
  /** "Thứ Năm, 15/10/2026" — chỉ có khi bác sĩ chọn hướng "Hẹn tái khám"; rỗng thì không in. */
  followUpLabel?: string;
}

/** Tiêu đề từng loại đơn (đề xuất, CẦN dược sĩ đối chiếu mẫu in chính thức trước khi dùng thật — docs/DECISIONS.md #242). */
const KIND_TITLE: Record<PrescriptionDocument['kind'], string> = {
  C: 'Đơn thuốc',
  N: 'Đơn thuốc "N"',
  H: 'Đơn thuốc "H"',
  Y: 'Đơn thuốc y học cổ truyền',
};

/**
 * Bản in đơn thuốc (PRE-04) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `PRESCRIPTION`
 * ("Quản lý mẫu in", docs/DECISIONS.md #211), file này chỉ giữ phần THÂN (thông tin bệnh nhân + bảng thuốc). Nhận dữ
 * liệu qua props, không tự gọi API nghiệp vụ.
 *
 * Đơn ký ở chế độ "Chuẩn Bộ Y tế" (#242) có `documents`: MỖI ĐƠN PHÁP LÝ MỘT TỜ (ngắt trang giữa các tờ), tiêu đề theo loại, số đơn + mã cơ sở KCB ở đầu thân, mã vạch
 * Code 128 của mã đơn ở cuối thân (nhà thuốc quét để tra đơn). `printDocumentId` chọn in MỘT tờ; bỏ trống = in tất cả. Không có `documents` (đơn cũ hoặc chế độ tắt) = in như trước.
 */
export function PrescriptionPrintView({
  documents,
  printDocumentId,
  ...body
}: PrescriptionPrintBodyProps & {
  documents?: PrescriptionDocument[];
  printDocumentId?: string | null;
}) {
  if (!documents || documents.length === 0) {
    return <PrescriptionSheet {...body} />;
  }
  const shown = printDocumentId ? documents.filter((d) => d.id === printDocumentId) : documents;
  return (
    <div className="print-stack">
      {shown.map((doc) => (
        <PrescriptionSheet
          key={doc.id}
          {...body}
          items={body.items.filter((i) => doc.itemIds.includes(i.id))}
          document={doc}
          pageLabel={documents.length > 1 ? `Tờ ${documents.findIndex((d) => d.id === doc.id) + 1}/${documents.length}` : undefined}
        />
      ))}
    </div>
  );
}

function PrescriptionSheet({
  doctorName,
  patientFullName,
  patientDob,
  patientGender,
  diagnosisLabel,
  items,
  signedAt,
  advice,
  followUpLabel,
  document,
  pageLabel,
}: PrescriptionPrintBodyProps & { document?: PrescriptionDocument; pageLabel?: string }) {
  const unitNameByCode = useUnitNameByCode();
  return (
    <PrintDocument
      documentType="PRESCRIPTION"
      title={document ? KIND_TITLE[document.kind] : 'Đơn thuốc'}
      subtitle={document ? <span>Loại đơn: {document.kind} — {PRESCRIPTION_KIND_TEXT[document.kind]}</span> : undefined}
      signatureDateText={formatPrintDate(signedAt)}
      signatures={[{ label: 'Bác sĩ kê đơn', name: doctorName }]}
    >
      {document && (
        <div className="mt-3 flex items-start justify-between gap-4 text-sm">
          <p>
            Mã cơ sở KCB: <strong>{document.nationalCode.slice(0, 5)}</strong>
          </p>
          <p className="text-right">
            {pageLabel && <span className="mr-3 text-xs text-slate-500">{pageLabel}</span>}
            Số: <strong>{document.nationalCode}</strong>
          </p>
        </div>
      )}
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

      {(advice?.trim() || followUpLabel) && (
        <div className="mt-5 space-y-1">
          {advice?.trim() && (
            <p className="whitespace-pre-line">
              Lời dặn: <strong>{advice.trim()}</strong>
            </p>
          )}
          {followUpLabel && (
            <p>
              Hẹn tái khám: <strong>{followUpLabel}</strong>
            </p>
          )}
        </div>
      )}

      {document && (
        <div className="mt-5 flex flex-col items-center break-inside-avoid">
          <Code128Barcode value={document.nationalCode} className="h-10 w-64 text-black" title={`Mã vạch ${document.nationalCode}`} />
          <p className="mt-1 text-xs tracking-widest">{document.nationalCode}</p>
        </div>
      )}
    </PrintDocument>
  );
}
