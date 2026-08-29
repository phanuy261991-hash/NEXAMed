import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  AccountDisabledError,
  AccountLockedError,
  InvalidCredentialsError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  isAccountLocked,
  recordFailedLogin,
} from '@nexamed/core';
import type { ChangePasswordRequest, LoginRequest } from '@nexamed/shared';
import type { Prisma, UserSession } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { TokenService } from './token.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface CurrentUserResult {
  id: string;
  username: string;
  fullName: string;
  displayName: string | null;
  roles: string[];
  mustChangePassword: boolean;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: CurrentUserResult;
  refreshToken: string;
  refreshExpiresIn: number;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

type LoginOutcome =
  | { kind: 'success'; result: LoginResult }
  | { kind: 'invalid_credentials' }
  | { kind: 'account_disabled' }
  | { kind: 'account_locked'; lockedUntil: Date };

type RefreshOutcome =
  | { kind: 'success'; result: RefreshResult }
  | { kind: 'invalid' }
  | { kind: 'reuse_detected' }
  | { kind: 'account_disabled' };

/**
 * Điều phối login/refresh/logout — xem .claude/docs/security-audit.md mục Xác thực,
 * docs/DECISIONS.md #019/#020. Mọi thao tác ghi (user_account, user_session, audit_log) nằm
 * trong cùng transaction qua UnitOfWorkService, đúng .claude/docs/coding-standards.md.
 *
 * QUAN TRỌNG: `prisma.$transaction(async (tx) => ...)` (dùng bên trong UnitOfWorkService) rollback
 * toàn bộ nếu callback throw — kể cả khi throw đó là một "kết quả nghiệp vụ" bình thường
 * (sai mật khẩu, phát hiện reuse...) mà ta MUỐN commit (đếm số lần sai, thu hồi phiên). Vì vậy
 * callback không bao giờ throw DomainError — nó trả về một outcome, transaction luôn commit
 * bình thường, rồi hàm public mới throw DomainError tương ứng SAU KHI transaction đã xong.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountAuthRepository: UserAccountAuthRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly tokenService: TokenService,
  ) {}

  async login(request: LoginRequest, meta: RequestMeta): Promise<LoginResult> {
    const outcome = await this.unitOfWork.runInTenantScope<LoginOutcome>(request.tenantId, async (tx) => {
      const user = await this.userAccountAuthRepository.findByUsername(tx, request.tenantId, request.username);
      if (!user) {
        // Không log audit: chưa xác định được entity_id thật, tránh vô tình biến audit_log
        // thành nơi liệt kê username bị đoán thử — xem docs/DECISIONS.md #020.
        return { kind: 'invalid_credentials' };
      }

      if (!user.isActive) {
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return { kind: 'account_disabled' };
      }

      const now = new Date();
      if (isAccountLocked(user, now)) {
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return { kind: 'account_locked', lockedUntil: user.lockedUntil! };
      }

      const passwordOk = await argon2.verify(user.passwordHash, request.password);
      if (!passwordOk) {
        const nextState = recordFailedLogin(
          {
            failedLoginCount: user.failedLoginCount,
            lastFailedLoginAt: user.lastFailedLoginAt,
            lockedUntil: user.lockedUntil,
          },
          now,
        );
        await this.userAccountAuthRepository.recordFailedLogin(tx, request.tenantId, user.id, nextState);
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return { kind: 'invalid_credentials' };
      }

      await this.userAccountAuthRepository.recordSuccessfulLogin(tx, request.tenantId, user.id);
      const issued = await this.issueSession(tx, request.tenantId, user.id, meta);
      const roles = await this.userAccountAuthRepository.findRoleNamesForUser(tx, request.tenantId, user.id);

      await writeAuditLog(tx, request.tenantId, {
        actorId: user.id,
        action: 'auth.login_success',
        entityType: 'user_account',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const accessToken = this.tokenService.signAccessToken(user.id, request.tenantId);

      return {
        kind: 'success',
        result: {
          accessToken: accessToken.token,
          expiresIn: accessToken.expiresIn,
          user: {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            displayName: user.displayName,
            roles,
            mustChangePassword: user.mustChangePassword,
          },
          refreshToken: issued.rawRefreshToken,
          refreshExpiresIn: issued.expiresIn,
        },
      };
    });

    switch (outcome.kind) {
      case 'success':
        return outcome.result;
      case 'account_disabled':
        throw new AccountDisabledError();
      case 'account_locked':
        throw new AccountLockedError(outcome.lockedUntil);
      case 'invalid_credentials':
        throw new InvalidCredentialsError();
    }
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<RefreshResult> {
    const payload = this.tokenService.verify(rawRefreshToken);
    if (!payload || payload.typ !== 'refresh') {
      throw new RefreshTokenInvalidError();
    }

    const outcome = await this.unitOfWork.runInTenantScope<RefreshOutcome>(payload.tenantId, async (tx) => {
      const hash = this.tokenService.hashRefreshToken(rawRefreshToken);
      const session = await this.sessionRepository.findByHash(tx, payload.tenantId, hash);
      if (!session) {
        return { kind: 'invalid' };
      }

      if (session.deletedAt) {
        // Hash này đã bị rotate/thu hồi trước đó nhưng vẫn bị dùng lại — coi là dấu hiệu token
        // rò rỉ, thu hồi toàn bộ phiên của user cho an toàn thay vì chỉ từ chối request này.
        await this.sessionRepository.revokeAllForUser(
          tx,
          payload.tenantId,
          session.userId,
          'reuse_detected',
          session.userId,
        );
        await writeAuditLog(tx, payload.tenantId, {
          actorId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'user_account',
          entityId: session.userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { kind: 'reuse_detected' };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await this.sessionRepository.revoke(tx, payload.tenantId, session.id, 'expired', session.userId);
        return { kind: 'invalid' };
      }

      const user = await this.userAccountAuthRepository.findById(tx, payload.tenantId, session.userId);
      if (!user || !user.isActive) {
        await this.sessionRepository.revokeAllForUser(
          tx,
          payload.tenantId,
          session.userId,
          'account_disabled',
          session.userId,
        );
        return { kind: 'account_disabled' };
      }

      const issued = await this.issueSession(tx, payload.tenantId, session.userId, meta);
      await this.sessionRepository.revoke(
        tx,
        payload.tenantId,
        session.id,
        'rotated',
        session.userId,
        issued.session.id,
      );

      // KHÔNG ghi audit_log cho lượt làm mới phiên thường (S5-05, chủ dự án yêu cầu trực tiếp) —
      // xảy ra mỗi 15 phút/phiên đang mở, thuần vận hành kỹ thuật, không phải một lượt truy cập mới
      // theo nghĩa Thông tư 46 (đã có `auth.login_success` đánh dấu điểm bắt đầu phiên). Phát hiện
      // dùng lại refresh token (`auth.refresh_reuse_detected`, sự cố bảo mật thật) VẪN ghi như cũ.
      const accessToken = this.tokenService.signAccessToken(session.userId, payload.tenantId);

      return {
        kind: 'success',
        result: {
          accessToken: accessToken.token,
          expiresIn: accessToken.expiresIn,
          refreshToken: issued.rawRefreshToken,
          refreshExpiresIn: issued.expiresIn,
        },
      };
    });

    switch (outcome.kind) {
      case 'success':
        return outcome.result;
      case 'reuse_detected':
        throw new RefreshTokenReuseDetectedError();
      case 'account_disabled':
        throw new AccountDisabledError();
      case 'invalid':
        throw new RefreshTokenInvalidError();
    }
  }

  /** Idempotent: cookie thiếu/hỏng/hết hạn cũng coi như đăng xuất thành công, không báo lỗi. */
  async logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const payload = this.tokenService.verify(rawRefreshToken);
    if (!payload || payload.typ !== 'refresh') {
      return;
    }

    await this.unitOfWork.runInTenantScope(payload.tenantId, async (tx) => {
      const hash = this.tokenService.hashRefreshToken(rawRefreshToken);
      const session = await this.sessionRepository.findByHash(tx, payload.tenantId, hash);
      if (!session || session.deletedAt) {
        return;
      }

      await this.sessionRepository.revoke(tx, payload.tenantId, session.id, 'logout', session.userId);
      await writeAuditLog(tx, payload.tenantId, {
        actorId: session.userId,
        action: 'auth.logout',
        entityType: 'user_account',
        entityId: session.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * Danh tính + vai trò của user đang đăng nhập — dùng cho `GET /auth/me` (S1-08, xem
   * docs/DECISIONS.md #022). Không ghi gì nên không cần lo transaction rollback-vì-throw như
   * login()/refresh() — throw thẳng trong callback là an toàn.
   */
  async getCurrentUser(tenantId: string, userId: string): Promise<CurrentUserResult> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const user = await this.userAccountAuthRepository.findById(tx, tenantId, userId);
      if (!user || !user.isActive) {
        throw new AccountDisabledError();
      }
      const roles = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, userId);
      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        displayName: user.displayName,
        roles,
        mustChangePassword: user.mustChangePassword,
      };
    });
  }

  /**
   * Tự đổi mật khẩu (mở rộng ADM-01) — dùng cho luồng bắt buộc lần đầu (`mustChangePassword`) lẫn
   * đổi mật khẩu tự nguyện sau này. Xác thực lại `currentPassword` (cùng cách break-glass #014
   * làm — không tin phiên đã đăng nhập là đủ cho thao tác nhạy cảm). Thu hồi toàn bộ phiên khác
   * đúng khuôn `resetPassword` (`user-account.service.ts`) — phiên hiện tại (access token 15
   * phút) vẫn dùng được tới khi hết hạn tự nhiên, không đăng xuất ngay giữa chừng thao tác.
   */
  async changePassword(tenantId: string, userId: string, dto: ChangePasswordRequest, meta: RequestMeta): Promise<void> {
    const outcome = await this.unitOfWork.runInTenantScope<'success' | 'invalid_credentials' | 'account_disabled'>(
      tenantId,
      async (tx) => {
        const user = await this.userAccountAuthRepository.findById(tx, tenantId, userId);
        if (!user || !user.isActive) {
          return 'account_disabled';
        }

        const passwordOk = await argon2.verify(user.passwordHash, dto.currentPassword);
        if (!passwordOk) {
          return 'invalid_credentials';
        }

        const newPasswordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
        await this.userAccountAuthRepository.updatePasswordAndClearMustChange(tx, tenantId, userId, newPasswordHash);

        await this.sessionRepository.revokeAllForUser(tx, tenantId, userId, 'password_changed', userId);

        await writeAuditLog(tx, tenantId, {
          actorId: userId,
          action: 'auth.password_changed',
          entityType: 'user_account',
          entityId: userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return 'success';
      },
    );

    switch (outcome) {
      case 'success':
        return;
      case 'account_disabled':
        throw new AccountDisabledError();
      case 'invalid_credentials':
        throw new InvalidCredentialsError();
    }
  }

  private async recordFailedAttempt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await writeAuditLog(tx, tenantId, {
      actorId: userId,
      action: 'auth.login_failed',
      entityType: 'user_account',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async issueSession(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<{ session: UserSession; rawRefreshToken: string; expiresIn: number }> {
    const refreshToken = this.tokenService.signRefreshToken(userId, tenantId);
    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken.token);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + refreshToken.expiresIn * 1000);

    const session = await this.sessionRepository.create(tx, tenantId, {
      userId,
      refreshTokenHash,
      issuedAt,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { session, rawRefreshToken: refreshToken.token, expiresIn: refreshToken.expiresIn };
  }
}
