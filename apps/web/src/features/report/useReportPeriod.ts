import { useCallback, useMemo, useState } from 'react';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { periodError, resolvePeriod, type PeriodKind, type PeriodRange } from './report-period';

export interface ReportPeriodState {
  kind: PeriodKind;
  /** Khoảng ngày đang áp dụng (đã giải quyết từ `kind`; với `custom` là khoảng đã nhập). */
  range: PeriodRange;
  /** Khoảng đang nhập ở kỳ "Tuỳ chọn" (có thể chưa hợp lệ). */
  custom: PeriodRange;
  /** Lỗi nhập khoảng ngày (chỉ khi kỳ Tuỳ chọn); `null` nếu hợp lệ — khi có lỗi KHÔNG tải số liệu. */
  error: string | null;
  today: string;
  setKind: (kind: PeriodKind) => void;
  setCustom: (range: PeriodRange) => void;
}

/**
 * Trạng thái "Kỳ" của các báo cáo điều hành (docs/DECISIONS.md #287): chọn kỳ có sẵn hoặc "Tuỳ chọn". Dùng chung cho mọi báo cáo có bộ chọn kỳ. Kỳ tuỳ chọn lỗi (ngược, quá 366 ngày)
 * giữ `range` ở khoảng hợp lệ gần nhất để màn hình không nháy, và `error` báo rõ để trang không gọi máy chủ.
 */
export function useReportPeriod(initial: PeriodKind): ReportPeriodState {
  const today = getVietnamTodayDateString();
  const [kind, setKindState] = useState<PeriodKind>(initial);
  const [custom, setCustomState] = useState<PeriodRange>(() => resolvePeriod('thisMonth', today));

  const setKind = useCallback((next: PeriodKind) => setKindState(next), []);
  const setCustom = useCallback((range: PeriodRange) => setCustomState(range), []);

  const error = kind === 'custom' ? periodError(custom) : null;
  const range = useMemo(() => resolvePeriod(kind, today, custom), [kind, today, custom]);
  return { kind, range, custom, error, today, setKind, setCustom };
}
