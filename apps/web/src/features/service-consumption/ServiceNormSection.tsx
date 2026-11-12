import { useState } from 'react';
import type { ServiceNormQuery } from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useHasPermission } from '../auth/usePermission';
import { addDraftLine, draftFromNorm, sameDraftLines, toRequestLines, validateDraftLines, type ConsumptionDraftLine } from './consumption-model';
import { ConsumptionItemPicker } from './ConsumptionItemPicker';
import { ConsumptionDraftTable } from './ConsumptionTables';
import { usePutServiceNormMutation, useServiceNormQuery } from './service-consumption.queries';

export interface ServiceNormEditor {
  /** Có hiện khối định mức không: dịch vụ đã có (không phải thêm mới) và người dùng có quyền xem định mức. */
  visible: boolean;
  canEdit: boolean;
  loading: boolean;
  loadFailed: boolean;
  retry: () => void;
  lines: ConsumptionDraftLine[];
  setLines: (lines: ConsumptionDraftLine[]) => void;
  /** Đã sửa so với bản đang lưu. */
  dirty: boolean;
  /** Lỗi nhập (câu tiếng Việt) hoặc `null` — gọi TRƯỚC khi lưu dịch vụ. */
  validate: () => string | null;
  /** Lưu định mức (thay nguyên danh sách) nếu có sửa; ném lỗi lên để form hiện ở chỗ lưu. */
  save: () => Promise<void>;
}

/**
 * Soạn ĐỊNH MỨC vật tư tiêu hao của một dịch vụ (#297 GĐ4) ngay trong form dịch vụ — dùng chung cho Dịch vụ kỹ thuật và Dịch vụ khám.
 * Định mức lưu RIÊNG qua `PUT /service-consumption/norms` (không nằm trong body lưu dịch vụ); form gọi `save()` TRƯỚC khi lưu dịch vụ nên lưu lại
 * khi dịch vụ lỗi vẫn an toàn (thay nguyên danh sách, chạy lại không đổi kết quả). `target = null` khi thêm mới (chưa có id/mã) → khối ẩn.
 */
export function useServiceNormEditor(target: ServiceNormQuery | null): ServiceNormEditor {
  const canRead = useHasPermission('service_consumption', 'read');
  const canEdit = useHasPermission('service_consumption', 'norm');
  const visible = target !== null && canRead;
  const query = useServiceNormQuery(target, visible);
  const putMutation = usePutServiceNormMutation();
  // `edits` = null nghĩa là chưa sửa gì: hiện đúng dữ liệu máy chủ (tải xong muộn vẫn ra đúng, không phải chép vào state).
  const [edits, setEdits] = useState<ConsumptionDraftLine[] | null>(null);
  const base = query.data ? draftFromNorm(query.data.lines) : [];
  const lines = edits ?? base;
  const dirty = edits !== null && !sameDraftLines(edits, base);

  return {
    visible,
    canEdit,
    loading: visible && query.isLoading,
    loadFailed: visible && query.isError,
    retry: () => void query.refetch(),
    lines,
    setLines: setEdits,
    dirty,
    validate: () => (visible && canEdit && dirty ? validateDraftLines(lines, { allowEmpty: true }) : null),
    save: async () => {
      if (!visible || !canEdit || !dirty || target === null) return;
      await putMutation.mutateAsync({ query: target, body: { lines: toRequestLines(lines) } });
      setEdits(null);
    },
  };
}

/** Khối "Vật tư tiêu hao (định mức)" trong form dịch vụ. `readOnly` = form đang ở chế độ Xem. */
export function ServiceNormSection({ editor, readOnly, idPrefix }: { editor: ServiceNormEditor; readOnly: boolean; idPrefix: string }) {
  if (!editor.visible) return null;
  const editable = editor.canEdit && !readOnly;
  return (
    <BoxedSection badge="Vật tư tiêu hao (định mức)">
      {editor.loading && <Skeleton className="h-24 w-full" />}
      {editor.loadFailed && <ErrorBanner message="Không tải được định mức vật tư của dịch vụ này." onRetry={editor.retry} />}
      {!editor.loading && !editor.loadFailed && (
        <div className="space-y-3">
          {editable && (
            <ConsumptionItemPicker
              id={`${idPrefix}-norm-search`}
              label="Tìm vật tư hoặc thuốc để thêm vào định mức"
              excludeDrugIds={editor.lines.map((l) => l.drugId)}
              onPick={(item) => editor.setLines(addDraftLine(editor.lines, item))}
            />
          )}
          <ConsumptionDraftTable
            idPrefix={`${idPrefix}-norm`}
            lines={editor.lines}
            onChange={editor.setLines}
            disabled={!editable}
            emptyText="Chưa có vật tư tiêu hao"
          />
          <p className="text-sm text-slate-500">Điền sẵn khi ghi vật tư đã dùng; người thực hiện sửa được theo số thực dùng.</p>
        </div>
      )}
    </BoxedSection>
  );
}
