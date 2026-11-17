/**
 * Chia các tab thành "hiện trên thanh" và "vào menu Thêm" theo bề rộng có sẵn (docs/DECISIONS.md #300, mockup Cách 2).
 * Hàm thuần, không đụng DOM: thành phần `OverflowTabs` đo bề rộng thật rồi gọi hàm này.
 *
 * Quy tắc: nếu mọi tab vừa thì hiện hết, không có menu. Nếu không, trừ chỗ cho nút "Thêm" rồi lấy tab theo thứ tự ưu tiên cho tới khi hết chỗ;
 * tab đang chọn luôn hiện (đổi chỗ với tab ưu tiên thấp nhất đang hiện). Thứ tự hiện trên thanh luôn là thứ tự gốc của `ids`.
 */
export interface OverflowTabsLayoutInput {
  /** Mọi tab theo thứ tự hiển thị gốc. */
  ids: string[];
  /** Cùng các id trên, xếp theo ưu tiên giảm dần (đầu danh sách ở lại thanh lâu nhất). */
  priorityIds: string[];
  /** Bề rộng từng tab (px). Tab chưa đo coi như 0. */
  widths: Record<string, number>;
  /** Bề rộng nút "Thêm" (px). */
  moreWidth: number;
  /** Bề rộng vùng chứa thanh tab (px). */
  available: number;
  /** Khoảng cách giữa hai phần tử liền kề (px). */
  gap: number;
  /** Tab đang chọn. */
  activeId: string;
}

export interface OverflowTabsLayout {
  visible: string[];
  overflow: string[];
}

function sumWidth(ids: string[], widths: Record<string, number>, gap: number): number {
  let total = 0;
  ids.forEach((id, i) => {
    total += (widths[id] ?? 0) + (i > 0 ? gap : 0);
  });
  return total;
}

export function layoutOverflowTabs(input: OverflowTabsLayoutInput): OverflowTabsLayout {
  const { ids, priorityIds, widths, moreWidth, available, gap, activeId } = input;
  // Chưa đo được (vùng chứa rộng 0, ví dụ lần vẽ đầu hoặc môi trường không có bố cục) thì hiện hết, không giấu tab nào.
  if (available <= 0 || sumWidth(ids, widths, gap) <= available) return { visible: [...ids], overflow: [] };

  const room = available - moreWidth - gap;
  let visible: string[] = [];
  for (const id of priorityIds) {
    if (!ids.includes(id)) continue;
    const next = [...visible, id];
    if (sumWidth(next, widths, gap) <= room) visible = next;
    else break;
  }

  if (ids.includes(activeId) && !visible.includes(activeId)) {
    visible.push(activeId);
    while (sumWidth(visible, widths, gap) > room && visible.length > 1) {
      // Bỏ tab ưu tiên thấp nhất (không phải tab đang chọn) cho tới khi vừa.
      const drop = [...priorityIds].reverse().find((id) => id !== activeId && visible.includes(id));
      if (!drop) break;
      visible = visible.filter((id) => id !== drop);
    }
  }

  const shown = new Set(visible);
  return { visible: ids.filter((id) => shown.has(id)), overflow: ids.filter((id) => !shown.has(id)) };
}
