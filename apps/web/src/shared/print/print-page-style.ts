import { useEffect } from 'react';

/**
 * Quy tắc `@page` (khổ giấy + lề) cho chứng từ đang in. CSS chỉ áp được MỘT `@page` tại một thời điểm, trong khi nhiều
 * `PrintDocument` có thể cùng được dựng (ẩn) trên một trang — nên mỗi tài liệu đăng ký quy tắc của mình vào danh sách
 * này và thẻ `<style>` duy nhất luôn mang quy tắc của tài liệu ĐĂNG KÝ SAU CÙNG (khớp quy ước đang dùng: tại một thời
 * điểm chỉ một chứng từ được dựng để in). Gỡ đăng ký khi tài liệu bị huỷ.
 */
const STYLE_ELEMENT_ID = 'nexamed-print-page-style';
const registrations: { id: number; css: string }[] = [];
let nextId = 1;

function syncStyleElement(): void {
  let element = document.getElementById(STYLE_ELEMENT_ID);
  const latest = registrations[registrations.length - 1];
  if (!latest) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  element.textContent = latest.css;
}

/** `css` ví dụ: `@page { size: 148mm 210mm; margin: 10mm; }` — dựng bằng `buildPageRule()`. */
export function usePrintPageStyle(css: string): void {
  useEffect(() => {
    const id = nextId++;
    registrations.push({ id, css });
    syncStyleElement();
    return () => {
      const index = registrations.findIndex((r) => r.id === id);
      if (index >= 0) registrations.splice(index, 1);
      syncStyleElement();
    };
  }, [css]);
}

/** Giấy cuộn (`heightMm = null`) dùng chiều dài tối đa 297mm — trình điều khiển máy in nhiệt tự cắt theo nội dung thực tế. */
export function buildPageRule(widthMm: number, heightMm: number | null, margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number }): string {
  const height = heightMm ?? 297;
  return `@page { size: ${widthMm}mm ${height}mm; margin: ${margins.topMm}mm ${margins.rightMm}mm ${margins.bottomMm}mm ${margins.leftMm}mm; }`;
}
