import { CheckCircle, Warning } from '@phosphor-icons/react';
import { dicomNameMatches } from './dicom-decode';
import type { DicomFileState } from './use-dicom-file';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-px">
      <span className="text-[13px] font-medium text-slate-500">{label}</span>
      <span className="break-words text-[15px] font-semibold">{value}</span>
    </div>
  );
}

/**
 * Các dòng thông tin lấy từ chính tệp DICOM ở cột chi tiết (mockup B4): ngày chụp, máy/vị trí, đối chiếu tên với hồ sơ, chuỗi ảnh trong tệp. Chỉ hiện khi đã đọc được tệp.
 */
export function DicomInfoRows({ state, recordName, acknowledged }: { state: DicomFileState; recordName: string; acknowledged: boolean }) {
  if (state.status !== 'ready') return null;
  const { info } = state.image;
  const when = [info.studyDate, info.studyTime].filter(Boolean).join(' ');
  const what = [info.modality, info.bodyPart || info.seriesDescription].filter(Boolean).join(' · ');
  const matches = dicomNameMatches(info.patientName, recordName);
  return (
    <>
      {when && <Row label="Ngày chụp" value={when} />}
      {what && <Row label="Máy / vị trí" value={what} />}
      {info.patientName &&
        (matches ? (
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
            <CheckCircle size={15} weight="fill" aria-hidden="true" /> Tên trong tệp khớp hồ sơ
          </div>
        ) : (
          <div role="status" className="flex items-start gap-1.5 text-[13px] font-semibold text-amber-700">
            <Warning size={15} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{acknowledged ? 'Tên trong tệp khác hồ sơ' : 'Tên trong tệp khác hồ sơ, cần kiểm tra'}</span>
          </div>
        ))}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-slate-800">Chuỗi ảnh trong tệp</span>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[13px]">
          <div className="font-semibold text-slate-900">{info.seriesDescription || (info.modality ? `Ảnh ${info.modality}` : 'Ảnh')}</div>
          <div className="text-xs text-slate-500">{info.frameCount} khung</div>
        </div>
      </div>
    </>
  );
}
