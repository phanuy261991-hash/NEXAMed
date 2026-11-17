import { useRef, useState } from 'react';
import { Plus, Trash, Warning } from '@phosphor-icons/react';
import type { ParaclinicalResultDicom } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { DicomViewerDialog } from '../dicom/DicomViewerDialog';
import { formatBytes } from '../patient-document/patient-document-view';
import { downloadPatientDocument } from '../patient-document/patient-document.api';

/** Giới hạn tệp DICOM gốc của một kết quả — khai lại vì apps/web chỉ import KIỂU từ shared; test chống lệch ở apps/api (patient-document-constants-drift.spec.ts). */
export const PARACLINICAL_DICOM_MAX_COUNT = 4;
export const PARACLINICAL_DICOM_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Khối "Tệp DICOM gốc" của kết quả chẩn đoán hình ảnh/thăm dò (docs/DECISIONS.md #299 bổ sung 6, mockup B2/B3), nằm dưới khối "Hình ảnh đính kèm". CHỈ hiện khi công tắc "Dùng tệp DICOM" bật.
 * Mỗi tệp: tên, dung lượng, "Xem" (trình xem DICOM trong trình duyệt), "Gỡ" khi còn sửa được hoặc "Tải về" khi đã duyệt. Tối đa 4 tệp, 50 MB mỗi tệp. Kết quả chỉ có DICOM (không ảnh JPG/PNG)
 * vẫn duyệt được nhưng hiện cảnh báo vàng vì phiếu in không in được DICOM.
 */
export function ResultDicomPanel({
  files,
  hasImages,
  editable,
  busy,
  recordName,
  onUpload,
  onRemove,
}: {
  files: readonly ParaclinicalResultDicom[];
  /** Kết quả đã có ít nhất một ảnh JPG/PNG (để in lên phiếu). */
  hasImages: boolean;
  editable: boolean;
  busy: boolean;
  /** Tên bệnh nhân trong hồ sơ — trình xem đối chiếu với tên ghi trong tệp. */
  recordName: string;
  onUpload: (files: File[]) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const [viewing, setViewing] = useState<ParaclinicalResultDicom | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = files.length >= PARACLINICAL_DICOM_MAX_COUNT;

  function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const chosen = Array.from(list);
    if (files.length + chosen.length > PARACLINICAL_DICOM_MAX_COUNT) {
      setLocalError(`Mỗi kết quả tối đa ${PARACLINICAL_DICOM_MAX_COUNT} tệp DICOM.`);
      return;
    }
    const tooBig = chosen.find((f) => f.size > PARACLINICAL_DICOM_MAX_BYTES);
    if (tooBig) {
      setLocalError(`Tệp "${tooBig.name}" vượt quá ${PARACLINICAL_DICOM_MAX_BYTES / (1024 * 1024)} MB, vui lòng chọn tệp nhỏ hơn.`);
      return;
    }
    setLocalError(null);
    void onUpload(chosen);
  }

  if (files.length === 0 && !editable) return null;
  return (
    <aside aria-label="Tệp DICOM gốc" className="w-full flex-shrink-0 lg:w-[300px]">
      <div className="mb-1.5 text-sm font-semibold text-slate-800">Tệp DICOM gốc</div>
      <ul className="flex flex-col gap-1.5">
        {files.map((f) => (
          <li key={f.id} className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#0d1220] text-[10px] font-semibold tracking-wide text-slate-400" aria-hidden="true">
              DCM
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold text-slate-900" title={f.fileName}>
                {f.fileName}
              </span>
              <span className="block text-xs text-slate-500">{formatBytes(f.sizeBytes)}</span>
            </span>
            <span className="flex items-center gap-1">
              <Button type="button" variant="secondary" onClick={() => setViewing(f)}>
                Xem
              </Button>
              {editable ? (
                <button type="button" aria-label={`Gỡ tệp ${f.fileName}`} disabled={busy} onClick={() => onRemove(f.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60">
                  <Trash size={15} aria-hidden="true" />
                </button>
              ) : (
                <Button type="button" variant="secondary" onClick={() => downloadPatientDocument(f)}>
                  Tải về
                </Button>
              )}
            </span>
          </li>
        ))}
        {editable && !full && (
          <li>
            <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-slate-300 px-2 py-2.5 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:bg-blue-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              <input
                ref={input}
                type="file"
                accept=".dcm,application/dicom"
                multiple
                className="hidden"
                aria-label="Thêm tệp DICOM"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = '';
                }}
              />
              <Plus size={14} weight="bold" aria-hidden="true" />
              {busy ? 'Đang tải…' : 'Thêm tệp DICOM'}
            </label>
          </li>
        )}
      </ul>
      {localError && (
        <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
          {localError}
        </p>
      )}
      {editable && files.length > 0 && !hasImages && (
        <div role="note" className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-900">
          <Warning size={15} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            <b className="font-semibold">Phiếu in sẽ không có ảnh.</b> Thêm ảnh JPG hoặc PNG nếu cần in.
          </span>
        </div>
      )}
      {viewing && <DicomViewerDialog title={viewing.fileName} fileName={viewing.fileName} url={viewing.url} sizeBytes={viewing.sizeBytes} typeLabel="Kết quả cận lâm sàng" recordName={recordName} onClose={() => setViewing(null)} />}
    </aside>
  );
}
