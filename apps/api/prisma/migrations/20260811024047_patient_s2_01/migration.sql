-- CreateTable
CREATE TABLE "patient" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "national_id_enc" BYTEA,
    "national_id_hash" TEXT,
    "address_json" JSONB,
    "allergy_note" TEXT,
    "merged_into_id" UUID,
    "global_patient_ref" UUID,
    "identity_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_tenant_id_id_key" ON "patient"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_tenant_id_patient_code_key" ON "patient"("tenant_id", "patient_code");

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_tenant_id_merged_into_id_fkey" FOREIGN KEY ("tenant_id", "merged_into_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- S2-01 — xem .claude/docs/data-model.md, docs/ERD.md.
-- CHECK (version >= 1) — optimistic locking, theo .claude/docs/data-model.md.
ALTER TABLE "patient" ADD CONSTRAINT "patient_version_check" CHECK (version >= 1);

-- C3 (docs/ERD.md mục 4): chặn trùng CCCD trong cùng tenant, vẫn cho phép nhiều bệnh nhân
-- không có CCCD (national_id_hash NULL) — partial unique index, không biểu diễn được bằng
-- Prisma schema (@@unique thường), viết thẳng SQL.
CREATE UNIQUE INDEX "patient_tenant_id_national_id_hash_key"
  ON "patient" ("tenant_id", "national_id_hash")
  WHERE "national_id_hash" IS NOT NULL;

-- Row Level Security — cùng mẫu với các migration trước (*_tenant_context, *_rbac_data_scope,
-- *_auth_sessions). Quyền SELECT/INSERT/UPDATE cơ bản đã tự động cấp cho nexamed_app qua
-- ALTER DEFAULT PRIVILEGES trong migration *_tenant_context, không cần GRANT lại ở đây.
ALTER TABLE "patient" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "patient"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Index tra cứu theo số điện thoại (PAT-02) — xem docs/ERD.md mục 5 "Index cần có từ đầu".
CREATE INDEX "patient_tenant_id_phone_idx" ON "patient" ("tenant_id", "phone");

-- Partial index cho truy vấn mặc định (chỉ đọc bản còn hiệu lực) — C7 trong docs/ERD.md.
CREATE INDEX "patient_tenant_id_id_active_idx" ON "patient" ("tenant_id", "id") WHERE "deleted_at" IS NULL;
