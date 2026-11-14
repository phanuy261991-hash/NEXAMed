import { useState, type FormEvent } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import {
  type PatientDocument,
  type PatientDocumentAccess,
  type PatientDocumentCategory,
  type PatientDocumentFolder,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORIES, PATIENT_DOCUMENT_CATEGORY_LABEL, PATIENT_DOCUMENT_DISPLAY_NAME_MAX, PATIENT_DOCUMENT_NOTE_MAX } from './patient-document-constants';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SaveErrorBanner } from '../../shared/ui/SaveErrorBanner';
import { uploadableCategories } from './patient-document-view';
import { useDocumentEncounterOptionsQuery, useUpdatePatientDocumentMutation } from './patient-document.queries';
import { DocumentField, DocumentModal, INPUT_CLASS } from './DocumentModal';

/** Hộp "Sửa thông tin tệp" (mockup màn 6): chỉ đổi tên hiển thị, loại, thư mục, lượt khám và ghi chú — không đổi nội dung tệp. */
export function DocumentEditDialog({
  patientId,
  doc,
  access,
  folders,
  onSaved,
  onReload,
  onClose,
}: {
  patientId: string;
  doc: PatientDocument;
  access: PatientDocumentAccess;
  folders: PatientDocumentFolder[];
  onSaved: () => void;
  /** Xung đột phiên bản: nạp lại dữ liệu mới của danh sách rồi đóng hộp. */
  onReload: () => void;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(doc.displayName);
  const [category, setCategory] = useState<PatientDocumentCategory>(doc.category);
  const [folderId, setFolderId] = useState(doc.folderId ?? '');
  const [encounterId, setEncounterId] = useState(doc.encounterId ?? '');
  const [note, setNote] = useState(doc.note ?? '');
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const update = useUpdatePatientDocumentMutation(patientId);
  const encounters = useDocumentEncounterOptionsQuery(patientId, true);

  const categories = uploadableCategories(access, PATIENT_DOCUMENT_CATEGORIES);
  const categoryOptions = categories.map((c) => ({ value: c, label: PATIENT_DOCUMENT_CATEGORY_LABEL[c] }));
  const folderOptions = [{ value: '', label: 'Không chọn' }, ...folders.map((f) => ({ value: f.id, label: f.name }))];
  const encounterOptions = [
    { value: '', label: 'Không gắn' },
    ...(encounters.data?.items ?? []),
    // Lượt khám đang gắn có thể nằm ngoài 50 lượt gần nhất: vẫn hiện để không vô tình bị bỏ gắn.
    ...(doc.encounterId && !(encounters.data?.items ?? []).some((e) => e.id === doc.encounterId) ? [{ id: doc.encounterId, label: doc.encounterLabel ?? 'Lượt khám đã gắn' }] : []),
  ].map((e) => ('value' in e ? e : { value: e.id, label: e.label }));

  const invalid = displayName.trim() === '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || update.isPending) return;
    setError(null);
    try {
      await update.mutateAsync({
        documentId: doc.id,
        body: {
          displayName: displayName.trim(),
          category,
          folderId: folderId || null,
          encounterId: encounterId || null,
          note: note.trim() === '' ? null : note.trim(),
          version: doc.version,
        },
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, conflict: err.code === 'CONCURRENT_MODIFICATION' });
      else setError({ message: 'Chưa lưu được, hãy thử lại. Thông tin bạn nhập vẫn còn nguyên.', conflict: false });
    }
  }

  return (
    <DocumentModal width={560} label="Sửa thông tin tệp" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalHeader icon={PencilSimple} title="Sửa thông tin tệp" subtitle={doc.fileName} onClose={onClose} />
        {error && (
          <div className="mb-3">
            <SaveErrorBanner message={error.message} onReload={error.conflict ? onReload : undefined} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <DocumentField id="doc-edit-name" label="Tên hiển thị" required full>
            <input id="doc-edit-name" autoFocus maxLength={PATIENT_DOCUMENT_DISPLAY_NAME_MAX} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={INPUT_CLASS} />
          </DocumentField>
          <DocumentField id="doc-edit-category" label="Loại">
            <Combobox id="doc-edit-category" value={category} onChange={(v) => setCategory(v as PatientDocumentCategory)} options={categoryOptions} />
          </DocumentField>
          <DocumentField id="doc-edit-folder" label="Thư mục tự tạo">
            <Combobox id="doc-edit-folder" value={folderId} onChange={setFolderId} options={folderOptions} placeholder="Không chọn" />
          </DocumentField>
          <DocumentField id="doc-edit-encounter" label="Gắn với lượt khám" full>
            <Combobox id="doc-edit-encounter" value={encounterId} onChange={setEncounterId} options={encounterOptions} placeholder="Không gắn" />
          </DocumentField>
          <DocumentField id="doc-edit-note" label="Ghi chú" full>
            <textarea id="doc-edit-note" rows={3} maxLength={PATIENT_DOCUMENT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
          </DocumentField>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={update.isPending} disabled={invalid}>
            Lưu
          </Button>
        </div>
      </form>
    </DocumentModal>
  );
}
