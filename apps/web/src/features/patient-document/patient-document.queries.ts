import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientDocumentFolderRequest, RenamePatientDocumentFolderRequest, UpdatePatientDocumentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createDocumentFolder,
  getPatientDocumentUsage,
  listDocumentEncounterOptions,
  listPatientDocuments,
  removeDocumentFolder,
  removePatientDocument,
  renameDocumentFolder,
  updatePatientDocument,
  uploadPatientDocument,
  type ListPatientDocumentsParams,
  type UploadDocumentFields,
} from './patient-document.api';

const DOMAIN = 'patient-document';

/** Danh sách tải THEO LÔ bằng con trỏ (mới nhất trước); tổng quan, thư mục và quyền lấy từ lô đầu. */
export function usePatientDocumentsQuery(patientId: string, filters: Omit<ListPatientDocumentsParams, 'cursor'>, enabled = true) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, DOMAIN, patientId, 'list', JSON.stringify(filters)),
    queryFn: ({ pageParam }) => listPatientDocuments(patientId, { ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/** Số tệp tối đa tải một lần cho một lượt khám (trần của danh sách theo lô của máy chủ). */
export const ENCOUNTER_DOCUMENTS_LIMIT = 100;

/** Tệp của MỘT lượt khám (tab "Hình ảnh" ở màn khám); tab và chấm số trên thanh tab dùng chung một khoá nên chỉ gọi máy chủ một lần. */
export function useEncounterDocumentsQuery(patientId: string, encounterId: string, enabled = true) {
  return usePatientDocumentsQuery(patientId, { encounterId, limit: ENCOUNTER_DOCUMENTS_LIMIT }, enabled);
}

/** Dung lượng đã dùng ở Cấu hình chung (mockup màn 13). Đo tệp khá nặng nên không tự tải lại: chỉ khi vào trang và khi bấm Thử lại. */
export function usePatientDocumentUsageQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, DOMAIN, 'usage'),
    queryFn: getPatientDocumentUsage,
    staleTime: 60_000,
  });
}

export function useDocumentEncounterOptionsQuery(patientId: string, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, DOMAIN, patientId, 'encounter-options'),
    queryFn: () => listDocumentEncounterOptions(patientId),
    enabled,
  });
}

function useRefresh(patientId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, DOMAIN, patientId) });
}

export function useUploadPatientDocumentMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (input: { file: File; fields: UploadDocumentFields; onProgress?: (percent: number) => void; idempotencyKey?: string; thumbnail?: Blob | null }) =>
      uploadPatientDocument(patientId, input.file, input.fields, input.onProgress, input.idempotencyKey, input.thumbnail),
    onSuccess: () => void refresh(),
  });
}

export function useUpdatePatientDocumentMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (input: { documentId: string; body: UpdatePatientDocumentRequest }) => updatePatientDocument(patientId, input.documentId, input.body),
    onSuccess: () => void refresh(),
  });
}

export function useRemovePatientDocumentMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (input: { documentId: string; version: number; reason: string }) => removePatientDocument(patientId, input.documentId, input.version, input.reason),
    onSuccess: () => void refresh(),
  });
}

export function useCreateDocumentFolderMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (body: CreatePatientDocumentFolderRequest) => createDocumentFolder(patientId, body),
    onSuccess: () => void refresh(),
  });
}

export function useRenameDocumentFolderMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (input: { folderId: string; body: RenamePatientDocumentFolderRequest }) => renameDocumentFolder(patientId, input.folderId, input.body),
    onSuccess: () => void refresh(),
  });
}

export function useRemoveDocumentFolderMutation(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (input: { folderId: string; version: number }) => removeDocumentFolder(patientId, input.folderId, input.version),
    onSuccess: () => void refresh(),
  });
}
