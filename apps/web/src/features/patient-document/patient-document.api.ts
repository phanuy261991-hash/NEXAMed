import type {
  CreatePatientDocumentFolderRequest,
  ListPatientDocumentEncounterOptionsResponse,
  ListPatientDocumentsQuery,
  ListPatientDocumentsResponse,
  PatientDocument,
  PatientDocumentCategory,
  PatientDocumentFolder,
  RenamePatientDocumentFolderRequest,
  UpdatePatientDocumentRequest,
} from '@nexamed/shared';
import { apiErrorFromResponse, getAccessToken, getApiClient, resolveApiUrl, unwrap } from '../../shared/api/client';

/** Hình ảnh & Tài liệu của bệnh nhân (docs/DECISIONS.md #299) — tệp đi theo bệnh nhân nên chung cả công ty. */
export type ListPatientDocumentsParams = Partial<Omit<ListPatientDocumentsQuery, 'limit'>> & { limit?: number };

export async function listPatientDocuments(patientId: string, query: ListPatientDocumentsParams): Promise<ListPatientDocumentsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/{patientId}/documents', { params: { path: { patientId }, query: query as never } }),
  ) as ListPatientDocumentsResponse;
}

export async function listDocumentEncounterOptions(patientId: string): Promise<ListPatientDocumentEncounterOptionsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/{patientId}/documents/encounter-options', { params: { path: { patientId } } }),
  ) as ListPatientDocumentEncounterOptionsResponse;
}

export interface UploadDocumentFields {
  category: PatientDocumentCategory;
  folderId?: string;
  encounterId?: string;
  note?: string;
}

/**
 * Tải MỘT tệp lên kèm tiến độ (XMLHttpRequest, vì `fetch` không báo tiến độ gửi). Lỗi mạng ném `TypeError` như `fetch` để giao diện nhận ra là lỗi mạng
 * (hộp "Chưa kết nối được máy chủ"); lỗi máy chủ đi qua `apiErrorFromResponse` nên luôn là câu tiếng Việt, không lộ mã.
 */
export function uploadPatientDocument(patientId: string, file: File, fields: UploadDocumentFields, onProgress?: (percent: number) => void, idempotencyKey?: string): Promise<PatientDocument> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('category', fields.category);
    if (fields.folderId) form.append('folderId', fields.folderId);
    if (fields.encounterId) form.append('encounterId', fields.encounterId);
    if (fields.note) form.append('note', fields.note);
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', resolveApiUrl(`/api/v1/patients/${patientId}/documents`));
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Chống ghi trùng cho tải tệp (#257 mở rộng, #299): gửi lại cùng khoá + cùng nội dung sau khi mạng đứt thì máy chủ trả đúng kết quả cũ, không ghi tệp thứ hai.
    if (idempotencyKey) xhr.setRequestHeader('Idempotency-Key', idempotencyKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new TypeError('Failed to fetch'));
    xhr.ontimeout = () => reject(new TypeError('Failed to fetch'));
    xhr.onload = () => {
      const response = new Response(xhr.responseText, { status: xhr.status, headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' } });
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { data: PatientDocument };
          onProgress?.(100);
          resolve(body.data);
        } catch {
          reject(new TypeError('Failed to fetch'));
        }
        return;
      }
      void apiErrorFromResponse(response, 'Không tải lên được.').then(reject);
    };
    xhr.send(form);
  });
}

export async function updatePatientDocument(patientId: string, documentId: string, body: UpdatePatientDocumentRequest): Promise<void> {
  unwrap(await getApiClient().PATCH('/api/v1/patients/{patientId}/documents/{documentId}', { params: { path: { patientId, documentId } }, body }));
}

export async function removePatientDocument(patientId: string, documentId: string, version: number, reason: string): Promise<void> {
  unwrap(
    await getApiClient().DELETE('/api/v1/patients/{patientId}/documents/{documentId}', {
      params: { path: { patientId, documentId }, query: { version, reason } },
    }),
  );
}

export async function createDocumentFolder(patientId: string, body: CreatePatientDocumentFolderRequest): Promise<PatientDocumentFolder> {
  return unwrap(
    await getApiClient().POST('/api/v1/patients/{patientId}/documents/folders', { params: { path: { patientId } }, body }),
  ) as PatientDocumentFolder;
}

export async function renameDocumentFolder(patientId: string, folderId: string, body: RenamePatientDocumentFolderRequest): Promise<void> {
  unwrap(await getApiClient().PATCH('/api/v1/patients/{patientId}/documents/folders/{folderId}', { params: { path: { patientId, folderId } }, body }));
}

export async function removeDocumentFolder(patientId: string, folderId: string, version: number): Promise<void> {
  unwrap(
    await getApiClient().DELETE('/api/v1/patients/{patientId}/documents/folders/{folderId}', {
      params: { path: { patientId, folderId }, query: { version } },
    }),
  );
}

/** Tải một tệp về máy với đúng tên gốc (đường dẫn ký cùng nguồn gốc nên thuộc tính `download` có hiệu lực). */
export function downloadPatientDocument(doc: Pick<PatientDocument, 'url' | 'fileName'>): void {
  const a = document.createElement('a');
  a.href = resolveApiUrl(doc.url);
  a.download = doc.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
