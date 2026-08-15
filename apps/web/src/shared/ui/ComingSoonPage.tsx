import type { Icon } from '@phosphor-icons/react';
import { useBreadcrumb } from '../layout/breadcrumb.context';
import { EmptyState } from './EmptyState';

/**
 * Trang giữ chỗ cho mục sidebar chưa có module/backend thật đứng sau (docs/DECISIONS.md #046) —
 * ngoại lệ có chủ đích với quy tắc "không dựng menu cho tính năng chưa xây"
 * (.claude/docs/ui-guidelines.md mục 10), chủ dự án yêu cầu đặt chỗ vị trí sidebar trước. KHÔNG tự
 * viết logic/schema nghiệp vụ nào ở đây — chỉ hiển thị, không mở rộng phạm vi v1 đã chốt trong
 * `CLAUDE.md`. Dùng chung cho mọi mục "Sắp ra mắt" thay vì tạo 4 file gần như giống hệt nhau.
 */
export function ComingSoonPage({
  pageTitle,
  icon,
  description,
}: {
  pageTitle: string;
  icon: Icon;
  description: string;
}) {
  useBreadcrumb([{ label: 'Quản trị' }, { label: pageTitle }]);

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <h1 className="sr-only">{pageTitle}</h1>
      <EmptyState icon={icon} title="Sắp ra mắt" description={description} />
    </div>
  );
}