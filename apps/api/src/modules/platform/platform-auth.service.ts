import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccountLockedError, InvalidCredentialsError, PlatformOtpInvalidError, isAccountLocked, recordFailedLogin as nextFailedState } from '@nexamed/core';
import type { PlatformLoginRequest, PlatformLoginResponse, PlatformOperator as PlatformOperatorDto, PlatformSessionResponse, PlatformVerifyOtpRequest } from '@nexamed/shared';
import type { PlatformOperator } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import type { RequestMeta } from '../../common/request-meta';
import { decryptPii } from '../../infrastructure/crypto/pii-encryption';
import { verifyTotp } from '../../infrastructure/crypto/totp';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformOperatorRepository } from './platform-operator.repository';

const MFA_TOKEN_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const platformJwtPayloadSchema = z.object({ sub: z.string().uuid(), typ: z.enum(['platform_mfa', 'platform_access']) });

/**
 * Đăng nhập người vận hành nền tảng (docs/DECISIONS.md #237): bước 1 mật khẩu → mã tạm; bước 2 mã OTP (TOTP) → access token riêng (`typ: platform_access`, 60 phút, không có refresh —
 * hết hạn thì đăng nhập lại). Token này KHÔNG dùng được cho API phòng khám (khác `typ` và không có `tenantId`) và ngược lại. Khoá tạm sau 5 lần sai (mật khẩu hoặc OTP) bằng chung quy tắc
 * của tài khoản phòng khám (`recordFailedLogin` ở core): lộ mật khẩu cũng không cho phép dò OTP vô hạn.
 */
@Injectable()
export class PlatformAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly operators: PlatformOperatorRepository,
    private readonly audit: PlatformAuditRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(dto: PlatformLoginRequest, meta: RequestMeta): Promise<PlatformLoginResponse> {
    const operator = await this.operators.findByUsername(dto.username);
    const now = new Date();
    if (operator && isAccountLocked(operator, now)) throw new AccountLockedError(operator.lockedUntil!);
    // Không có tài khoản/đã khoá cũng băm một mật khẩu giả để thời gian phản hồi không tiết lộ tên đăng nhập có tồn tại hay không.
    const passwordOk = operator && operator.isActive ? await argon2.verify(operator.passwordHash, dto.password) : (await argon2.verify(await this.getDummyHash(), dto.password), false);
    if (!operator || !operator.isActive || !passwordOk) {
      if (operator) await this.registerFailure(operator, now, meta);
      throw new InvalidCredentialsError();
    }
    return { mfaToken: this.sign(operator.id, 'platform_mfa', MFA_TOKEN_TTL_SECONDS), expiresIn: MFA_TOKEN_TTL_SECONDS };
  }

  async verifyOtp(dto: PlatformVerifyOtpRequest, meta: RequestMeta): Promise<PlatformSessionResponse> {
    const claims = this.verifyToken(dto.mfaToken, 'platform_mfa');
    const operator = claims ? await this.operators.findById(claims.sub) : null;
    if (!operator || !operator.isActive) throw new PlatformOtpInvalidError();
    const now = new Date();
    if (isAccountLocked(operator, now)) throw new AccountLockedError(operator.lockedUntil!);
    const secret = decryptPii(Buffer.from(operator.totpSecretEnc, 'base64'), this.config.getOrThrow('ENCRYPTION_KEY', { infer: true }));
    if (!verifyTotp(secret, dto.code, now.getTime())) {
      await this.registerFailure(operator, now, meta);
      throw new PlatformOtpInvalidError();
    }
    await this.operators.recordSuccessfulLogin(operator, now);
    await this.audit.append({ operatorId: operator.id, action: 'platform.login', ip: meta.ip, userAgent: meta.userAgent });
    return { accessToken: this.sign(operator.id, 'platform_access', ACCESS_TOKEN_TTL_SECONDS), expiresIn: ACCESS_TOKEN_TTL_SECONDS, operator: toDto(operator) };
  }

  /** Dùng ở `PlatformAuthGuard`: access token hợp lệ + người vận hành còn hoạt động → trả người vận hành, ngược lại `null`. */
  async authenticate(accessToken: string): Promise<PlatformOperatorDto | null> {
    const claims = this.verifyToken(accessToken, 'platform_access');
    if (!claims) return null;
    const operator = await this.operators.findById(claims.sub);
    return operator && operator.isActive ? toDto(operator) : null;
  }

  private async registerFailure(operator: PlatformOperator, now: Date, meta: RequestMeta): Promise<void> {
    await this.operators.recordFailedLogin(operator, nextFailedState(operator, now));
    await this.audit.append({ operatorId: operator.id, action: 'platform.login_failed', ip: meta.ip, userAgent: meta.userAgent });
  }

  private sign(operatorId: string, typ: 'platform_mfa' | 'platform_access', ttlSeconds: number): string {
    return this.jwt.sign({ sub: operatorId, typ, jti: randomUUID() }, { secret: this.config.getOrThrow('JWT_SECRET', { infer: true }), expiresIn: ttlSeconds });
  }

  private verifyToken(token: string, expected: 'platform_mfa' | 'platform_access'): { sub: string } | null {
    try {
      const decoded: unknown = this.jwt.verify(token, { secret: this.config.getOrThrow('JWT_SECRET', { infer: true }) });
      const parsed = platformJwtPayloadSchema.safeParse(decoded);
      return parsed.success && parsed.data.typ === expected ? { sub: parsed.data.sub } : null;
    } catch {
      return null;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash(randomUUID(), { type: argon2.argon2id });
    return this.dummyHash;
  }
}

function toDto(operator: Pick<PlatformOperator, 'id' | 'username' | 'fullName'>): PlatformOperatorDto {
  return { id: operator.id, username: operator.username, fullName: operator.fullName };
}
