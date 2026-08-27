import { useEffect, useRef } from 'react';

/**
 * Checkbox chọn dòng/chọn tất cả dùng chung cho mọi bảng danh sách — `indeterminate` là thuộc
 * tính DOM thuần (không có prop JSX tương ứng), phải gán qua ref.
 */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className="selection-checkbox"
    />
  );
}