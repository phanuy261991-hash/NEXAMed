import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Banner "Đã lưu" thoáng qua (~2 giây) sau khi bấm "Lưu và nhập tiếp" (`.claude/docs/
 * ui-guidelines.md` mục 4.7) — dự án không dùng Toast cho phản hồi thành công của form nhập liệu
 * (mục 4.3 chỉ dùng Toast cho thao tác KHÁC form), nên form không đóng cần tín hiệu tại chỗ.
 */
export function useSaveFlash(durationMs = 2000) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const triggerFlash = useCallback(() => {
    setVisible(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), durationMs);
  }, [durationMs]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { flashVisible: visible, triggerFlash };
}
