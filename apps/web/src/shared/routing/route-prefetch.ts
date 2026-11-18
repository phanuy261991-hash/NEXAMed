import { isValidElement, type ReactNode } from 'react';
import { matchRoutes, type RouteObject } from 'react-router-dom';

/**
 * Tải trước chunk JS của trang (docs/DECISIONS.md #304). Hai cách dùng:
 *  - `prefetchRoute(href)`: ngay khi rê chuột/focus/chạm vào liên kết menu (thường sớm hơn lúc bấm 100–300 ms);
 *  - `queueIdlePrefetch(href)`: xếp hàng tải dần từng trang lúc trình duyệt rảnh, mỗi lúc MỘT chunk, để lần đầu vào trang không phải chờ.
 * Bảng route đăng ký MỘT lần ở `router.tsx` (`registerRouteTable`) — không import router ở đây để không tạo vòng phụ thuộc với Sidebar.
 */
let routeTable: RouteObject[] = [];

export function registerRouteTable(routes: RouteObject[]): void {
  routeTable = routes;
}

type Preloader = () => Promise<void>;

/** Duyệt cây element của một route (kể cả khi bọc trong RequirePermissionRoute...) để gom các component lười có `preload`. */
function collectPreloaders(node: ReactNode, out: Preloader[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectPreloaders(child as ReactNode, out);
    return;
  }
  if (!isValidElement(node)) return;
  const type = node.type as unknown;
  if (typeof type === 'object' && type !== null && 'preload' in type && typeof (type as { preload: unknown }).preload === 'function') out.push((type as { preload: Preloader }).preload);
  collectPreloaders((node.props as { children?: ReactNode }).children, out);
}

/** Các hàm tải trước của route khớp `href` (rỗng nếu không khớp hay trang không lười). Chỉ lấy phần đường dẫn, bỏ `?query`/`#hash`. */
export function preloadersFor(href: string): Preloader[] {
  const path = href.split(/[?#]/)[0] || '/';
  const matches = matchRoutes(routeTable, path) ?? [];
  const out: Preloader[] = [];
  for (const m of matches) collectPreloaders(m.route.element as ReactNode, out);
  return out;
}

const prefetched = new Set<string>();

export function prefetchRoute(href: string): void {
  const path = href.split(/[?#]/)[0] || '/';
  if (prefetched.has(path)) return;
  prefetched.add(path);
  for (const preload of preloadersFor(path)) void preload();
}

/** Mạng yếu hoặc người dùng bật tiết kiệm dữ liệu thì KHÔNG tải trước lúc rảnh (rê chuột vẫn tải). */
export function idlePrefetchAllowed(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  return !(connection?.effectiveType && /^(slow-2g|2g)$/.test(connection.effectiveType));
}

const idleQueue: string[] = [];
let idleScheduled = false;

type IdleScheduler = (callback: () => void) => void;
const defaultScheduler: IdleScheduler = (callback) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(() => callback(), { timeout: 4000 });
  else setTimeout(callback, 1500);
};

/** Lúc chờ trước khi bắt đầu tải trước (để việc tải của chính trang đang mở xong trước). */
const IDLE_START_DELAY_MS = 2500;
/** Khoảng nghỉ giữa hai chunk: không chiếm kết nối khi người dùng vừa bấm sang trang khác. */
const IDLE_GAP_MS = 300;
const HIDDEN_RECHECK_MS = 5000;

export function queueIdlePrefetch(href: string, scheduler: IdleScheduler = defaultScheduler): void {
  const path = href.split(/[?#]/)[0] || '/';
  if (prefetched.has(path) || idleQueue.includes(path)) return;
  idleQueue.push(path);
  if (idleScheduled) return;
  idleScheduled = true;
  const step = (delayMs: number) => {
    setTimeout(
      () =>
        scheduler(() => {
          if (typeof document !== 'undefined' && document.hidden) return step(HIDDEN_RECHECK_MS); // tab ẩn: chờ lâu rồi kiểm lại, không tải
          const next = idleQueue.shift();
          if (next === undefined) {
            idleScheduled = false;
            return;
          }
          if (!idlePrefetchAllowed()) {
            idleQueue.length = 0;
            idleScheduled = false;
            return;
          }
          prefetchRoute(next);
          step(IDLE_GAP_MS);
        }),
      delayMs,
    );
  };
  step(IDLE_START_DELAY_MS);
}

/** Chỉ cho test: xoá trạng thái. */
export function resetRoutePrefetchForTest(): void {
  prefetched.clear();
  idleQueue.length = 0;
  idleScheduled = false;
  routeTable = [];
}
