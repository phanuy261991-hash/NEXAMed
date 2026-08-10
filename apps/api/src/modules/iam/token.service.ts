import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '@nexamed/core';
import { jwtPayloadSchema, type JwtPayload } from '@nexamed/shared';

export interface IssuedToken {
  token: string;
  expiresIn: number;
}

/**
 * Ký/verify access + refresh JWT. Dùng chung một JWT_SECRET cho cả hai loại, phân biệt bằng
 * claim `typ` — đơn giản hơn quản lý hai secret, có thể tách sau mà không đổi kiến trúc. Xem
 * docs/DECISIONS.md #019.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get secret(): string {
    return this.configService.getOrThrow<string>('JWT_SECRET');
  }

  signAccessToken(userId: string, tenantId: string): IssuedToken {
    const payload: JwtPayload = { sub: userId, tenantId, typ: 'access' };
    const token = this.jwtService.sign(payload, { secret: this.secret, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  signRefreshToken(userId: string, tenantId: string): IssuedToken {
    const payload: JwtPayload = { sub: userId, tenantId, typ: 'refresh', jti: randomUUID() };
    const token = this.jwtService.sign(payload, { secret: this.secret, expiresIn: REFRESH_TOKEN_TTL_SECONDS });
    return { token, expiresIn: REFRESH_TOKEN_TTL_SECONDS };
  }

  /**
   * Trả `null` thay vì ném lỗi khi token sai/hết hạn/sai định dạng claim — nơi gọi tự quyết
   * định lỗi nghiệp vụ nào phù hợp (InvalidCredentials, RefreshTokenInvalid...), token verify
   * tự nó không biết ngữ cảnh gọi là gì.
   */
  verify(token: string): JwtPayload | null {
    try {
      const decoded: unknown = this.jwtService.verify(token, { secret: this.secret });
      const parsed = jwtPayloadSchema.safeParse(decoded);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
