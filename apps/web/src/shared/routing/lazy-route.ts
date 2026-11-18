import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Component lười có thể TẢI TRƯỚC: `preload()` nạp chunk JS của trang mà chưa dựng nó. */
// `any` là bắt buộc: chữ ký của `React.lazy` nhận `ComponentType<any>`; dùng `never`/`unknown` làm các trang có props bị từ chối.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & { preload: () => Promise<void> };

/**
 * `React.lazy` + `preload()` (docs/DECISIONS.md #304). Đo 17/11/2026: lần đầu vào mỗi trang tải 5–15 tệp JS nối tiếp (chunk của trang → chunk của thành phần bên trong) rồi mới bắt đầu gọi dữ liệu.
 * `preload()` dùng CHUNG một lời hứa với `React.lazy`, nên tải trước xong thì bấm vào trang là dựng ngay, không tải thêm, và không bao giờ tải hai lần.
 * Tải trước lỗi (mất mạng...) KHÔNG làm hỏng trang: lời hứa được bỏ để lần điều hướng thật tự thử lại.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): PreloadableComponent<T> {
  let loading: Promise<{ default: T }> | null = null;
  const load = (): Promise<{ default: T }> => {
    loading ??= factory().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
  const component = lazy(load) as PreloadableComponent<T>;
  component.preload = async () => {
    try {
      await load();
    } catch {
      // bỏ qua: tải trước chỉ là tối ưu, điều hướng thật sẽ báo lỗi đúng cách (màn "Phần mềm vừa được cập nhật"/mất mạng)
    }
  };
  return component;
}
