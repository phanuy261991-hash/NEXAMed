import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  AccountDisabledError,
  AccountLockedError,
  AccountLockedPermanentlyError,
  BranchNotAssignedError,
  InvalidCredentialsError,
  MAX_ACTIVE_SESSIONS_PER_USER,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  TENANT_ACCESS_PORT,
  TenantSuspendedError,
  recordFailedFamiliarLogin,
  recordFailedStaffLogin,
  resolveBranchId,
  resolveLoginBlock,
  type TenantAccessPort,
} from '@nexamed/core';
import type { BranchLite, ChangePasswordRequest, DataScope, LoginRequest, SwitchBranchRequest } from '@nexamed/shared';
import type { Prisma, UserSession } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { findAllPermissionsForUser } from '../../infrastructure/persistence/permission-lookup.helper';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { TokenService } from './token.service';
import { BranchAccessService, toBranchLite } from './branch-access.service';
import { DeviceTrustService, type DeviceCookie } from './device-trust.service';
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
  /** Kho Thuốc GĐ4 (docs/DECISIONS.md #170) — cần trực tiếp để web tự lọc dropdown kho theo Khoa
   * khi scope `department` (ví dụ `stock_count.create`), đúng khuôn `user_account.department_id`
   * đã có sẵn từ #063. `null` cho tài khoản chưa gán Khoa/Phòng. */
  departmentId: string | null;
  roles: string[];
  permissions: Record<string, DataScope>;
  mustChangePassword: boolean;
  /** Chi nhánh được làm việc + chi nhánh đang chọn của phiên (docs/DECISIONS.md #231). */
  branches: BranchLite[];
  currentBranchId: string | null;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: CurrentUserResult;
  refreshToken: string;
  refreshExpiresIn: number;
  /** Dấu hiệu "máy quen" cấp sau khi đăng nhập ĐÚNG (#259) — controller đặt thành cookie. */
  deviceCookie: DeviceCookie;
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
  | { kind: 'account_locked'; lockedUntil: Date; now: Date }
  | { kind: 'account_locked_permanently' };

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
    private readonly branchAccess: BranchAccessService,
    private readonly deviceTrust: DeviceTrustService,
    @Inject(TENANT_ACCESS_PORT) private readonly tenantAccess: TenantAccessPort,
  ) {}

  /**
   * `cookies` = cookie của yêu cầu đăng nhập, để nhận ra MÁY QUEN (#259): khoá do máy LẠ gây ra chỉ chặn máy lạ, nên người khác gõ sai nhiều lần không tê liệt được tài khoản của chính chủ.
   * Mật khẩu đúng + máy quen còn GỠ mọi khoá. Máy lạ giữ nguyên chính sách khoá luỹ tiến → vĩnh viễn của #239.
   */
  async login(request: LoginRequest, meta: RequestMeta, cookies?: Record<string, string | undefined>): Promise<LoginResult> {
    // Công ty tạm ngưng (#237): chặn trước mọi thao tác khác. Công ty không tồn tại thì không báo gì riêng — rơi xuống luồng "sai thông tin" như cũ.
    if (await this.tenantAccess.isSuspended(request.tenantId)) throw new TenantSuspendedError();

    // BƯỚC 1 (transaction NGẮN): tra tài khoản + chặn theo trạng thái khoá. KHÔNG băm mật khẩu trong này — xem ghi chú ở bước 2.
    const prepared = await this.unitOfWork.runInTenantScope<LoginOutcome | { kind: 'verify'; passwordHash: string }>(request.tenantId, async (tx) => {
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
      // Khoá (#239) chặn TRƯỚC khi kiểm mật khẩu — mật khẩu đúng cũng không vào được tới khi hết khoá/quản trị mở khoá. Từ #259: khoá do máy LẠ gây ra chỉ chặn máy lạ; máy quen không bị liên luỵ.
      const familiar = this.deviceTrust.isFamiliar(cookies, request.tenantId, user, now);
      const block = resolveLoginBlock(user, familiar, now);
      if (block) {
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return block.kind === 'permanent' ? { kind: 'account_locked_permanently' } : { kind: 'account_locked', lockedUntil: block.until, now };
      }
      return { kind: 'verify', passwordHash: user.passwordHash };
    });
    if (prepared.kind !== 'verify') return this.finishLogin(prepared);

    // BƯỚC 2 — NGOÀI transaction (lỗi thật 21/10/2026, docs/DECISIONS.md #244): `argon2.verify` tốn ~100-300 ms và 64 MB RAM mỗi lượt. Chạy nó BÊN TRONG transaction
    // khiến mỗi người đang đăng nhập GIỮ một kết nối Postgres suốt thời gian đó; bể kết nối nhỏ (Prisma mặc định `số CPU × 2 + 1`) nên cả phòng khám đăng nhập đầu ca
    // là cạn bể → "Unable to start a transaction in the given time" → 500 hàng loạt. Cùng loại bài học với #242 GĐ1 (không mở transaction lồng nhau).
    const passwordOk = await argon2.verify(prepared.passwordHash, request.password);

    // BƯỚC 3 (transaction NGẮN): ghi kết quả. Đọc LẠI tài khoản vì giữa hai bước, tài khoản có thể vừa bị khoá/vô hiệu hoá bởi một lượt đăng nhập sai khác.
    const outcome = await this.unitOfWork.runInTenantScope<LoginOutcome>(request.tenantId, async (tx) => {
      const user = await this.userAccountAuthRepository.findByUsername(tx, request.tenantId, request.username);
      if (!user) return { kind: 'invalid_credentials' };
      if (!user.isActive) {
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return { kind: 'account_disabled' };
      }
      const now = new Date();
      const familiar = this.deviceTrust.isFamiliar(cookies, request.tenantId, user, now);
      const block = resolveLoginBlock(user, familiar, now);
      if (block) {
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        return block.kind === 'permanent' ? { kind: 'account_locked_permanently' } : { kind: 'account_locked', lockedUntil: block.until, now };
      }

      if (!passwordOk && familiar) {
        // MÁY QUEN gõ sai: đếm riêng, chỉ khoá tạm (không bao giờ vĩnh viễn) và không chạm bộ đếm của máy lạ (#259).
        const nextFamiliar = recordFailedFamiliarLogin(
          {
            familiarFailedLoginCount: user.familiarFailedLoginCount,
            familiarLastFailedLoginAt: user.familiarLastFailedLoginAt,
            familiarLockedUntil: user.familiarLockedUntil,
          },
          now,
        );
        await this.userAccountAuthRepository.recordFailedFamiliarLogin(tx, request.tenantId, user.id, nextFamiliar);
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        if (nextFamiliar.familiarLockedUntil) return { kind: 'account_locked', lockedUntil: nextFamiliar.familiarLockedUntil, now };
        return { kind: 'invalid_credentials' };
      }

      if (!passwordOk) {
        const nextState = recordFailedStaffLogin(
          {
            failedLoginCount: user.failedLoginCount,
            lastFailedLoginAt: user.lastFailedLoginAt,
            lockedUntil: user.lockedUntil,
            lockoutLevel: user.lockoutLevel,
            lockedPermanentlyAt: user.lockedPermanentlyAt,
          },
          now,
        );
        await this.userAccountAuthRepository.recordFailedLogin(tx, request.tenantId, user.id, nextState);
        await this.recordFailedAttempt(tx, request.tenantId, user.id, meta);
        // Lần sai vừa kích hoạt khoá: báo NGAY (số phút khoá / khoá vĩnh viễn) thay vì "sai mật khẩu" (#239).
        if (nextState.lockedPermanentlyAt) {
          await writeAuditLog(tx, request.tenantId, {
            actorId: user.id,
            action: 'auth.account_locked_permanently',
            entityType: 'user_account',
            entityId: user.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
          return { kind: 'account_locked_permanently' };
        }
        if (nextState.lockedUntil) return { kind: 'account_locked', lockedUntil: nextState.lockedUntil, now };
        return { kind: 'invalid_credentials' };
      }

      // Máy quen đăng nhập ĐÚNG khi tài khoản đang bị khoá do máy lạ → gỡ khoá và để lại dấu vết (#259).
      if (familiar && (user.lockedPermanentlyAt !== null || (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()))) {
        await writeAuditLog(tx, request.tenantId, {
          actorId: user.id,
          action: 'auth.account_unlocked_by_trusted_device',
          entityType: 'user_account',
          entityId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      await this.userAccountAuthRepository.recordSuccessfulLogin(tx, request.tenantId, user.id);
      const assignedBranches = await this.branchAccess.resolveAssigned(tx, request.tenantId, user.id);
      const currentBranchId = resolveBranchId(
        assignedBranches.map((b) => b.id),
        { lastBranchId: user.lastBranchId },
      );
      const issued = await this.issueSession(tx, request.tenantId, user.id, currentBranchId, meta);
      const roles = await this.userAccountAuthRepository.findRoleNamesForUser(tx, request.tenantId, user.id);
      const permissions = await findAllPermissionsForUser(tx, request.tenantId, user.id);

      await writeAuditLog(tx, request.tenantId, {
        actorId: user.id,
        action: 'auth.login_success',
        entityType: 'user_account',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const accessToken = this.tokenService.signAccessToken(user.id, request.tenantId, currentBranchId);

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
            departmentId: user.departmentId,
            roles,
            permissions,
            mustChangePassword: user.mustChangePassword,
            branches: assignedBranches.map(toBranchLite),
            currentBranchId,
            multiBranchCompany: await this.branchAccess.isMultiBranchCompany(tx, request.tenantId),
          },
          refreshToken: issued.rawRefreshToken,
          refreshExpiresIn: issued.expiresIn,
          deviceCookie: this.deviceTrust.issue(request.tenantId, user),
        },
      };
    });

    return this.finishLogin(outcome);
  }

  /** Kết quả đăng nhập → giá trị trả về hoặc lỗi nghiệp vụ tương ứng (dùng chung cho cả hai điểm thoát của `login`). */
  private finishLogin(outcome: LoginOutcome): LoginResult {
    switch (outcome.kind) {
      case 'success':
        return outcome.result;
      case 'account_disabled':
        throw new AccountDisabledError();
      case 'account_locked':
        throw new AccountLockedError(outcome.lockedUntil, outcome.now);
      case 'account_locked_permanently':
        throw new AccountLockedPermanentlyError();
      case 'invalid_credentials':
        throw new InvalidCredentialsError();
    }
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta, expectedTenantId?: string): Promise<RefreshResult> {
    const payload = this.tokenService.verify(rawRefreshToken);
    if (!payload || payload.typ !== 'refresh') {
      throw new RefreshTokenInvalidError();
    }
    // Chế độ SaaS: phiên chỉ làm mới được trên đúng tên miền phụ của công ty (#237). Công ty tạm ngưng thì không cấp token mới.
    if (expectedTenantId && payload.tenantId !== expectedTenantId) {
      throw new RefreshTokenInvalidError();
    }
    if (await this.tenantAccess.isSuspended(payload.tenantId)) throw new TenantSuspendedError();

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

      // Giữ chi nhánh của phiên nếu còn được phép; không thì chi nhánh nhớ lần trước; không thì phải chọn lại (#231).
      const assignedBranches = await this.branchAccess.resolveAssigned(tx, payload.tenantId, session.userId);
      const currentBranchId = resolveBranchId(
        assignedBranches.map((b) => b.id),
        { sessionBranchId: session.branchId, lastBranchId: user.lastBranchId },
      );
      const issued = await this.issueSession(tx, payload.tenantId, session.userId, currentBranchId, meta);
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
      const accessToken = this.tokenService.signAccessToken(session.userId, payload.tenantId, currentBranchId);

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

  /**
   * Đổi chi nhánh làm việc của PHIÊN (docs/DECISIONS.md #231): chỉ sang chi nhánh tài khoản được gán. Cập nhật `user_session.branch_id` (để làm mới
   * phiên sau đó giữ đúng chi nhánh), cấp lại access token mang claim `bid` mới; `remember=true` ghi nhớ làm chi nhánh mặc định cho lần đăng nhập sau.
   * Refresh token KHÔNG xoay vòng (cùng phiên, chỉ đổi chi nhánh).
   */
  async switchBranch(
    tenantId: string,
    userId: string,
    rawRefreshToken: string | undefined,
    dto: SwitchBranchRequest,
    meta: RequestMeta,
  ): Promise<{ accessToken: string; expiresIn: number; currentBranchId: string }> {
    const payload = rawRefreshToken ? this.tokenService.verify(rawRefreshToken) : null;
    if (!rawRefreshToken || !payload || payload.typ !== 'refresh' || payload.sub !== userId || payload.tenantId !== tenantId) {
      throw new RefreshTokenInvalidError();
    }
    const outcome = await this.unitOfWork.runInTenantScope<'invalid_session' | 'not_assigned' | { accessToken: string; expiresIn: number }>(tenantId, async (tx) => {
      const session = await this.sessionRepository.findByHash(tx, tenantId, this.tokenService.hashRefreshToken(rawRefreshToken));
      if (!session || session.deletedAt || session.userId !== userId) return 'invalid_session';
      const assigned = await this.branchAccess.resolveAssigned(tx, tenantId, userId);
      if (!assigned.some((b) => b.id === dto.branchId)) return 'not_assigned';

      await this.sessionRepository.setBranch(tx, tenantId, session.id, dto.branchId, userId);
      if (dto.remember) await this.userAccountAuthRepository.setLastBranch(tx, tenantId, userId, dto.branchId);
      await writeAuditLog(tx, tenantId, {
        actorId: userId,
        action: 'auth.branch_switched',
        entityType: 'user_account',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const accessToken = this.tokenService.signAccessToken(userId, tenantId, dto.branchId);
      return { accessToken: accessToken.token, expiresIn: accessToken.expiresIn };
    });
    if (outcome === 'invalid_session') throw new RefreshTokenInvalidError();
    if (outcome === 'not_assigned') throw new BranchNotAssignedError();
    return { ...outcome, currentBranchId: dto.branchId };
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
  async getCurrentUser(tenantId: string, userId: string, tokenBranchId: string | null = null): Promise<CurrentUserResult> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const user = await this.userAccountAuthRepository.findById(tx, tenantId, userId);
      if (!user || !user.isActive) {
        throw new AccountDisabledError();
      }
      const roles = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, userId);
      const permissions = await findAllPermissionsForUser(tx, tenantId, userId);
      const assignedBranches = await this.branchAccess.resolveAssigned(tx, tenantId, userId);
      const assignedIds = assignedBranches.map((b) => b.id);
      // Claim `bid` của access token là chi nhánh phiên đang dùng; không còn được gán (đổi phân quyền giữa chừng) thì coi như chưa chọn.
      const currentBranchId = tokenBranchId && assignedIds.includes(tokenBranchId) ? tokenBranchId : resolveBranchId(assignedIds, {});
      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        displayName: user.displayName,
        departmentId: user.departmentId,
        roles,
        permissions,
        mustChangePassword: user.mustChangePassword,
        branches: assignedBranches.map(toBranchLite),
        currentBranchId,
        multiBranchCompany: await this.branchAccess.isMultiBranchCompany(tx, tenantId),
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
    // Băm mật khẩu NGOÀI transaction (cùng lý do với `login` — #244): cả phòng khám buộc đổi mật khẩu lần đầu cùng lúc cũng không giữ kết nối Postgres trong lúc băm.
    const current = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountAuthRepository.findById(tx, tenantId, userId));
    if (!current || !current.isActive) throw new AccountDisabledError();
    const passwordOk = await argon2.verify(current.passwordHash, dto.currentPassword);
    if (!passwordOk) throw new InvalidCredentialsError();
    const newPasswordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    const outcome = await this.unitOfWork.runInTenantScope<'success' | 'invalid_credentials' | 'account_disabled'>(
      tenantId,
      async (tx) => {
        // Đọc lại: tài khoản có thể vừa bị vô hiệu hoá, hoặc mật khẩu vừa đổi ở nơi khác, trong lúc băm.
        const user = await this.userAccountAuthRepository.findById(tx, tenantId, userId);
        if (!user || !user.isActive) {
          return 'account_disabled';
        }
        if (user.passwordHash !== current.passwordHash) {
          return 'invalid_credentials';
        }

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
    branchId: string | null,
    meta: RequestMeta,
  ): Promise<{ session: UserSession; rawRefreshToken: string; expiresIn: number }> {
    const refreshToken = this.tokenService.signRefreshToken(userId, tenantId);
    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken.token);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + refreshToken.expiresIn * 1000);

    const session = await this.sessionRepository.create(tx, tenantId, {
      userId,
      branchId,
      refreshTokenHash,
      issuedAt,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    // Giữ tối đa `MAX_ACTIVE_SESSIONS_PER_USER` phiên mới nhất (#244) — phiên cũ nhất tự đăng xuất. Làm sau khi tạo để phiên vừa cấp luôn nằm trong số được giữ.
    await this.sessionRepository.revokeOldestBeyondLimit(tx, tenantId, userId, MAX_ACTIVE_SESSIONS_PER_USER, userId);

    return { session, rawRefreshToken: refreshToken.token, expiresIn: refreshToken.expiresIn };
  }
}
