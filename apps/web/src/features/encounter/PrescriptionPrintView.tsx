import { useMemo } from 'react';
import type { PrescriptionDocument, PrescriptionItem, PrescriptionPrintInfo } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { Code128Barcode } from '../../shared/print/Code128Barcode';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { PRESCRIPTION_KIND_TEXT } from '../../shared/ui/PrescriptionKindChip';
import { quantityInWords } from '../../shared/format/vietnamese-number-words';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';
import { formatAddressLine } from '../patient/patient-form.utils';
import { formatDoseSummaryPreview as formatDoseSummary } from './prescription-dose-preview';
import { ALL_ON_PRESCRIPTION_INFO, resolvePrescriptionPrintFields, type PrintField } from './prescription-print-fields';
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
  /** Thông tin bệnh nhân in thêm (mã BN, CCCD, địa chỉ, SĐT, cân nặng, giám hộ) — lấy khi bấm In; `null`/bỏ trống = chưa nạp, các ô phụ thuộc dữ liệu tự ẩn. */
  printInfo?: PrescriptionPrintInfo | null;
}

/** Dòng chấm để viết tay (đơn "N"/"H", cân nặng chưa đo...). */
function Dots({ className = 'min-w-[7rem]' }: { className?: string }) {
  return <span className={`inline-block h-[1em] border-b border-dotted border-slate-700 align-baseline ${className}`} aria-hidden="true" />;
}

/** Giá trị của một ô: có chữ thì in đậm, chưa có thì dòng chấm. */
function FieldValue({ field }: { field: PrintField }) {
  return field.mode === 'value' ? <strong>{field.value}</strong> : <Dots />;
}

/**
 * Tiêu đề từng loại đơn (docs/DECISIONS.md #242). C/N/H đúng tên mẫu của Thông tư 52/2017/TT-BYT (Phụ lục I–III): "ĐƠN THUỐC", "ĐƠN THUỐC “N”", "ĐƠN THUỐC “H”" — dấu ngoặc kép CONG,
 * chữ in hoa do khung in tự viết hoa tiêu đề. Y (thuốc cổ truyền): chủ dự án chốt (20/10/2026) chỉ dùng "Đơn thuốc", như đơn C — không đặt tên mẫu riêng.
 */
const KIND_TITLE: Record<PrescriptionDocument['kind'], string> = {
  C: 'Đơn thuốc',
  N: 'Đơn thuốc “N”',
  H: 'Đơn thuốc “H”',
  Y: 'Đơn thuốc',
};

/**
 * Bản in đơn thuốc (PRE-04) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `PRESCRIPTION`
 * ("Quản lý mẫu in", docs/DECISIONS.md #211), file này chỉ giữ phần THÂN (thông tin bệnh nhân + bảng thuốc). Nhận dữ
 * liệu qua props, không tự gọi API nghiệp vụ.
 *
 * Đơn ký ở chế độ "Chuẩn Bộ Y tế" (#242) có `documents`: MỖI ĐƠN PHÁP LÝ MỘT TỜ (ngắt trang giữa các tờ), tiêu đề theo loại, mã cơ sở KCB ở ĐẦU PHIẾU (`headerExtra`), số đơn ở đầu thân, mã vạch
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
  printInfo = null,
  document,
  pageLabel,
}: PrescriptionPrintBodyProps & { document?: PrescriptionDocument; pageLabel?: string }) {
  const unitNameByCode = useUnitNameByCode();
  const provincesQuery = useProvincesQuery();
  const wardsQuery = useAllWardsQuery();
  const provinceNameByCode = useMemo(() => Object.fromEntries((provincesQuery.data?.items ?? []).map((p) => [p.code, p.name])), [provincesQuery.data]);
  const wardNameByCode = useMemo(() => Object.fromEntries((wardsQuery.data?.items ?? []).map((w) => [w.code, w.name])), [wardsQuery.data]);
  const addressLine = formatAddressLine(printInfo?.address ?? null, provinceNameByCode, wardNameByCode);
  return (
    <PrintDocument
      documentType="PRESCRIPTION"
      title={document ? KIND_TITLE[document.kind] : 'Đơn thuốc'}
      // Đơn "N"/"H" có tên mẫu bắt buộc (Thông tư 52/2017) — bản mẫu in không được đổi thành "Toa thuốc"...
      fixedTitle={document?.kind === 'N' || document?.kind === 'H'}
      subtitle={document ? <span>Loại đơn: {document.kind} — {PRESCRIPTION_KIND_TEXT[document.kind]}</span> : undefined}
      signatureDateText={formatPrintDate(signedAt)}
      signatures={[{ label: 'Bác sĩ kê đơn', name: doctorName }]}
      headerExtra={
        document ? (
          <>
            Mã cơ sở KCB: <strong>{document.nationalCode.slice(0, 5)}</strong>
          </>
        ) : undefined
      }
    >
      {({ config }) => {
        const fields = resolvePrescriptionPrintFields({ config: config.prescriptionInfo ?? ALL_ON_PRESCRIPTION_INFO, kind: document?.kind ?? null, printInfo, addressLine });
        return (
      <>
      {document && (
        <div className="mt-3 flex items-start justify-end gap-4 text-sm">
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
          Ngày sinh: <strong>{patientDob}</strong> · Giới tính: <strong>{patientGender}</strong>
        </p>
        {fields.patientCode.mode === 'value' && (
          <p>
            Mã bệnh nhân: <strong>{fields.patientCode.value}</strong>
          </p>
        )}
        {fields.nationalId.mode !== 'hidden' && (
          <p>
            CCCD: <FieldValue field={fields.nationalId} />
          </p>
        )}
        {fields.weight.mode !== 'hidden' && (
          <p>
            Cân nặng: <FieldValue field={fields.weight} />
          </p>
        )}
        {fields.phone.mode === 'value' && (
          <p>
            Điện thoại: <strong>{fields.phone.value}</strong>
          </p>
        )}
        <p>
          Bác sĩ khám: <strong>{doctorName}</strong>
        </p>
        {fields.address.mode === 'value' && (
          <p className="col-span-2">
            Địa chỉ: <strong>{fields.address.value}</strong>
          </p>
        )}
        {fields.guardian && (
          <p className="col-span-2">
            Người giám hộ (trẻ dưới 72 tháng):{' '}
            {fields.guardian.name ? (
              <strong>
                {fields.guardian.name}
                {fields.guardian.relationship ? ` (${fields.guardian.relationship})` : ''}
              </strong>
            ) : (
              <Dots className="min-w-[9rem]" />
            )}{' '}
            · CCCD: <Dots />
          </p>
        )}
        {diagnosisLabel && (
          <p className="col-span-2">
            Chẩn đoán: <strong>{diagnosisLabel}</strong>
          </p>
        )}
        {fields.course && (
          <p className="col-span-2">
            Đợt <Dots className="min-w-[2.5rem]" /> (từ ngày <Dots className="min-w-[4rem]" /> đến hết ngày <Dots className="min-w-[4rem]" />)
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
                {/* Thuốc gây nghiện phải viết số lượng bằng chữ, chữ đầu viết hoa (Thông tư 52/2017/TT-BYT, điều 6). */}
                {fields.quantityInWords && <div className="text-xs italic">{quantityInWords(item.quantity, item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : '')}</div>}
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

      {fields.receiverBox && (
        <div className="mt-4 break-inside-avoid border border-slate-700 px-3 py-2 text-sm">
          Người nhận thuốc (ký, ghi rõ họ tên): <Dots className="min-w-[10rem]" /> · Số CCCD/CMND: <Dots className="min-w-[8rem]" />
        </div>
      )}

      {document && (
        <div className="mt-5 flex flex-col items-center break-inside-avoid">
          <Code128Barcode value={document.nationalCode} className="h-10 w-64 text-black" title={`Mã vạch ${document.nationalCode}`} />
          <p className="mt-1 text-xs tracking-widest">{document.nationalCode}</p>
        </div>
      )}
      </>
        );
      }}
    </PrintDocument>
  );
}
