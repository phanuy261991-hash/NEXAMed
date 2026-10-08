/**
 * Logic thuần của "Lấy mẫu xét nghiệm có tem mã vạch" (docs/DECISIONS.md #220): gộp xét nghiệm của một phiếu vào các ống mẫu theo loại mẫu bệnh phẩm, ghép chữ viết tắt
 * nhóm in trên tem, và các điều kiện cho phép thao tác trên ống. Không phụ thuộc framework — API dùng ở service (cả lúc mở hộp thoại lẫn lúc dựng hàng đợi).
 */

export type SpecimenTubeStatusValue = 'PENDING' | 'COLLECTED' | 'CANCELLED';

export interface TubeItemInput {
  itemId: string;
  /** Mã loại Mẫu bệnh phẩm của dịch vụ (`technical_service.specimen_type_code`); `null` = dịch vụ chưa khai loại mẫu. */
  specimenTypeCode: string | null;
}

export interface ExistingPendingTube {
  id: string;
  specimenTypeCode: string | null;
  /** Số lần đã in tem — ống ĐÃ in tem thì không gộp thêm xét nghiệm vào (tem đã in/dán không còn đúng nội dung). */
  printCount: number;
}

export interface PlannedTube {
  specimenTypeCode: string | null;
  itemIds: string[];
}

export interface TubePlan {
  /** Dòng gộp vào ống PENDING chưa in đã có. */
  attach: { itemId: string; tubeId: string }[];
  /** Ống mới cần tạo (mỗi loại mẫu một ống), kèm các dòng chỉ định của ống. */
  create: PlannedTube[];
}

/**
 * Xếp các dòng xét nghiệm CHƯA có ống vào ống: ưu tiên ống PENDING chưa in tem cùng loại mẫu, không có thì tạo ống mới (một ống cho mỗi loại mẫu). Giữ thứ tự xuất hiện của
 * dòng và của loại mẫu để kết quả ổn định giữa các lần gọi.
 */
export function planSpecimenTubes(unassigned: readonly TubeItemInput[], existingPending: readonly ExistingPendingTube[]): TubePlan {
  const attach: TubePlan['attach'] = [];
  const created = new Map<string, PlannedTube>();
  for (const item of unassigned) {
    const target = existingPending.find((t) => t.printCount === 0 && t.specimenTypeCode === item.specimenTypeCode);
    if (target) {
      attach.push({ itemId: item.itemId, tubeId: target.id });
      continue;
    }
    const key = item.specimenTypeCode ?? '';
    const planned = created.get(key);
    if (planned) planned.itemIds.push(item.itemId);
    else created.set(key, { specimenTypeCode: item.specimenTypeCode, itemIds: [item.itemId] });
  }
  return { attach, create: [...created.values()] };
}

/** Ghép viết tắt các nhóm dịch vụ trong ống: không trùng, giữ thứ tự xuất hiện, nối bằng "/" ("HH/SH"). Nhóm chưa khai viết tắt bị bỏ qua; không có gì thì `null`. */
export function joinGroupAbbreviations(abbreviations: readonly (string | null | undefined)[]): string | null {
  const unique: string[] = [];
  for (const raw of abbreviations) {
    const value = raw?.trim();
    if (value && !unique.includes(value)) unique.push(value);
  }
  return unique.length > 0 ? unique.join('/') : null;
}

/** "Tách" 1 xét nghiệm sang ống riêng: chỉ khi ống còn chờ lấy, CHƯA in tem lần nào và còn nhiều hơn 1 xét nghiệm. */
export function canSplitSpecimenTube(tube: { status: SpecimenTubeStatusValue; printCount: number }, itemCount: number): boolean {
  return tube.status === 'PENDING' && tube.printCount === 0 && itemCount > 1;
}

/**
 * "Huỷ ống & lấy lại" chỉ khi ống chưa huỷ và các xét nghiệm trong ống CHƯA có kết quả nào (kể cả bản nháp) — đã có kết quả thì phải đi đường đính chính / làm lại phiếu.
 */
export function canRecollectSpecimenTube(tube: { status: SpecimenTubeStatusValue }, hasAnyResult: boolean): boolean {
  return tube.status !== 'CANCELLED' && !hasAnyResult;
}

/** "Huỷ xác nhận đã lấy mẫu": ống đã lấy và chưa có kết quả nào. */
export function canUncollectSpecimenTube(tube: { status: SpecimenTubeStatusValue }, hasAnyResult: boolean): boolean {
  return tube.status === 'COLLECTED' && !hasAnyResult;
}

/**
 * Mã quét/gõ vào ô "Quét mã ống": súng quét USB gõ mã rồi Enter nên có thể kèm khoảng trắng hoặc ký tự điều khiển. Chuẩn hoá về chuỗi trim — không đổi chữ hoa/thường
 * (SID do khuôn mẫu của phòng khám quyết định, có thể có chữ).
 */
export function normalizeScannedSid(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim();
}
