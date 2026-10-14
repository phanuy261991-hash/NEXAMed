import { useHasPermission } from '../auth/usePermission';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from './paraclinical-group';

/**
 * Mở XEM NỘI DUNG kết quả (chỉ số, kết luận) từ hai menu tra cứu: chỉ người làm chuyên môn của nhóm — có quyền Nhập hoặc Duyệt (kỹ thuật viên, điều dưỡng, bác sĩ, quản lý).
 * Lễ tân chỉ có quyền Xem nên ở "Tra cứu kết quả" chỉ thấy danh sách và nút In (chủ dự án chốt 13/10/2026, #232). Không thêm quyền mới — dựa trên quyền có sẵn của nhóm.
 */
export function useCanViewResultContent(group: ParaclinicalGroup): boolean {
  const module = PARACLINICAL_GROUP_META[group].permissionModule;
  const canEnter = useHasPermission(module, 'enter');
  const canApprove = useHasPermission(module, 'approve');
  return canEnter || canApprove;
}
