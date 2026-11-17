import type { PatientDocument, PatientDocumentAccess } from '@nexamed/shared';
import { patientDocumentGroupOf } from './patient-document-constants';
import { makeThumbnailFromImage } from './make-thumbnail';
import { uploadDocumentThumbnail } from './patient-document.api';
import { needsThumbnailBackfill, queueThumbnailBackfill } from './thumbnail-backfill';

/**
 * Ảnh thu nhỏ BÙ (docs/DECISIONS.md #299 bổ sung 5): gọi khi một ô ảnh vừa tải xong ảnh GỐC của tệp chưa có ảnh thu nhỏ. Chỉ người có quyền tải lên của loại tệp đó mới gửi được;
 * chạy ngầm lần lượt, lỗi thì bỏ qua. Dùng chung cho tab hồ sơ bệnh nhân và tab "Hình ảnh" ở màn khám.
 */
export function requestThumbnailBackfill(patientId: string, access: PatientDocumentAccess, doc: PatientDocument, img: HTMLImageElement): void {
  if (!access[patientDocumentGroupOf(doc.category)].upload) return;
  if (!needsThumbnailBackfill(doc, img.naturalWidth, img.naturalHeight)) return;
  queueThumbnailBackfill(`${patientId}:${doc.id}`, async () => {
    const blob = await makeThumbnailFromImage(img);
    if (blob) await uploadDocumentThumbnail(patientId, doc.id, blob);
  });
}
