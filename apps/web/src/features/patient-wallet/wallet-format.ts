import type { WalletTransaction } from '@nexamed/shared';

/** Cùng khuôn `InvoiceDetailPage.formatDateTime` — quy đổi giờ Việt Nam ở tầng hiển thị (CLAUDE.md). */
export function formatWalletDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} · ${dd}/${mm}/${vn.getUTCFullYear()}`;
}

export function formatWalletDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${vn.getUTCFullYear()}`;
}

/** Nhãn + nội dung 1 dòng lịch sử ví — tổng hợp từ dữ liệu snapshot (không có field "mô tả" riêng). */
export function walletTransactionMeta(tx: Pick<WalletTransaction, 'type' | 'note'>): { label: string; badgeTone: 'success' | 'info' | 'accent' | 'neutral' } {
  switch (tx.type) {
    case 'TOPUP':
      return { label: 'Nạp tiền', badgeTone: 'success' };
    case 'DEDUCT':
      return { label: 'Cấn trừ', badgeTone: 'info' };
    case 'REFUND':
      return { label: 'Hoàn về ví', badgeTone: 'accent' };
    case 'SETTLEMENT':
      return { label: 'Tất toán', badgeTone: 'neutral' };
  }
}

export function walletTransactionDescription(tx: Pick<WalletTransaction, 'type' | 'note'>): string {
  switch (tx.type) {
    case 'TOPUP':
      return tx.note ? `Nạp tạm ứng · ${tx.note}` : 'Nạp tạm ứng';
    case 'DEDUCT':
      return 'Cấn trừ phiếu thu';
    case 'REFUND':
      return tx.note ? `Hoàn về ví — ${tx.note}` : 'Hoàn về ví';
    case 'SETTLEMENT':
      return 'Tất toán — hoàn số dư còn lại';
  }
}
