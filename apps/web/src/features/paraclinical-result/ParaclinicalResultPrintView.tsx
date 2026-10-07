import type { ParaclinicalResultForm, ParaclinicalResultSection } from '@nexamed/shared';
import { resolveApiUrl } from '../../shared/api/client';
import { formatDobDisplay } from '../../shared/format/date';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatDateTimeVn, genderShort } from './paraclinical-result-labels';

function documentTitle(sections: ParaclinicalResultSection[]): string {
  if (sections.every((s) => s.serviceKind === 'LAB')) return 'Kết quả xét nghiệm';
  if (sections.every((s) => s.serviceKind === 'IMAGING')) return 'Kết quả chẩn đoán hình ảnh';
  return 'Kết quả cận lâm sàng';
}

const KHUYEN_CAO = [
  'Kết quả phụ thuộc vào mẫu xét nghiệm được thu thập và chất lượng của mẫu.',
  'Xét nghiệm là công cụ giúp chẩn đoán, cần tương quan với lâm sàng bởi bác sĩ chỉ định.',
  'Mẫu lặp lại được chấp nhận theo yêu cầu của bác sĩ chỉ định trong vòng 24 giờ sau khi trả kết quả.',
  'Kết quả có thể khác nhau giữa các phòng xét nghiệm khác nhau.',
];

/**
 * Bản in "Kết quả cận lâm sàng" (Cận lâm sàng GĐ4 đợt 2, docs/DECISIONS.md #214, mockup `PhieuKetQua`/`PhieuKetQuaCuoi`). Khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo
 * bản mẫu `PARACLINICAL_RESULT` ("Quản lý mẫu in"); file này giữ phần THÂN: thông tin bệnh nhân + mốc thời gian + bảng kết quả theo nhóm lĩnh vực → dịch vụ → chỉ số.
 * Thông tin bệnh nhân và tiêu đề cột nằm trong `<thead>` nên trình duyệt LẶP lại ở mọi trang in. Chỉ số vượt khoảng tham chiếu in ĐẬM + GẠCH CHÂN (cờ do API tính,
 * bản đã duyệt dùng khoảng tham chiếu đã chụp lại). Nhận dữ liệu qua props, không tự gọi API.
 */
export function ParaclinicalResultPrintView({ form, display = 'print' }: { form: ParaclinicalResultForm; display?: 'print' | 'screen' }) {
  const signed = form.signedAt !== null;
  const hasLab = form.sections.some((s) => s.serviceKind === 'LAB');
  /** Phiếu chỉ có mô tả + kết luận (siêu âm, X-quang...) không cần bảng 4 cột của xét nghiệm. */
  const hasIndicators = form.sections.some((s) => s.indicators.length > 0);
  const timeline: [string, string | null][] = [
    ['Đăng ký', form.registeredAt],
    [hasLab ? 'Lấy mẫu' : 'Gọi vào phòng', form.collectedAt],
    ['Có kết quả', form.resultedAt],
  ];

  let lastCategory: string | null | undefined;
  return (
    <PrintDocument
      documentType="PARACLINICAL_RESULT"
      title={documentTitle(form.sections)}
      subtitle={`Số: ${form.orderNo}`}
      signatures={[{ label: 'Bác sĩ duyệt kết quả', name: form.signedByName }]}
      signatureDateText={form.signedAt ? formatPrintDate(form.signedAt) : undefined}
      display={display}
    >
      <div>
        {!signed && <p className="mt-2 text-center text-xs font-bold uppercase text-slate-600">Bản nháp — kết quả chưa được duyệt</p>}
        <table className="mt-3 w-full border-collapse text-[0.92em]">
          <thead className="table-header-group">
            <tr>
              <td colSpan={4} className="pb-2">
                <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-0.5 border-b border-slate-300 pb-2">
                  <span className="text-slate-500">Tên bệnh nhân</span>
                  <strong className="uppercase">{form.patientName}</strong>
                  <span className="text-slate-500">Mã hồ sơ</span>
                  <strong>{form.patientCode}</strong>
                  <span className="text-slate-500">Giới tính</span>
                  <strong>{genderShort(form.patientGender)}</strong>
                  <span className="text-slate-500">Mã phiếu</span>
                  <strong>{form.orderNo}</strong>
                  <span className="text-slate-500">Ngày sinh</span>
                  <strong>
                    {formatDobDisplay(form.patientDob)}
                    {form.ageYears !== null ? ` (${form.ageYears} tuổi)` : ''}
                  </strong>
                  <span className="text-slate-500">Bác sĩ chỉ định</span>
                  <strong>{form.doctorName ?? '—'}</strong>
                  {form.patientPhone && (
                    <>
                      <span className="text-slate-500">Điện thoại</span>
                      <strong>{form.patientPhone}</strong>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-0.5 pt-1.5">
                  {timeline
                    .filter(([, at]) => at !== null)
                    .map(([label, at]) => (
                      <span key={label}>
                        <span className="text-slate-500">{label}</span> <strong>{formatDateTimeVn(at as string)}</strong>
                      </span>
                    ))}
                </div>
              </td>
            </tr>
            {hasIndicators && (
              <tr className="border-y border-slate-500 text-left font-bold">
                <th className="w-[38%] px-2 py-1.5 font-bold">{hasLab ? 'TÊN XÉT NGHIỆM' : 'DỊCH VỤ'}</th>
                <th className="w-[20%] px-2 py-1.5 font-bold">KẾT QUẢ</th>
                <th className="w-[26%] px-2 py-1.5 font-bold">KHOẢNG THAM CHIẾU</th>
                <th className="px-2 py-1.5 font-bold">ĐƠN VỊ</th>
              </tr>
            )}
          </thead>
          <tbody>
            {form.sections.map((section) => {
              const showCategory = section.categoryName !== lastCategory && section.categoryName !== null;
              lastCategory = section.categoryName;
              return (
                <SectionRows key={section.itemId} section={section} categoryHeader={showCategory ? section.categoryName : null} />
              );
            })}
          </tbody>
        </table>

        {hasLab && (
          <div className="mt-3 break-inside-avoid text-[0.82em] leading-relaxed text-slate-600">
            <p className="font-bold text-slate-800">Khuyến cáo khách hàng:</p>
            {KHUYEN_CAO.map((line) => (
              <p key={line}>- {line}</p>
            ))}
          </div>
        )}
      </div>
    </PrintDocument>
  );
}

function SectionRows({ section, categoryHeader }: { section: ParaclinicalResultSection; categoryHeader: string | null }) {
  const meta = [section.specimenTypeName, section.departmentName].filter(Boolean).join(' · ');
  /** Dịch vụ chỉ có mô tả + kết luận (siêu âm, X-quang, điện tim...): trình bày dạng khối, không đóng bảng 4 cột. */
  const narrativeOnly = section.indicators.length === 0;
  return (
    <>
      {categoryHeader && (
        <tr className="break-after-avoid">
          <td colSpan={4} className="border-b border-slate-300 px-2 pb-1 pt-3 text-[1.05em] font-bold uppercase">
            {categoryHeader}
          </td>
        </tr>
      )}
      <tr className="break-after-avoid">
        <td colSpan={4} className="border-b border-slate-200 px-2 py-1.5">
          <div className={narrativeOnly ? 'text-[1.1em] font-bold uppercase' : 'font-bold italic'}>{section.name}</div>
          {meta && <div className="text-[0.85em] text-slate-500">{meta}</div>}
        </td>
      </tr>

      {section.indicators.map((ind) => {
        const abnormal = ind.flag === 'HIGH' || ind.flag === 'LOW' || ind.flag === 'ABNORMAL';
        return (
          <FragmentRows key={ind.indicatorId}>
            <tr className="break-inside-avoid border-b border-slate-200 align-top">
              <td className="py-1 pl-5 pr-2">
                {ind.name}
                {ind.abbreviation ? ` (${ind.abbreviation})` : ''}
              </td>
              <td className={`px-2 py-1 ${abnormal ? 'font-bold underline' : ''}`}>{ind.valueText ?? ''}</td>
              <td className="whitespace-pre-line px-2 py-1 text-slate-700">{ind.referenceText}</td>
              <td className="px-2 py-1 text-slate-700">{ind.unit ?? ''}</td>
            </tr>
            {ind.note && (
              <tr className="break-inside-avoid border-b border-slate-200">
                <td colSpan={4} className="py-0.5 pl-5 text-[0.9em] italic text-slate-600">
                  Ghi chú: {ind.note}
                </td>
              </tr>
            )}
            {ind.interpretationText && ind.valueText && (
              <tr className="break-inside-avoid border-b border-slate-200 bg-slate-50">
                <td colSpan={4} className="px-2 py-1 text-[0.9em]">
                  <span className="font-bold">Diễn giải: </span>
                  {ind.interpretationText}
                </td>
              </tr>
            )}
          </FragmentRows>
        );
      })}

      {narrativeOnly ? (
        <>
          {section.descriptionText && (
            <tr>
              <td colSpan={4} className="px-2 pb-1 pt-3">
                <div className="font-bold">Mô tả hình ảnh</div>
                <div className="mt-1 whitespace-pre-line leading-relaxed">{section.descriptionText}</div>
              </td>
            </tr>
          )}
          {section.conclusionText && (
            <tr className="break-inside-avoid">
              <td colSpan={4} className="px-2 pb-2 pt-3">
                <div className="font-bold">Kết luận</div>
                <div className="mt-1 whitespace-pre-line text-[1.08em] font-bold leading-relaxed">{section.conclusionText}</div>
              </td>
            </tr>
          )}
          {section.images.length > 0 && (
            <tr className="break-inside-avoid">
              <td colSpan={4} className="px-2 pb-2 pt-2">
                <div className="mb-1 font-bold">Hình ảnh</div>
                <div className="grid grid-cols-2 gap-2">
                  {section.images.map((img) => (
                    <div key={img.id} className="break-inside-avoid overflow-hidden rounded border border-slate-300">
                      <img src={resolveApiUrl(img.url)} alt={img.fileName} className="h-44 w-full object-contain" />
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          )}
        </>
      ) : (
        <>
          {section.descriptionText && (
            <tr className="break-inside-avoid border-b border-slate-200">
              <td colSpan={4} className="whitespace-pre-line px-2 py-1.5">
                <span className="font-bold">Mô tả: </span>
                {section.descriptionText}
              </td>
            </tr>
          )}
          {section.conclusionText && (
            <tr className="break-inside-avoid border-b border-slate-200">
              <td colSpan={4} className="whitespace-pre-line px-2 py-1.5">
                <span className="font-bold">{section.resultType === 'INDICATORS' ? 'Nhận xét: ' : 'Kết luận: '}</span>
                <span className={section.resultType === 'INDICATORS' ? '' : 'font-bold'}>{section.conclusionText}</span>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

/** Nhóm nhiều `<tr>` mà không thêm phần tử DOM (React fragment) — đặt tên để đọc code dễ hơn. */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
