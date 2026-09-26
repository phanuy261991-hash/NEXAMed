import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveSupplierDebtAdjustmentRequest,
  CreateSupplierDebtAdjustmentRequest,
  CreateSupplierDebtReconciliationRequest,
  FinalizeSupplierDebtReconciliationRequest,
  ListSupplierDebtAdjustmentsQuery,
  ListSupplierDebtLedgerQuery,
  ListSupplierDebtPaymentsQuery,
  RecordSupplierDebtOpeningBalanceRequest,
  RecordSupplierDebtPaymentRequest,
  RecordSupplierDebtRefundRequest,
  RejectSupplierDebtAdjustmentRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveSupplierDebtAdjustment,
  createSupplierDebtAdjustment,
  createSupplierDebtReconciliation,
  finalizeSupplierDebtReconciliation,
  getSupplierDebtSummary,
  listSupplierDebtAdjustments,
  listSupplierDebtLedger,
  listSupplierDebtPayments,
  listSupplierDebtReceipts,
  listSupplierDebtReconciliations,
  listSupplierDebtSummaries,
  previewSupplierDebtReconciliation,
  recordSupplierDebtOpeningBalance,
  recordSupplierDebtPayment,
  recordSupplierDebtRefund,
  rejectSupplierDebtAdjustment,
} from './supplier-debt.api';

/** `enabled` mặc định `true` — Sidebar (badge chờ duyệt "Công nợ nhà cung cấp") truyền `false` cho
 * ai không có `supplier_debt.read` để tránh gọi API thừa/403 (đúng khuôn `useSupplierDebtSummaryQuery`). */
export function useSupplierDebtSummariesQuery(includeInactive: boolean, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-summaries', includeInactive ? 'all' : 'active'),
    queryFn: () => listSupplierDebtSummaries(includeInactive),
    enabled,
  });
}

export function useSupplierDebtSummaryQuery(supplierId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId),
    queryFn: () => getSupplierDebtSummary(supplierId),
    enabled: enabled && Boolean(supplierId),
  });
}

export function useSupplierDebtLedgerQuery(supplierId: string, query: ListSupplierDebtLedgerQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId, query.from ?? '', query.to ?? ''),
    queryFn: () => listSupplierDebtLedger(supplierId, query),
  });
}

export function useSupplierDebtReceiptsQuery(supplierId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId),
    queryFn: () => listSupplierDebtReceipts(supplierId),
  });
}

/** Sau Khai nợ đầu kỳ: làm mới CẢ dữ liệu công nợ (summary/ledger/receipts của đúng NCC này) LẪN
 * danh sách tổng hợp (cột "Còn nợ" ở trang Nhà cung cấp/Công nợ nhà cung cấp). */
export function useRecordSupplierDebtOpeningBalanceMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordSupplierDebtOpeningBalanceRequest) => recordSupplierDebtOpeningBalance(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
    },
  });
}

export function useSupplierDebtPaymentsQuery(query: ListSupplierDebtPaymentsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-payments', query.supplierId ?? '', query.from ?? '', query.to ?? '', query.status ?? ''),
    queryFn: () => listSupplierDebtPayments(query),
  });
}

/** Phần C — "Thu tiền NCC hoàn lại". Cùng 4 nhóm dữ liệu cần làm mới như "Thanh toán công nợ" ở
 * trên (đúng khuôn) — thêm cả 'stock-issue' KHÔNG cần thiết ở đây (refund không đụng stock_issue). */
export function useRecordSupplierDebtRefundMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordSupplierDebtRefundRequest) => recordSupplierDebtRefund(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-payments') });
    },
  });
}

/** Phần B — "Thanh toán công nợ" trên TỔNG nợ. Sau khi lập: làm mới đúng CẢ 4 nhóm dữ liệu bị ảnh
 * hưởng — số dư NCC (summary/ledger/receipts/summaries, đúng khuôn Khai nợ đầu kỳ ở trên) LẪN danh
 * sách "Phiếu thanh toán NCC" (badge chờ duyệt ở Sidebar cũng đọc từ `supplier-debt-summaries`). */
export function useRecordSupplierDebtPaymentMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordSupplierDebtPaymentRequest) => recordSupplierDebtPayment(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-payments') });
    },
  });
}

// ============ Phần D — "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182/#187) ============

/** Tab "Nhật ký điều chỉnh" (trang NCC, lọc `supplierId`) VÀ badge "Có điều chỉnh" trên phiếu nhập/
 * xuất gốc (lọc `targetReceiptId`/`targetIssueId`) — cùng 1 hook, nơi gọi tự truyền query khác nhau. */
export function useSupplierDebtAdjustmentsQuery(query: ListSupplierDebtAdjustmentsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(
      tenantId,
      'supplier-debt-adjustments',
      query.supplierId ?? '',
      query.status ?? '',
      query.targetReceiptId ?? '',
      query.targetIssueId ?? '',
    ),
    queryFn: () => listSupplierDebtAdjustments(query),
  });
}

/** Lập "Phiếu điều chỉnh công nợ" (Tăng/Giảm) hoặc "Đề nghị huỷ" — CHƯA đụng sổ/tồn kho (chỉ tạo
 * bản ghi `PENDING_APPROVAL`), chỉ cần làm mới danh sách điều chỉnh + `pendingAdjustmentCount` ở
 * `supplier-debt-summaries` (badge Sidebar/banner "chờ duyệt") — khác Duyệt (xem dưới), KHÔNG đụng
 * ledger/receipts/stock-*. */
export function useCreateSupplierDebtAdjustmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupplierDebtAdjustmentRequest) => createSupplierDebtAdjustment(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-adjustments') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
    },
  });
}

/** Duyệt Phiếu điều chỉnh/Đề nghị huỷ — `VOID_REQUEST` tự huỷ phiếu nhập/xuất gốc trong CÙNG
 * transaction (`docs/DECISIONS.md` #187), `INCREASE`/`DECREASE` chỉ đụng sổ công nợ. Không biết
 * trước loại nào đang duyệt ở đây — invalidate RỘNG đúng khuôn `useInvalidateInventory()`
 * (`inventory.queries.ts`) CỘNG các khoá công nợ, thay vì tách 2 nhánh theo `kind`. */
export function useApproveSupplierDebtAdjustmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveSupplierDebtAdjustmentRequest }) => approveSupplierDebtAdjustment(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-adjustments') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts') });
      // Phần E — Duyệt phiếu điều chỉnh có thể là phiếu do 1 biên bản đối chiếu tự sinh ra: trạng
      // thái `resultingAdjustmentStatus` (PENDING_APPROVAL → APPROVED) đổi, nút "Chốt" của dòng biên
      // bản đó cần bật lại ngay — phát hiện thật lúc verify Playwright (nút "Chốt" vẫn khoá sau khi
      // Duyệt do thiếu invalidate này).
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-reconciliations') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-receipt') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-issue') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-expiry') });
    },
  });
}

export function useRejectSupplierDebtAdjustmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectSupplierDebtAdjustmentRequest }) => rejectSupplierDebtAdjustment(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-adjustments') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
      // Từ chối phiếu điều chỉnh có thể tự huỷ 1 biên bản đối chiếu liên kết (Phần E) — làm mới CẢ
      // danh sách biên bản, không biết trước phiếu này có gắn biên bản nào không.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-reconciliations') });
    },
  });
}

// ============ Phần E — "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3) ============

/** Xem trước chênh lệch TRƯỚC khi lập biên bản — chỉ đọc, không ghi gì (không cần debounce riêng,
 * quy mô 1 NCC/1 truy vấn tổng nhẹ). `enabled` false khi chưa đủ dữ liệu để hỏi (đúng ngày + đã gõ
 * số NCC xác nhận). */
export function usePreviewSupplierDebtReconciliationQuery(supplierId: string, asOfDate: string, confirmedBalance: number | undefined) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-reconciliation-preview', supplierId, asOfDate, String(confirmedBalance ?? '')),
    queryFn: () => previewSupplierDebtReconciliation(supplierId, asOfDate, confirmedBalance!),
    enabled: Boolean(supplierId) && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) && confirmedBalance !== undefined,
  });
}

/** Tab "Đối chiếu & Chốt kỳ" (trang chi tiết NCC). */
export function useSupplierDebtReconciliationsQuery(supplierId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-reconciliations', supplierId),
    queryFn: () => listSupplierDebtReconciliations(supplierId),
    enabled: Boolean(supplierId),
  });
}

/** Lập biên bản — khớp thì server tự CHỐT NGAY (đủ để làm mới `summary`/`ledger`/`receipts` như
 * mọi mutation đụng sổ công nợ khác); lệch thì chỉ tạo Phiếu điều chỉnh Chờ duyệt (chưa đụng sổ,
 * nhưng vẫn cần làm mới `supplier-debt-adjustments` + `pendingAdjustmentCount` ở `summaries`) — gộp
 * chung 1 danh sách invalidate rộng cho cả 2 nhánh, đơn giản hơn tách theo kết quả trả về. */
export function useCreateSupplierDebtReconciliationMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupplierDebtReconciliationRequest) => createSupplierDebtReconciliation(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-reconciliations', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-adjustments') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
    },
  });
}

export function useFinalizeSupplierDebtReconciliationMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: FinalizeSupplierDebtReconciliationRequest }) => finalizeSupplierDebtReconciliation(supplierId, id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-reconciliations', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
    },
  });
}
