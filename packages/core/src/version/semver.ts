import { SEMVER_PATTERN } from '@nexamed/shared';

/**
 * Phiên bản phần mềm theo SemVer 2.0 (docs/DECISIONS.md #236): `MAJOR.MINOR.PATCH[-tiền-phát-hành][+thông-tin-bản-dựng]`. Hàm thuần, KHÔNG phụ thuộc framework — dùng ở script phát hành
 * (tăng số), máy chủ (so sánh với bản mới nhất ở khung kiểm tra cập nhật, bước sau) và test. Không dùng thư viện ngoài vì chỉ cần đúng các phép dưới đây.
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Các đoạn tiền phát hành, ví dụ `['beta', '1']`; rỗng nếu là bản chính thức. */
  prerelease: string[];
  /** Thông tin bản dựng sau dấu `+` (không tham gia so sánh), ví dụ `20261015.e97a27c`. */
  build: string | null;
}

/** Trả `null` nếu chuỗi không đúng SemVer (không ném lỗi — nơi gọi quyết định xử lý). */
export function parseSemver(input: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ?? null,
  };
}

export function isValidSemver(input: string): boolean {
  return parseSemver(input) !== null;
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  // Định danh số luôn nhỏ hơn định danh chữ (SemVer 2.0, điều 11.4.3).
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * So sánh ưu tiên theo SemVer 2.0: `-1` nếu `a` cũ hơn `b`, `0` nếu bằng, `1` nếu mới hơn. Bản có tiền phát hành NHỎ HƠN bản chính thức cùng số (`1.0.0-beta.2 < 1.0.0`);
 * thông tin bản dựng (`+...`) bị bỏ qua. Chuỗi không hợp lệ → ném lỗi (so sánh sai số phiên bản là lỗi lập trình, không được âm thầm bỏ qua).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) {
    throw new Error(`Phiên bản không hợp lệ: ${!left ? a : b}`);
  }
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = comparePrereleaseIdentifier(l, r);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export type BumpKind = 'major' | 'minor' | 'patch' | 'beta';

/**
 * Tính số phiên bản kế tiếp (không có thông tin bản dựng). `major`/`minor`/`patch` luôn cho bản CHÍNH THỨC (bỏ tiền phát hành); `beta`: đang là `x.y.z-beta.n` thì thành `-beta.(n+1)`,
 * còn lại (bản chính thức hoặc tiền phát hành khác) thì mở đợt thử nghiệm của MINOR kế tiếp: `x.(y+1).0-beta.1`.
 */
export function bumpVersion(current: string, kind: BumpKind): string {
  const v = parseSemver(current);
  if (!v) throw new Error(`Phiên bản hiện tại không hợp lệ: ${current}`);
  if (kind === 'major') return `${v.major + 1}.0.0`;
  if (kind === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (kind === 'patch') {
    // Từ bản tiền phát hành, "patch" chốt chính thức chính số đó (1.5.0-beta.2 → 1.5.0), không nhảy thêm.
    return v.prerelease.length > 0 ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
  }
  if (v.prerelease[0] === 'beta' && /^\d+$/.test(v.prerelease[1] ?? '')) {
    return `${v.major}.${v.minor}.${v.patch}-beta.${Number(v.prerelease[1]) + 1}`;
  }
  return `${v.major}.${v.minor + 1}.0-beta.1`;
}

/** Kênh phát hành suy từ số phiên bản: có tiền phát hành `beta` → `beta`, ngược lại `stable`. */
export function channelOfVersion(version: string): 'stable' | 'beta' {
  const v = parseSemver(version);
  return v && v.prerelease[0] === 'beta' ? 'beta' : 'stable';
}
