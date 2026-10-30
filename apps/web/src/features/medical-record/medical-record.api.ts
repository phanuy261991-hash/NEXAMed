import type { MedicalRecordParaclinicalResponse } from '@nexamed/shared';
import { apiErrorFromResponse, getAccessToken, getApiClient, resolveApiUrl, unwrap } from '../../shared/api/client';

/** Kết quả cận lâm sàng ĐÃ DUYỆT của một lượt khám cho mục V của hồ sơ bệnh án (docs/DECISIONS.md #269). */
export async function getMedicalRecordParaclinical(encounterId: string): Promise<MedicalRecordParaclinicalResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/encounters/{id}/medical-record/paraclinical', { params: { path: { id: encounterId } } }),
  ) as MedicalRecordParaclinicalResponse;
}

/**
 * "In bộ hồ sơ" / "Xuất PDF" một lượt khám (#269): một PDF gồm tờ khám theo mẫu, phiếu kết quả cận lâm sàng và đơn thuốc. `reason` gửi ở BODY (không phải query string — PHI/PII không vào URL).
 * - `download`: tải tệp về máy.
 * - `print`: mở PDF ở tab mới để người dùng in. Tab được mở ĐỒNG BỘ trong thao tác bấm nút (truyền vào `printWindow`) rồi mới chờ máy chủ — mở sau khi chờ thì trình duyệt coi là cửa sổ
 *   bật lên tự động và chặn. Lỗi thì tab trống được đóng lại.
 */
export async function exportEncounterMedicalRecord(
  encounterId: string,
  reason: string,
  target: { mode: 'download' } | { mode: 'print'; printWindow: Window | null },
): Promise<void> {
  const token = getAccessToken();
  let blob: Blob;
  let filename: string;
  try {
    const response = await fetch(resolveApiUrl(`/api/v1/encounters/${encounterId}/medical-record/export`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) throw await apiErrorFromResponse(response, 'Không xuất được hồ sơ bệnh án.');
    filename = /filename="?([^"]+)"?/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `ho-so-benh-an-${encounterId}.pdf`;
    blob = await response.blob();
  } catch (err) {
    if (target.mode === 'print') target.printWindow?.close();
    throw err;
  }

  const url = URL.createObjectURL(blob);
  if (target.mode === 'print' && target.printWindow && !target.printWindow.closed) {
    target.printWindow.location.href = url;
    // Giữ địa chỉ tạm đủ lâu cho tab mới tải xong; thu hồi sớm sẽ làm trống tab.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    return;
  }
  // Tab in bị chặn/đã đóng, hoặc chế độ tải về: tải tệp xuống (không làm mất công người dùng).
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
