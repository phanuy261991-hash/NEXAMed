import { useState, type FormEvent } from 'react';
import { FolderSimple, Trash } from '@phosphor-icons/react';
import {
  type PatientDocumentFolder,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_FOLDER_NAME_MAX } from './patient-document-constants';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SaveErrorBanner } from '../../shared/ui/SaveErrorBanner';
import { useCreateDocumentFolderMutation, useRemoveDocumentFolderMutation, useRenameDocumentFolderMutation } from './patient-document.queries';
import { DocumentField, DocumentModal, INPUT_CLASS } from './DocumentModal';

/** Hộp "Tạo thư mục mới" / "Đổi tên thư mục" (mockup màn 7). Thư mục tự tạo không lồng nhau, tên không trùng trong cùng hồ sơ. */
export function DocumentFolderDialog({
  patientId,
  patientName,
  folder,
  onDone,
  onReload,
  onClose,
}: {
  patientId: string;
  patientName: string;
  /** Có = đổi tên thư mục này; không có = tạo mới. */
  folder?: PatientDocumentFolder;
  /** Gọi sau khi lưu xong; với tạo mới nhận thư mục vừa tạo. */
  onDone: (created?: PatientDocumentFolder) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const create = useCreateDocumentFolderMutation(patientId);
  const rename = useRenameDocumentFolderMutation(patientId);
  const pending = create.isPending || rename.isPending;
  const invalid = name.trim() === '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || pending) return;
    setError(null);
    try {
      if (folder) {
        await rename.mutateAsync({ folderId: folder.id, body: { name: name.trim(), version: folder.version } });
        onDone();
      } else {
        onDone(await create.mutateAsync({ name: name.trim() }));
      }
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, conflict: err.code === 'CONCURRENT_MODIFICATION' });
      else setError({ message: 'Chưa lưu được, hãy thử lại. Tên bạn nhập vẫn còn nguyên.', conflict: false });
    }
  }

  return (
    <DocumentModal width={460} label={folder ? 'Đổi tên thư mục' : 'Tạo thư mục mới'} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalHeader icon={FolderSimple} title={folder ? 'Đổi tên thư mục' : 'Tạo thư mục mới'} subtitle={patientName} onClose={onClose} />
        {error && (
          <div className="mb-3">
            <SaveErrorBanner message={error.message} onReload={error.conflict ? onReload : undefined} />
          </div>
        )}
        <DocumentField id="doc-folder-name" label="Tên thư mục" required hint={`Tối đa ${PATIENT_DOCUMENT_FOLDER_NAME_MAX} ký tự.`}>
          <input id="doc-folder-name" autoFocus maxLength={PATIENT_DOCUMENT_FOLDER_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
        </DocumentField>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={pending} disabled={invalid}>
            Lưu
          </Button>
        </div>
      </form>
    </DocumentModal>
  );
}

/** Hộp "Xoá thư mục" (mockup màn 8, hộp phải): thư mục còn tệp thì máy chủ từ chối và câu lỗi hiện ngay trong hộp. */
export function DocumentDeleteFolderDialog({ patientId, folder, onDone, onClose }: { patientId: string; folder: PatientDocumentFolder; onDone: () => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const remove = useRemoveDocumentFolderMutation(patientId);

  async function handleDelete() {
    setError(null);
    try {
      await remove.mutateAsync({ folderId: folder.id, version: folder.version });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chưa xoá được, hãy thử lại.');
    }
  }

  return (
    <ConfirmDialog
      icon={Trash}
      tone="danger"
      title="Xoá thư mục"
      rows={[
        { label: 'Thư mục', value: folder.name },
        { label: 'Số tệp', value: `${folder.fileCount} tệp` },
      ]}
      note="Chỉ xoá được thư mục trống."
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" variant="danger" loading={remove.isPending} onClick={() => void handleDelete()}>
            Xoá
          </Button>
        </>
      }
    />
  );
}
