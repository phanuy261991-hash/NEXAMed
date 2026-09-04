import { useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import type { BusinessCodeTemplateItem } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ApiError } from '../../shared/api/client';
import { useBusinessCodeTemplatesQuery, useUpdateBusinessCodeTemplateMutation } from './clinic.queries';
import { BusinessCodeTemplateFormModal } from './BusinessCodeTemplateFormModal';

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
 * danh sách 7 loại mã nghiệp vụ (Bệnh nhân/Khoa-Phòng/Nhân viên/Lịch hẹn/Lượt khám/Phiếu thu/Phiếu
 * chốt ca), cho phép tự cấu hình khuôn mã + số bắt đầu đếm theo từng tenant. Pill phẳng riêng
 * (không mục con) trong "Cấu hình hệ thống", đúng khuôn `PaymentConfigPane`/`ExamConfigPane`.
 */
export function BusinessCodeTemplatePane() {
  const canManage = useHasPermission('clinic_config', 'update');

  const [editing, setEditing] = useState<BusinessCodeTemplateItem | null>(null);
  const query = useBusinessCodeTemplatesQuery();
  const updateMutation = useUpdateBusinessCodeTemplateMutation();
  const mutationErrorMessage = updateMutation.error instanceof ApiError ? updateMutation.error.message : undefined;

  const items = query.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <p className="mb-4 text-xs text-slate-500">
        Danh sách mẫu mã tự sinh cho mọi loại mã nghiệp vụ hiện có. Đổi khuôn mẫu chỉ áp dụng cho mã tạo MỚI từ lúc lưu — mã đã cấp trước đó giữ nguyên.
      </p>

      {query.isError && <ErrorBanner message="Không tải được cấu hình mẫu mã phát sinh." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-4 py-2.5 text-left">Loại mã</th>
                  <th className="px-4 py-2.5 text-left">Khuôn mẫu</th>
                  <th className="w-40 px-4 py-2.5 text-center">Mã kế tiếp</th>
                  <th className="w-28 px-4 py-2.5 text-center">Số bắt đầu</th>
                  {canManage && <th className="w-20 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.codeType} className="border-b border-slate-200 last:border-0">
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{item.label}</td>
                    <td className="px-4 py-2 text-left font-mono text-xs text-slate-600">{item.template}</td>
                    <td className="px-4 py-2 text-center font-mono font-bold text-slate-800">{item.exampleNextCode}</td>
                    <td className="px-4 py-2 text-center">
                      {item.locked ? (
                        <span title="Đã phát sinh mã đầu tiên — không sửa lại được">
                          <StatusBadge tone="neutral">Đã khoá</StatusBadge>
                        </span>
                      ) : (
                        <span className="text-slate-500">{item.startingValue}</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setEditing(item)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PencilSimple size={15} weight="regular" aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <BusinessCodeTemplateFormModal
          item={editing}
          submitting={updateMutation.isPending}
          submitError={mutationErrorMessage}
          onCancel={() => setEditing(null)}
          onSubmit={(dto) =>
            updateMutation.mutate({ codeType: editing.codeType, body: dto }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
    </div>
  );
}
