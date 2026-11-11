import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';

/**
 * Bộ phát hiện GIAO DỊCH LỒNG NHAU lúc chạy (docs/DECISIONS.md #264, #296) — lớp 1 trong ba lớp chống cạn bể kết nối.
 *
 * `UnitOfWorkService.runInTenantScope()` chiếm MỘT kết nối Postgres suốt thân hàm. Nếu trong thân đó lại mở thêm một giao
 * dịch khác (gọi một port mà adapter tự mở giao dịch) hoặc dùng client gốc của Prisma (không phải `tx`), request chiếm
 * HAI kết nối cùng lúc; khi số request đồng thời chạm cỡ bể, mọi request giữ kết nối 1 và chờ kết nối 2 → bể tự khoá nhau →
 * HTTP 500 "Unable to start a transaction in the given time". Lỗi chỉ lộ lúc máy bận nên rất khó thấy bằng test thường.
 *
 * Cách hoạt động: `AsyncLocalStorage` ghi nhớ "đang ở trong giao dịch X" cho mọi lời gọi bất đồng bộ xuất phát từ thân
 * giao dịch đó. Hai nơi kiểm: `UnitOfWorkService` (mở giao dịch thứ hai) và middleware của `PrismaService` (truy vấn bằng client
 * gốc). Phát hiện CHẮC CHẮN tại chỗ vi phạm, không phụ thuộc thời gian chờ, và thấy cả đường gọi gián tiếp qua nhiều tầng.
 *
 * Chế độ (biến môi trường `NESTED_TRANSACTION_GUARD`, mặc định theo `NODE_ENV`):
 *  - `throw` (mặc định ở test và phát triển): ném lỗi kèm stack ngay tại chỗ — chặn TRƯỚC khi xin kết nối thứ hai nên không tự khoá.
 *  - `warn`  (mặc định ở production): chỉ ghi log cảnh báo (mỗi vị trí một lần), không đổi hành vi của người dùng.
 *  - `off`: tắt.
 */
export interface TransactionScope {
  /** `false` sau khi giao dịch đóng — lời gọi nền còn sót lại sau đó không bị coi là lồng. */
  active: boolean;
  /** Vị trí mã đã mở giao dịch (khung đầu tiên của dự án trong stack). */
  openedAt: string;
}

export const transactionScopeStorage = new AsyncLocalStorage<TransactionScope>();

export type NestedTransactionGuardMode = 'throw' | 'warn' | 'off';

/** Đọc `NODE_ENV`/`NESTED_TRANSACTION_GUARD` lúc gọi (không cache) để test đổi được giữa các ca. */
export function nestedTransactionGuardMode(): NestedTransactionGuardMode {
  const explicit = process.env.NESTED_TRANSACTION_GUARD;
  if (explicit === 'throw' || explicit === 'warn' || explicit === 'off') return explicit;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'throw';
}

export class NestedTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NestedTransactionError';
  }
}

const logger = new Logger('NestedTransactionGuard');
const warned = new Set<string>();

/** Khung đầu tiên trong stack nằm trong mã dự án (bỏ qua chính tệp hạ tầng này và UnitOfWork/Prisma). */
export function projectCallSite(skipFrames = 0): string {
  const frames = (new Error().stack ?? '').split('\n').slice(2 + skipFrames);
  for (const frame of frames) {
    const m = /\(?((?:[A-Za-z]:)?[^():]*[\\/](?:apps[\\/]api[\\/])?src[\\/][^():]+\.ts):(\d+):\d+\)?$/.exec(frame.trim());
    if (!m) continue;
    const file = m[1]!.replace(/\\/g, '/');
    if (file.endsWith('/transaction-scope.ts') || file.endsWith('/unit-of-work.service.ts') || file.endsWith('/prisma.service.ts')) continue;
    return `${file.replace(/^.*\/src\//, 'src/')}:${m[2]}`;
  }
  return 'không xác định';
}

/**
 * Báo một lần lồng giao dịch. `kind` mô tả cách lồng; `outer` là giao dịch đang mở. Ở chế độ `throw` ném lỗi (stack giữ nguyên
 * để thấy cả chuỗi lời gọi), ở `warn` chỉ ghi log một lần cho mỗi cặp (vị trí mở, vị trí lồng).
 */
export function reportNestedTransaction(kind: 'runInTenantScope' | 'prisma-client-query', outer: TransactionScope, detail?: string): void {
  const mode = nestedTransactionGuardMode();
  if (mode === 'off') return;
  const at = projectCallSite();
  const what = kind === 'runInTenantScope' ? 'mở thêm một giao dịch (gọi port/dịch vụ tự mở giao dịch)' : `truy vấn bằng client gốc của Prisma${detail ? ` (${detail})` : ''}, không phải tx`;
  const message =
    `Giao dịch lồng nhau: ${what} tại ${at} trong lúc giao dịch mở tại ${outer.openedAt} còn đang chạy — request chiếm 2 kết nối cùng lúc ` +
    `và cạn bể kết nối khi nhiều người thao tác. Lấy dữ liệu qua port TRƯỚC khi mở giao dịch rồi truyền kết quả vào (docs/DECISIONS.md #264, #296).`;
  if (mode === 'throw') throw new NestedTransactionError(message);
  const key = `${outer.openedAt}|${at}|${kind}`;
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(message);
}
