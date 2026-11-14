import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Camera, Check, FolderSimple, UploadSimple, Warning, X } from '@phosphor-icons/react';
import {
  type PatientDocumentAccess,
  type PatientDocumentCategory,
  type PatientDocumentFolder,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORIES, PATIENT_DOCUMENT_CATEGORY_LABEL, PATIENT_DOCUMENT_MAX_BYTES, PATIENT_DOCUMENT_NOTE_MAX } from './patient-document-constants';
import { ApiError } from '../../shared/api/client';
import { generateUuid } from '../../shared/uuid';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { formatBytes, formatIsoDateVi, suggestCategory, uploadableCategories, validateFileForUpload } from './patient-document-view';
import { useDocumentEncounterOptionsQuery, useUploadPatientDocumentMutation } from './patient-document.queries';
import { DocumentArt } from './DocumentThumb';
import { DocumentField, DocumentModal, INPUT_CLASS } from './DocumentModal';
import { isShrinkableImage, shrinkImageToLimit } from './shrink-image';

interface UploadRow {
  key: string;
  file: File;
  category: PatientDocumentCategory | null;
  status: 'ready' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
  /** Lỗi từ phía trình duyệt (sai định dạng, quá lớn): không gửi lên được, chỉ có thể bỏ khỏi danh sách. */
  invalid: boolean;
  previewUrl: string | null;
  /** Ảnh quá lớn đang được thu nhỏ ở trình duyệt (chưa gửi được). */
  shrinking: boolean;
  /** Dung lượng gốc nếu ảnh đã được thu nhỏ. */
  shrunkFrom: number | null;
  /** Khoá chống ghi trùng của lần tải này; dùng lại khi gửi lại sau mất mạng, đổi khi nội dung đổi hoặc khi máy chủ đã từ chối. */
  idemKey: string;
  idemSig: string;
}

const ACCEPT = '.jpg,.jpeg,.png,.pdf,.dcm,image/jpeg,image/png,application/pdf';

/**
 * Hộp "Tải lên hình ảnh và tài liệu" (mockup màn 4, docs/DECISIONS.md #299). Chọn nhiều tệp (kéo thả, nút Chọn tệp, nút Chụp ảnh trên máy tính bảng), mỗi tệp một loại riêng,
 * tải lần lượt kèm tiến độ và lỗi riêng từng tệp. Tất cả xong thì tự đóng; còn tệp lỗi thì giữ hộp mở để tải lại. Thư mục tự tạo, lượt khám, ghi chú áp cho cả lô.
 */
export function DocumentUploadDialog({
  patientId,
  patientName,
  access,
  folders,
  defaultFolderId,
  today,
  onClose,
}: {
  patientId: string;
  patientName: string;
  access: PatientDocumentAccess;
  folders: PatientDocumentFolder[];
  defaultFolderId?: string;
  /** Ngày hôm nay (YYYY-MM-DD, giờ Việt Nam) cho dòng "Tệp sẽ vào thư mục ngày...". */
  today: string;
  onClose: () => void;
}) {
  const uploadable = useMemo(() => uploadableCategories(access, PATIENT_DOCUMENT_CATEGORIES), [access]);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [folderId, setFolderId] = useState(defaultFolderId ?? '');
  const [encounterId, setEncounterId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const upload = useUploadPatientDocumentMutation(patientId);
  const encounters = useDocumentEncounterOptionsQuery(patientId, true);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const categoryOptions = uploadable.map((c) => ({ value: c, label: PATIENT_DOCUMENT_CATEGORY_LABEL[c] }));
  const folderOptions = [{ value: '', label: 'Không chọn' }, ...folders.map((f) => ({ value: f.id, label: f.name }))];
  const encounterOptions = [{ value: '', label: 'Không gắn' }, ...(encounters.data?.items ?? []).map((e) => ({ value: e.id, label: e.label }))];

  function addFiles(list: FileList | File[]) {
    const added: UploadRow[] = Array.from(list).map((file) => {
      // Ảnh JPG/PNG quá lớn không báo lỗi mà được thu nhỏ tự động; tệp khác vượt giới hạn vẫn báo lỗi ngay tại dòng.
      const shrinking = isShrinkableImage(file, PATIENT_DOCUMENT_MAX_BYTES);
      const error = shrinking ? null : validateFileForUpload(file, PATIENT_DOCUMENT_MAX_BYTES);
      let previewUrl: string | null = null;
      if (!error && !shrinking && /\.(jpe?g|png)$/i.test(file.name)) {
        previewUrl = URL.createObjectURL(file);
        previewUrls.current.push(previewUrl);
      }
      return {
        key: generateUuid(),
        file,
        category: suggestCategory(file.name, uploadable),
        status: error ? 'error' : 'ready',
        progress: 0,
        error,
        invalid: error !== null,
        previewUrl,
        shrinking,
        shrunkFrom: null,
        idemKey: generateUuid(),
        idemSig: '',
      };
    });
    setRows((prev) => [...prev, ...added]);
    for (const row of added) if (row.shrinking) void shrinkRow(row);
  }

  async function shrinkRow(row: UploadRow) {
    try {
      const small = await shrinkImageToLimit(row.file, PATIENT_DOCUMENT_MAX_BYTES);
      const previewUrl = URL.createObjectURL(small);
      previewUrls.current.push(previewUrl);
      patchRow(row.key, { file: small, shrinking: false, shrunkFrom: row.file.size, previewUrl });
    } catch {
      patchRow(row.key, { shrinking: false, status: 'error', invalid: true, error: 'Không thu nhỏ được ảnh này, hãy chọn ảnh nhỏ hơn' });
    }
  }

  const patchRow = (key: string, patch: Partial<UploadRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pending = rows.filter((r) => !r.invalid && !r.shrinking && (r.status === 'ready' || r.status === 'error'));
  const anyShrinking = rows.some((r) => r.shrinking);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || anyShrinking || pending.length === 0) return;
    setBusy(true);
    let failed = false;
    for (const row of pending) {
      if (!row.category) {
        patchRow(row.key, { status: 'error', error: 'Chọn loại tệp' });
        failed = true;
        continue;
      }
      // Khoá chống ghi trùng: giữ khoá cũ nếu nội dung không đổi (gửi lại sau mất mạng → máy chủ trả kết quả cũ), đổi khoá khi người dùng sửa loại/thư mục/lượt khám/ghi chú.
      const sig = JSON.stringify([row.category, folderId, encounterId, note.trim(), row.file.size, row.file.name]);
      const idemKey = row.idemSig === sig ? row.idemKey : generateUuid();
      patchRow(row.key, { status: 'uploading', progress: 0, error: null, idemKey, idemSig: sig });
      try {
        await upload.mutateAsync({
          file: row.file,
          fields: { category: row.category, folderId: folderId || undefined, encounterId: encounterId || undefined, note: note.trim() || undefined },
          onProgress: (progress) => patchRow(row.key, { progress }),
          idempotencyKey: idemKey,
        });
        patchRow(row.key, { status: 'done', progress: 100 });
      } catch (err) {
        failed = true;
        // Lỗi nghiệp vụ (4xx) hiện ngay tại dòng; mất mạng/5xx đã có hộp lỗi hệ thống toàn cục, dòng chỉ ghi ngắn.
        // Máy chủ đã từ chối rõ ràng (4xx) thì khoá được nhả: lần sau dùng khoá mới. Mất mạng/5xx thì giữ khoá để gửi lại là an toàn.
        patchRow(row.key, { status: 'error', error: err instanceof ApiError ? err.message : 'Chưa tải lên được, hãy thử lại', ...(err instanceof ApiError && err.status !== undefined && err.status < 500 ? { idemSig: '' } : {}) });
      }
    }
    setBusy(false);
    if (!failed) onClose();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  return (
    <DocumentModal width={720} label="Tải lên hình ảnh và tài liệu" onClose={() => !busy && onClose()}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalHeader icon={UploadSimple} title="Tải lên hình ảnh và tài liệu" subtitle={patientName} onClose={busy ? undefined : onClose} />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed px-4 py-5 text-center ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-400 bg-slate-50'}`}
        >
          <UploadSimple size={34} className="text-slate-500" aria-hidden="true" />
          <div className="text-[15px] font-semibold text-slate-900">Kéo thả tệp vào đây</div>
          <div className="text-xs font-medium text-slate-500">JPG, PNG, PDF, DICOM · tối đa {PATIENT_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB mỗi tệp</div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              <FolderSimple size={16} aria-hidden="true" /> Chọn tệp
            </Button>
            <Button type="button" variant="secondary" onClick={() => cameraInput.current?.click()}>
              <Camera size={16} aria-hidden="true" /> Chụp ảnh
            </Button>
          </div>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Chọn tệp" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Chụp ảnh" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {rows.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.key} className="grid grid-cols-[42px_minmax(0,1fr)_190px_24px] items-center gap-2.5 py-2 max-sm:grid-cols-[42px_minmax(0,1fr)_24px]">
                <div className="h-8 w-[42px] overflow-hidden rounded border border-slate-200 bg-slate-100">
                  {row.previewUrl ? <img src={row.previewUrl} alt="" className="h-full w-full object-cover" /> : <DocumentArt kind={/\.dcm$/i.test(row.file.name) ? 'dicom' : 'pdf'} />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-slate-900">{row.file.name}</div>
                  {row.status === 'uploading' && (
                    <div className="mt-1 h-[5px] overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={row.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-blue-600" style={{ width: `${row.progress}%` }} />
                    </div>
                  )}
                  {row.error ? (
                    <div role="alert" className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                      <Warning size={13} weight="fill" aria-hidden="true" /> {row.error}
                    </div>
                  ) : (
                    <div className="text-xs font-medium text-slate-500">
                      {formatBytes(row.file.size)}
                      {row.shrunkFrom !== null && ` (đã thu nhỏ từ ${formatBytes(row.shrunkFrom)})`} ·{' '}
                      {row.shrinking ? 'đang thu nhỏ ảnh…' : row.status === 'done' ? 'đã tải xong' : row.status === 'uploading' ? `đang tải ${row.progress}%` : 'sẵn sàng'}
                    </div>
                  )}
                </div>
                <div className="max-sm:hidden">
                  <Combobox id={`doc-cat-${row.key}`} value={row.category ?? ''} onChange={(v) => patchRow(row.key, { category: v as PatientDocumentCategory })} options={categoryOptions} placeholder="Loại tệp" dense disabled={row.status === 'uploading' || row.status === 'done'} />
                </div>
                {row.status === 'done' ? (
                  <Check size={18} weight="bold" className="text-emerald-600" aria-label="Đã tải xong" />
                ) : (
                  <button
                    type="button"
                    aria-label={`Bỏ ${row.file.name}`}
                    disabled={row.status === 'uploading'}
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                  >
                    <X size={16} weight="bold" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <DocumentField id="doc-up-folder" label="Thư mục tự tạo">
            <Combobox id="doc-up-folder" value={folderId} onChange={setFolderId} options={folderOptions} placeholder="Không chọn" />
          </DocumentField>
          <DocumentField id="doc-up-encounter" label="Gắn với lượt khám">
            <Combobox id="doc-up-encounter" value={encounterId} onChange={setEncounterId} options={encounterOptions} placeholder="Không gắn" />
          </DocumentField>
          <DocumentField id="doc-up-note" label="Ghi chú" full>
            <textarea id="doc-up-note" rows={3} maxLength={PATIENT_DOCUMENT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: ảnh chụp trước khi khâu" className={INPUT_CLASS} />
          </DocumentField>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[13.5px] font-medium text-slate-600">
          <FolderSimple size={14} aria-hidden="true" /> Tệp sẽ vào thư mục ngày {formatIsoDateVi(today)}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={busy} disabled={pending.length === 0 || anyShrinking}>
            <UploadSimple size={16} aria-hidden="true" /> {pending.length > 0 ? `Tải lên ${pending.length} tệp` : 'Tải lên'}
          </Button>
        </div>
      </form>
    </DocumentModal>
  );
}
