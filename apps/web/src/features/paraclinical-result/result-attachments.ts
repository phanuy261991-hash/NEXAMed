import type { ParaclinicalResultSection } from '@nexamed/shared';

type ResultAttachment = ParaclinicalResultSection['images'][number];

/** Tệp đính kèm là PDF (kết quả đối tác gửi về, #291) — không vẽ bằng thẻ ảnh được. */
export function isPdfAttachment(item: Pick<ResultAttachment, 'contentType'>): boolean {
  return item.contentType.toLowerCase() === 'application/pdf';
}

/** Tách tệp đính kèm của một mục thành ảnh (vẽ được) và PDF (chỉ mở bằng liên kết). */
export function splitAttachments(items: readonly ResultAttachment[]): { images: ResultAttachment[]; pdfs: ResultAttachment[] } {
  return { images: items.filter((i) => !isPdfAttachment(i)), pdfs: items.filter(isPdfAttachment) };
}
