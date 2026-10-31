import { beforeEach, describe, expect, it } from 'vitest';
import { UNSAVED_GUARD_ROUTES, isGuardedPath, shouldBlockNavigation, useUnsavedChangesStore } from './unsaved-changes';

describe('isGuardedPath — trang biểu mẫu dài cần cảnh báo dữ liệu nhập dở', () => {
  it('canh trang thêm bệnh nhân, tiếp nhận và cả bốn loại phiếu kho (mới lẫn sửa nháp)', () => {
    for (const path of [
      '/patients/new',
      '/reception/new',
      '/inventory/receipts/new',
      '/inventory/receipts/01a18a6d-1e18-7d72-8d15-cafe873dbf52',
      '/inventory/issues/manual/new',
      '/inventory/issues/manual/01a18a6d-1e18-7d72-8d15-cafe873dbf52',
      '/inventory/counts/new',
      '/inventory/counts/01a18a6d-1e18-7d72-8d15-cafe873dbf52',
      '/inventory/transfers/new',
      '/inventory/transfers/01a18a6d-1e18-7d72-8d15-cafe873dbf52',
    ]) {
      expect(isGuardedPath(path), path).toBe(true);
    }
  });

  it('KHÔNG canh danh sách, màn khám (đã tự lưu nháp), hồ sơ bệnh nhân, trang lạ', () => {
    for (const path of ['/patients', '/reception', '/inventory/receipts', '/inventory/issues', '/encounters/abc', '/patients/01a18a6d', '/admin/print-templates', '/', '/inventory/receipts/abc/extra']) {
      expect(isGuardedPath(path), path).toBe(false);
    }
  });

  it('danh sách khai báo không có mục trùng', () => {
    expect(new Set(UNSAVED_GUARD_ROUTES).size).toBe(UNSAVED_GUARD_ROUTES.length);
  });
});

describe('shouldBlockNavigation', () => {
  it('chỉ chặn khi đang có dữ liệu nhập dở VÀ đường dẫn đổi', () => {
    expect(shouldBlockNavigation(true, '/reception/new', '/')).toBe(true);
    expect(shouldBlockNavigation(false, '/reception/new', '/')).toBe(false);
  });
  it('đổi tham số tìm kiếm cùng trang (đường dẫn không đổi) không bị chặn', () => {
    expect(shouldBlockNavigation(true, '/patients/new', '/patients/new')).toBe(false);
  });
});

describe('useUnsavedChangesStore', () => {
  beforeEach(() => useUnsavedChangesStore.getState().clear());

  it('mặc định sạch; markDirty bật cờ, clear tắt cờ, gọi lặp không đổi trạng thái', () => {
    const s = useUnsavedChangesStore.getState();
    expect(s.dirty).toBe(false);
    s.markDirty();
    s.markDirty();
    expect(useUnsavedChangesStore.getState().dirty).toBe(true);
    s.clear();
    s.clear();
    expect(useUnsavedChangesStore.getState().dirty).toBe(false);
  });
});
