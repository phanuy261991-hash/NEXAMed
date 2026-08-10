-- AlterTable
ALTER TABLE "user_account" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failed_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "locked_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "replaced_by_session_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refresh_token_hash_key" ON "user_session"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_tenant_id_id_key" ON "user_session"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_replaced_by_session_id_fkey" FOREIGN KEY ("tenant_id", "replaced_by_session_id") REFERENCES "user_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- S1-04 — xem .claude/docs/security-audit.md mục Xác thực, docs/DECISIONS.md #019.
-- CHECK (version >= 1) — optimistic locking, theo .claude/docs/data-model.md.
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu với prisma/migrations/*_tenant_context và *_rbac_data_scope.
-- Quyền SELECT/INSERT/UPDATE cơ bản đã tự động cấp cho nexamed_app qua ALTER DEFAULT
-- PRIVILEGES trong migration *_tenant_context — user_session cần UPDATE thật (thu hồi/rotate
-- là soft-delete qua UPDATE deleted_at), không REVOKE gì thêm, khác với audit_log/
-- break_glass_session (append-only).
ALTER TABLE "user_session" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "user_session"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Index phục vụ tra cứu phiên đang hiệu lực của một user (revoke-all khi đổi vai trò/tenant —
-- xem .claude/docs/data-model.md mục Index tối thiểu).
CREATE INDEX "user_session_tenant_id_user_id_expires_at_idx"
  ON "user_session" ("tenant_id", "user_id", "expires_at" DESC)
  WHERE "deleted_at" IS NULL;
