import { useState, type ReactNode } from 'react';
import { Printer } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintPaperSize } from '@nexamed/shared';
import { Button } from '../ui/Button';
import { PrintPaperDialog } from './PrintPaperDialog';
import { usePrintPaperChoice } from './print-paper-choice';
import { useResolvedPrintTemplate } from './print-template.queries';

/**
 * Nút "In" dùng chung cho mọi chứng từ (docs/DECISIONS.md #211). Chứng từ có từ 2 khổ giấy trở lên: bấm nút mở hộp
 * thoại chọn khổ (khổ mặc định đã cấu hình ở "Quản lý mẫu in" được chọn sẵn); chỉ có 1 khổ thì in thẳng. Lựa chọn chỉ áp
 * cho lần in đó (xem `print-paper-choice.ts`). `onPrint` là đúng hàm in cũ của nơi gọi (dựng chứng từ rồi
 * `window.print()`) — nút này chỉ đặt khổ giấy trước khi gọi.
 */
export function PrintButton({
  documentType,
  onPrint,
  children = 'In phiếu',
  variant = 'secondary',
  loading,
  disabled,
  className = '',
  renderTrigger,
}: {
  documentType: PrintDocumentType;
  onPrint: () => void;
  children?: ReactNode;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * Nút bấm tuỳ biến (ví dụ nút icon trong hàng bảng) thay cho `Button` mặc định — vẫn đi qua đúng luồng chọn khổ giấy. `onClick` mở hộp thoại chọn khổ (hoặc in thẳng nếu chứng từ chỉ có 1 khổ).
   */
  renderTrigger?: (trigger: { onClick: () => void; loading?: boolean; disabled?: boolean }) => ReactNode;
}) {
  const resolved = useResolvedPrintTemplate(documentType);
  const setChoice = usePrintPaperChoice((s) => s.setChoice);
  const [open, setOpen] = useState(false);
  const options = resolved?.options ?? [];

  function print(paperSize: PrintPaperSize | null) {
    setOpen(false);
    setChoice(documentType, paperSize);
    onPrint();
  }

  const handleClick = () => (options.length > 1 ? setOpen(true) : print(null));

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: handleClick, loading, disabled })
      ) : (
        <Button type="button" variant={variant} loading={loading} disabled={disabled} className={className} onClick={handleClick}>
          <Printer size={15} weight="bold" aria-hidden="true" />
          {children}
        </Button>
      )}
      {open && <PrintPaperDialog options={options} onConfirm={print} onCancel={() => setOpen(false)} />}
    </>
  );
}
