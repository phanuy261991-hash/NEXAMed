import { useState, type ReactNode } from 'react';
import { Warning } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { formatBytes } from '../patient-document/patient-document-view';
import { dicomNameMatches, viewStride, type DicomImage } from './dicom-decode';
import { DicomStage } from './DicomStage';
import type { DicomFileState } from './use-dicom-file';

function StateBox({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-2 rounded-md bg-black/40 px-4 py-8 text-center text-slate-300">
      <div className="text-[15px] font-semibold text-white">{title}</div>
      {children && <div className="max-w-[36ch] text-[13px]">{children}</div>}
      {action}
    </div>
  );
}

/**
 * Nội dung vùng xem DICOM theo từng trạng thái (mockup B4/B5): đang đọc (có tiến độ), mất kết nối (Thử lại), kiểu nén chưa đọc được hoặc tệp hỏng (luôn có lối ra "Tải về"),
 * tên bệnh nhân trong tệp khác hồ sơ (cảnh báo vàng, cho "Vẫn xem"), ảnh rất lớn (thông báo thu nhỏ khi xem), cuối cùng là `DicomStage`.
 */
export function DicomPanel({
  state,
  retry,
  recordName,
  onDownload,
  mismatchAcknowledged,
  onAcknowledgeMismatch,
}: {
  state: DicomFileState;
  retry: () => void;
  /** Tên bệnh nhân trong hồ sơ để đối chiếu với tên ghi trong tệp. */
  recordName: string;
  onDownload: () => void;
  /** Người dùng đã bấm "Vẫn xem" cho tệp này. Do hộp bao ngoài giữ để cột thông tin bên phải cũng biết. */
  mismatchAcknowledged: boolean;
  onAcknowledgeMismatch: () => void;
}) {
  const download = (
    <Button type="button" variant="secondary" onClick={onDownload}>
      Tải về
    </Button>
  );
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    const percent = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : null;
    return (
      <StateBox title="Đang đọc tệp…">
        {state.total ? `${formatBytes(state.total)}, đã tải ${percent}%` : formatBytes(state.loaded)}
        {percent !== null && (
          <div className="mx-auto mt-2 h-1 w-48 overflow-hidden rounded bg-slate-700" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-600" style={{ width: `${percent}%` }} />
          </div>
        )}
      </StateBox>
    );
  }
  if (state.status === 'network') {
    return (
      <StateBox
        title="Mất kết nối khi tải tệp"
        action={
          <Button type="button" variant="secondary" onClick={retry}>
            Thử lại
          </Button>
        }
      >
        Bấm "Thử lại" khi có mạng.
      </StateBox>
    );
  }
  if (state.status === 'unsupported') {
    return (
      <StateBox title="Chưa xem được tệp này" action={download}>
        Tệp dùng kiểu nén ({state.label}) mà hệ thống chưa đọc được. Hãy tải về để xem bằng phần mềm chuyên dụng.
      </StateBox>
    );
  }
  if (state.status === 'corrupt') {
    return (
      <StateBox title="Tệp bị lỗi" action={download}>
        Không đọc được nội dung tệp. Thử tải về hoặc đính lại tệp khác.
      </StateBox>
    );
  }
  return <ReadyPanel image={state.image} recordName={recordName} onDownload={onDownload} acknowledged={mismatchAcknowledged} onAcknowledge={onAcknowledgeMismatch} />;
}

function ReadyPanel({ image, recordName, onDownload, acknowledged, onAcknowledge }: { image: DicomImage; recordName: string; onDownload: () => void; acknowledged: boolean; onAcknowledge: () => void }) {
  const mismatch = !dicomNameMatches(image.info.patientName, recordName);
  if (mismatch && !acknowledged) {
    return (
      <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <div role="alert" className="flex max-w-md items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-900">
          <Warning size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            <b className="font-semibold">Kiểm tra trước khi dùng.</b> Tên trong tệp là "{image.info.patientName}", hồ sơ là "{recordName}".
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onAcknowledge}>
            Vẫn xem
          </Button>
          <Button type="button" variant="secondary" onClick={onDownload}>
            Tải về
          </Button>
        </div>
      </div>
    );
  }
  const reduced = viewStride(image.info.rows, image.info.cols) > 1;
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {reduced && (
        <div role="note" className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-[13px] text-blue-900">
          Ảnh {image.info.cols} × {image.info.rows} sẽ được thu nhỏ khi xem để máy không bị đứng. Bản tải về vẫn là bản gốc.
        </div>
      )}
      <div className="min-h-0 flex-1">
        <DicomStage image={image} />
      </div>
    </div>
  );
}

/** Giữ trạng thái "Vẫn xem" theo từng tệp: đổi tệp (url khác) thì hỏi lại. */
export function useMismatchAck(key: string): [boolean, () => void] {
  const [acked, setAcked] = useState<string | null>(null);
  return [acked === key, () => setAcked(key)];
}
