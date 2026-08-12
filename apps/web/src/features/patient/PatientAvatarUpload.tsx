import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, User } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useUploadPatientPhotoMutation } from './patient.queries';

/**
 * Ảnh đại diện bệnh nhân (docs/DECISIONS.md #034) — chỉ đặt trong `features/patient/` (chưa có
 * bằng chứng cần dùng lại chỗ khác, đúng CLAUDE.md "trùng lần 2 mới tách ra shared/ui"). Chưa có
 * `patientId` (trang Thêm mới, patient chưa tồn tại) → khung vô hiệu + ghi chú thay vì nút upload,
 * vì key lưu file cần `patientId` để đặt tên (`patient/<id>/photo/<uuid>.<ext>`).
 */
export function PatientAvatarUpload({
  patientId,
  photoUrl,
  version,
}: {
  patientId: string | undefined;
  photoUrl: string | null;
  version: number | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useUploadPatientPhotoMutation(patientId ?? '');

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // cho phép chọn lại đúng file cũ lần sau (input không tự bắn onChange nếu value không đổi)
    if (!file || patientId === undefined || version === undefined) return;

    setError(null);
    try {
      await uploadMutation.mutateAsync({ file, version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải ảnh lên được, vui lòng thử lại.');
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">Ảnh đại diện</span>
      <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
        {photoUrl ? (
          <img src={photoUrl} alt="Ảnh đại diện bệnh nhân" className="h-full w-full object-cover" />
        ) : (
          <User size={40} weight="regular" className="text-slate-300" aria-hidden="true" />
        )}
      </div>

      {patientId === undefined ? (
        <p className="mt-2 max-w-[7rem] text-xs text-slate-500">Lưu hồ sơ trước, sau đó có thể thêm ảnh.</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera size={14} weight="regular" aria-hidden="true" />
            {uploadMutation.isPending ? 'Đang tải lên…' : 'Chọn ảnh'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
        </>
      )}

      {error && (
        <p role="alert" className="mt-1 max-w-[7rem] text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
