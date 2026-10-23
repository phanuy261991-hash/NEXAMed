import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.schema';

/** Cookie "máy quen" sống 180 ngày kể từ lần đăng nhập ĐÚNG gần nhất (mỗi lần đăng nhập đúng cấp lại). */
export const DEVICE_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60_000;
/** Chỉ gửi kèm các yêu cầu `/api/v1/auth/*` (đăng nhập), cùng đường dẫn cookie làm mới phiên. */
export const DEVICE_COOKIE_PATH = '/api/v1/auth';

const COOKIE_PREFIX = 'nx_dev_';
const TOKEN_PATTERN = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
/** Cho phép đồng hồ lệch nhẹ giữa các lần cấp/kiểm. */
const CLOCK_SKEW_SEC = 60;

export interface DeviceCookie {
  name: string;
  value: string;
  maxAgeMs: number;
}

/**
 * "Máy quen" của một tài khoản (docs/DECISIONS.md #259): trình duyệt đã đăng nhập ĐÚNG tài khoản đó giữ một cookie ký (HMAC-SHA256, khoá dẫn xuất từ `JWT_SECRET`), mỗi tài khoản
 * một cookie riêng (`nx_dev_<userId>`) nên một máy dùng chung cho nhiều người vẫn đúng. KHÔNG lưu gì ở cơ sở dữ liệu (không bảng thiết bị, không thu hồi từng máy).
 *
 * Dấu hiệu gắn với (công ty, tài khoản, MẬT KHẨU HIỆN TẠI): đổi mật khẩu / quản trị đặt lại mật khẩu → mọi máy quen cũ tự mất hiệu lực (tài khoản nghi bị lộ thì phải đăng nhập lại như máy lạ).
 * Đổi `JWT_SECRET` cũng vô hiệu hết. Cookie chỉ có tác dụng NỚI khoá cho chính chủ (xem `resolveLoginBlock` ở core), không phải bằng chứng đăng nhập: vẫn phải đúng mật khẩu.
 */
@Injectable()
export class DeviceTrustService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_SECRET')).update('nexamed:device-trust:v1').digest();
  }

  cookieName(userId: string): string {
    return COOKIE_PREFIX + userId.replace(/-/g, '');
  }

  /** Dấu hiệu mới cấp sau khi đăng nhập ĐÚNG. */
  issue(tenantId: string, user: { id: string; passwordHash: string }, now: Date = new Date()): DeviceCookie {
    const issuedAtSec = Math.floor(now.getTime() / 1000);
    return { name: this.cookieName(user.id), value: `v1.${issuedAtSec}.${this.mac(tenantId, user, issuedAtSec)}`, maxAgeMs: DEVICE_COOKIE_MAX_AGE_MS };
  }

  /** Yêu cầu này có đến từ máy quen của `user` không? Cookie hỏng/hết hạn/của người khác/của mật khẩu cũ → không. Không bao giờ ném lỗi. */
  isFamiliar(cookies: Record<string, string | undefined> | undefined, tenantId: string, user: { id: string; passwordHash: string }, now: Date = new Date()): boolean {
    const raw = cookies?.[this.cookieName(user.id)];
    if (typeof raw !== 'string') return false;
    const match = TOKEN_PATTERN.exec(raw);
    if (!match) return false;
    const issuedAtSec = Number(match[1]);
    const nowSec = Math.floor(now.getTime() / 1000);
    if (issuedAtSec > nowSec + CLOCK_SKEW_SEC) return false;
    if ((nowSec - issuedAtSec) * 1000 > DEVICE_COOKIE_MAX_AGE_MS) return false;
    const expected = Buffer.from(this.mac(tenantId, user, issuedAtSec));
    const actual = Buffer.from(match[2]!);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private mac(tenantId: string, user: { id: string; passwordHash: string }, issuedAtSec: number): string {
    const credentialTag = createHash('sha256').update(user.passwordHash).digest('hex').slice(0, 16);
    return createHmac('sha256', this.key).update(`${tenantId}|${user.id}|${credentialTag}|${issuedAtSec}`).digest('base64url');
  }
}
