import { useEffect } from 'react';
import { DownloadSimple, X } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { downloadPatientDocument } from '../patient-document/patient-document.api';
import { formatBytes } from '../patient-document/patient-document-view';
import { DicomInfoRows } from './DicomInfo';
import { DicomPanel, useMismatchAck } from './DicomPanel';
import { useDicomFile } from './use-dicom-file';

/**
 * Hộp xem lớn một tệp DICOM của kết quả cận lâm sàng (docs/DECISIONS.md #299 bổ sung 6, mockup B4): vùng xem tối bên trái, cột chi tiết 300px bên phải, cùng khung với hộp xem của tab hồ sơ.
 * Chỉ dùng khi công tắc "Dùng tệp DICOM" bật (người gọi kiểm). Esc đóng.
 */
export function DicomViewerDialog({
  title,
  fileName,
  url,
  sizeBytes,
  typeLabel,
  recordName,
  onClose,
}: {
  title: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  /** Dòng "Loại" ở cột chi tiết (ví dụ "Kết quả cận lâm sàng"). */
  typeLabel: string;
  /** Tên bệnh nhân trong hồ sơ để đối chiếu với tên ghi trong tệp. */
  recordName: string;
  onClose: () => void;
}) {
  const { state, retry } = useDicomFile(url, true);
  const [acknowledged, acknowledge] = useMismatchAck(url);

  useEffect(() => {
    // Bắt ở giai đoạn capture rồi chặn lan: trình xem có thể mở chồng lên hộp khác (hộp xem kết quả) cũng nghe Esc — chỉ đóng lớp trên cùng.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const download = () => downloadPatientDocument({ url, fileName });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="grid max-h-full w-full max-w-[1000px] grid-cols-[minmax(0,1fr)_300px] overflow-hidden rounded-xl bg-[#0b1220] shadow-xl max-md:grid-cols-1 max-md:overflow-y-auto">
        <div className="flex min-h-[420px] min-w-0 flex-col p-4 text-slate-200">
          <div className="mb-2 truncate text-sm font-semibold">{title}</div>
          <div className="h-[calc(100dvh-9rem)] min-h-[420px] max-md:h-[60dvh]">
            <DicomPanel state={state} retry={retry} recordName={recordName} onDownload={download} mismatchAcknowledged={acknowledged} onAcknowledgeMismatch={acknowledge} />
          </div>
        </div>
        <div className="flex flex-col gap-3 bg-white p-4 text-slate-900">
          <div className="flex items-center">
            <h2 className="text-base font-semibold">Chi tiết tệp</h2>
            <div className="flex-1" />
            <button type="button" aria-label="Đóng" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-medium text-slate-500">Tên tệp</span>
            <span className="break-words text-[15px] font-semibold">{fileName}</span>
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-medium text-slate-500">Loại</span>
            <span className="text-[15px] font-semibold">{typeLabel}</span>
          </div>
          <DicomInfoRows state={state} recordName={recordName} acknowledged={acknowledged} />
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-medium text-slate-500">Dung lượng</span>
            <span className="text-[15px] font-semibold">{formatBytes(sizeBytes)}</span>
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={download}>
              <DownloadSimple size={16} aria-hidden="true" /> Tải về
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
