import { Injectable } from '@nestjs/common';
import { computeLineProgress, deriveStockRequestStatus, type StockRequestLineInput } from '@nexamed/core';
import type { Prisma } from '@prisma/client';
import { StockRequestRepository, type StockRequestDetailRow } from './stock-request.repository';

/** Chuyển dòng đọc từ DB thành đầu vào của hàm trạng thái thuần ở `packages/core`. */
export function toLineInput(line: StockRequestDetailRow['lines'][number]): StockRequestLineInput {
  return {
    fulfilStatus: line.fulfilStatus,
    requestedQty: line.requestedQty,
    transferLines: line.transferLines.map((tl) => ({ transferStatus: tl.transfer.status, quantityShipped: tl.quantityShipped, quantityReceived: tl.quantityReceived })),
  };
}

/**
 * Đồng bộ trạng thái "Yêu cầu cấp hàng" (docs/DECISIONS.md #298) — gọi TRONG transaction của thao tác đổi dữ liệu (cấp hàng, rút dòng, và mọi
 * bước của phiếu điều chuyển liên kết). Phụ thuộc MỘT chiều: `StockTransferService` → service này; service này chỉ đọc/ghi bảng yêu cầu.
 */
@Injectable()
export class StockRequestSyncService {
  constructor(private readonly stockRequestRepository: StockRequestRepository) {}

  /**
   * Tính lại trạng thái dòng + cả phiếu từ các phiếu điều chuyển liên kết:
   *  1. dòng đã "Đã cấp" mà không còn phiếu hiệu lực nào (kho cấp từ chối phiếu điều chuyển nháp) → quay về "Chờ xử lý";
   *  2. trạng thái cả phiếu suy ra từ các dòng; đổi trạng thái thì ghi vào diễn biến.
   * `message` (tuỳ chọn) ghi thêm một dòng diễn biến cho bước vừa xảy ra ở phiếu điều chuyển.
   */
  async refresh(tx: Prisma.TransactionClient, tenantId: string, actorId: string, requestId: string, event?: { type: string; message: string; detail?: string | null }): Promise<void> {
    const request = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, requestId);
    if (!request) return;

    const lines = request.lines.map((line) => ({ line, input: toLineInput(line) }));
    for (const item of lines) {
      if (item.line.fulfilStatus === 'ALLOCATED' && computeLineProgress(item.input).allocatedQty === 0) {
        await this.stockRequestRepository.setLineStatus(tx, tenantId, item.line.id, actorId, 'PENDING');
        item.input = { ...item.input, fulfilStatus: 'PENDING' };
      }
    }

    if (event) await this.stockRequestRepository.addEvent(tx, tenantId, requestId, actorId, event.type, event.message, { detail: event.detail ?? null });

    const next = deriveStockRequestStatus(request.status, lines.map((l) => l.input));
    if (next === request.status) return;
    await this.stockRequestRepository.touch(tx, tenantId, requestId, actorId, { status: next, completedAt: next === 'COMPLETED' ? new Date() : null });
    if (next === 'COMPLETED') await this.stockRequestRepository.addEvent(tx, tenantId, requestId, actorId, 'completed', 'Đã hoàn thành', { detail: null });
  }
}
