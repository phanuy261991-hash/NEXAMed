/**
 * Registry chuyên khoa (docs/DECISIONS.md #033, docs/product/multi-specialty-analysis.md) — khung
 * TỐI THIỂU chuẩn bị cho đa chuyên khoa, KHÔNG có nội dung chuyên khoa thật ở v1 (chưa có gói nhi/
 * sản/nha nào đăng ký). Mục đích duy nhất hiện tại: cho `encounter.specialty` (mặc định
 * `'general'`, xem `.claude/docs/data-model.md`) có nơi tra cứu hợp lệ, và đặt sẵn ranh giới để
 * khi thật sự làm một gói chuyên khoa, không phải sửa lại service/repository dùng chung.
 *
 * Nguyên tắc bắt buộc (không tự ý đổi): service/repository dùng chung KHÔNG được rẽ nhánh
 * `if (specialty === '...')` — chỉ tra registry này. Logic riêng của từng chuyên khoa (khi có)
 * thuộc về chính `SpecialtyPack` đó, không lọt vào kernel.
 */

/** Mọi tenant luôn có sẵn chuyên khoa này — không phải đăng ký, không xoá được. */
export const GENERAL_SPECIALTY_ID = 'general';

export interface SpecialtyPack {
  /** Khớp giá trị lưu ở `encounter.specialty`. */
  readonly id: string;
  /** Tên hiển thị tiếng Việt — dùng khi có UI chọn chuyên khoa (chưa tồn tại ở v1). */
  readonly label: string;
}

export interface SpecialtyRegistry {
  /** Đăng ký một gói mới — gọi lúc wiring module khởi động, không phải theo từng request. */
  register(pack: SpecialtyPack): void;
  get(id: string): SpecialtyPack | undefined;
  list(): readonly SpecialtyPack[];
}

/**
 * Mỗi lần gọi tạo một registry độc lập (không phải singleton toàn tiến trình) — tránh state chia
 * sẻ ngoài ý muốn giữa test hoặc giữa nhiều lần wiring; nơi dùng thật (apps/api) tự giữ đúng một
 * instance theo đời sống của ứng dụng.
 */
export function createSpecialtyRegistry(): SpecialtyRegistry {
  const packs = new Map<string, SpecialtyPack>([[GENERAL_SPECIALTY_ID, { id: GENERAL_SPECIALTY_ID, label: 'Khám tổng quát' }]]);

  return {
    register(pack: SpecialtyPack): void {
      if (packs.has(pack.id)) {
        throw new Error(`Specialty pack "${pack.id}" đã được đăng ký.`);
      }
      packs.set(pack.id, pack);
    },
    get(id: string): SpecialtyPack | undefined {
      return packs.get(id);
    },
    list(): readonly SpecialtyPack[] {
      return Array.from(packs.values());
    },
  };
}
