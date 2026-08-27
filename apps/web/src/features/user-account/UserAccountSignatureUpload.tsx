import { useRef, useState, type ChangeEvent } from 'react';
import { PenNib } from '@phosphor-icons/react';
import { ApiError, resolveApiUrl } from '../../shared/api/client';
import { useUploadUserAccountSignatureMutation } from './user-account.queries';

/**
 * Chữ ký số / Ảnh chữ ký (redesign 3-tab, #082) — đúng khuôn `PatientAvatarUpload.tsx`, CHỈ nhận
 * PNG (khác patient nhận cả JPG — chữ ký cần nền trong suốt). Chưa có `userId` (chế độ Thêm mới,
 * tài khoản chưa tồn tại) → khung vô hiệu + ghi chú, cùng lý do key lưu file cần `id`.
 */
export function UserAccountSignatureUpload({
  userId,
  signatureUrl,
  version,
}: {
  userId: string | undefined;
  signatureUrl: string | null;
  version: number | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useUploadUserAccountSignatureMutation();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // cho phép chọn lại đúng file cũ lần sau
    if (!file || userId === undefined || version === undefined) return;

    setError(null);
    try {
      await uploadMutation.mutateAsync({ id: userId, file, version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải chữ ký lên được, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex h-14 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white">
        {signatureUrl ? (
          <img src={resolveApiUrl(signatureUrl)} alt="Ảnh chữ ký" className="h-full w-full object-contain" />
        ) : (
          <PenNib size={22} weight="regular" className="text-slate-300" aria-hidden="true" />
        )}
      </div>

      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-900">{signatureUrl ? 'Đã tải lên chữ ký' : 'Tải lên chữ ký'}</p>
        <p className="text-xs text-slate-500">File PNG, nền trong suốt — mỗi tài khoản chỉ có 1 chữ ký hiệu lực.</p>
        {userId === undefined ? (
          <p className="mt-1 text-xs text-slate-500">Lưu tài khoản trước, sau đó có thể tải chữ ký lên.</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <PenNib size={14} weight="regular" aria-hidden="true" />
              {uploadMutation.isPending ? 'Đang tải lên…' : signatureUrl ? 'Đổi chữ ký khác' : 'Chọn file PNG'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/png" className="hidden" onChange={(e) => void handleFileChange(e)} />
          </>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}