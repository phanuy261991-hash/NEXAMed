/** Sao chép văn bản: ưu tiên Clipboard API, dự phòng chọn-và-copy khi trình duyệt/khung nhúng từ chối. Trả `false` nếu cả hai cách đều không được. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(area);
    }
  }
}
