import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { keyFingerprint } from '../crypto/key-fingerprint';
import { insuranceCardHashInput } from '../crypto/lookup-hash-inputs';
import { decryptPii, encryptPii, hashForLookup } from '../crypto/pii-encryption';
import { seedPermissionCatalog } from './seed-permissions';
import { seedDefaultRolesForTenant } from './seed-tenant-roles';
import { PrismaService } from './prisma.service';
import { RotateEncryptionKeyError, rotateEncryptionKey } from './rotate-encryption-key';

const OLD_KEY = 'khoa-cu-khoa-cu-khoa-cu-khoa-cu-khoa-cu-0001';
const NEW_KEY = 'khoa-moi-khoa-moi-khoa-moi-khoa-moi-khoa-moi-02';

// `db:rotate-encryption-key` (#262, docs/Deploy.md): mã hoá lại mọi dữ liệu mã hoá sang khoá mới trong MỘT giao dịch; sai khoá cũ thì DỪNG không ghi gì; không đụng công ty khác.
describe('rotateEncryptionKey', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  let fixture: TwoTenantFixture;
  const ids: { patientA?: string; patientB?: string; cardA?: string; encounterA?: string } = {};
  let tenantAScope: readonly string[];

  async function makePatient(tenantId: string, nationalId: string, key: string) {
    return privileged.patient.create({
      data: {
        tenantId,
        patientCode: `BN${Math.floor(1_000_000_000 + Math.random() * 8_999_999_999)}`,
        fullName: 'Bệnh nhân thử xoay khoá',
        dob: new Date('1990-01-01'),
        gender: 'female',
        phone: '0912000111',
        nationalIdEnc: encryptPii(nationalId, key),
        nationalIdHash: hashForLookup(nationalId, key),
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    fixture = await createTwoTenantFixture(privileged, 'RotateKey');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const patientA = await makePatient(fixture.tenantA.id, '079100000111', OLD_KEY);
    const patientB = await makePatient(fixture.tenantB.id, '079100000222', OLD_KEY);
    ids.patientA = patientA.id;
    ids.patientB = patientB.id;
    const card = await privileged.insuranceCard.create({
      data: { tenantId: fixture.tenantA.id, patientId: patientA.id, cardNoEnc: encryptPii('079193004512', OLD_KEY), cardNoHash: hashForLookup(insuranceCardHashInput('079193004512'), OLD_KEY), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    ids.cardA = card.id;

    // Lượt khám có bản chụp thẻ (số thẻ mã hoá base64 trong JSON).
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id } });
    const branch = await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id } });
    const encounter = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientId: patientA.id,
        departmentId: department.id,
        branchId: branch.id,
        encounterNo: `LK${Date.now()}`,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        insuranceSnapshot: { selfPay: false, cardNoEnc: encryptPii('079193004512', OLD_KEY).toString('base64'), validFrom: '2026-01-01' },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    ids.encounterA = encounter.id;

    // Phản hồi lưu tạm của khoá chống ghi trùng (mã hoá bằng khoá cũ) — phải bị xoá.
    const user = await privileged.userAccount.create({ data: { tenantId: fixture.tenantA.id, username: 'xoay-khoa', passwordHash: 'x', fullName: 'x', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.idempotencyKey.create({
      data: { tenantId: fixture.tenantA.id, userId: user.id, requestKey: '019f0000-0000-7000-8000-00000000a001', requestHash: 'h', method: 'POST', path: '/api/v1/x', status: 'COMPLETED', responseBodyEnc: encryptPii('{"v":1}', OLD_KEY), expiresAt: new Date(Date.now() + 3600_000), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    tenantAScope = [fixture.tenantA.id];
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('khoá không hợp lệ (ngắn, trùng nhau) bị từ chối ngay, không đụng dữ liệu', async () => {
    await expect(rotateEncryptionKey(appPrisma, { oldKey: 'ngan', newKey: NEW_KEY, tenantIds: tenantAScope })).rejects.toBeInstanceOf(RotateEncryptionKeyError);
    await expect(rotateEncryptionKey(appPrisma, { oldKey: OLD_KEY, newKey: 'ngan', tenantIds: tenantAScope })).rejects.toBeInstanceOf(RotateEncryptionKeyError);
    await expect(rotateEncryptionKey(appPrisma, { oldKey: OLD_KEY, newKey: OLD_KEY, tenantIds: tenantAScope })).rejects.toThrow(/trùng khoá cũ/);
  });

  it('DRY_RUN: đếm đúng, KHÔNG ghi gì', async () => {
    const before = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientA! } });
    const report = await rotateEncryptionKey(appPrisma, { oldKey: OLD_KEY, newKey: NEW_KEY, dryRun: true, tenantIds: tenantAScope });
    expect(report.dryRun).toBe(true);
    expect(report.rotated['patient.national_id']).toBe(1);
    expect(report.rotated['insurance_card.card_no']).toBe(1);
    expect(report.rotated['encounter.insurance_snapshot']).toBe(1);
    const after = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientA! } });
    expect(Buffer.from(after.nationalIdEnc!).equals(Buffer.from(before.nationalIdEnc!))).toBe(true);
    expect(await privileged.idempotencyKey.count({ where: { tenantId: fixture.tenantA.id } })).toBe(1);
  });

  it('SAI khoá cũ → dừng, báo số giá trị không đọc được, KHÔNG ghi gì', async () => {
    const before = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientA! } });
    await expect(rotateEncryptionKey(appPrisma, { oldKey: 'khoa-sai-khoa-sai-khoa-sai-khoa-sai-khoa-sai-9', newKey: NEW_KEY, tenantIds: tenantAScope })).rejects.toThrow(/KHÔNG giải mã được bằng khoá cũ/);
    const after = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientA! } });
    expect(Buffer.from(after.nationalIdEnc!).equals(Buffer.from(before.nationalIdEnc!))).toBe(true);
  });

  it('xoay thật: CCCD/thẻ BHYT/bản chụp thẻ giải mã được bằng khoá MỚI (không còn bằng khoá cũ), mã băm tra trùng đổi theo khoá mới, phản hồi tạm bị xoá, mã kiểm khoá + nhật ký được ghi', async () => {
    const report = await rotateEncryptionKey(appPrisma, { oldKey: OLD_KEY, newKey: NEW_KEY, tenantIds: tenantAScope });
    expect(report.newFingerprint).toBe(keyFingerprint(NEW_KEY));
    expect(report.oldFingerprint).toBe(keyFingerprint(OLD_KEY));
    expect(report.unreadable).toEqual({});

    const patient = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientA! } });
    expect(decryptPii(Buffer.from(patient.nationalIdEnc!), NEW_KEY)).toBe('079100000111');
    expect(() => decryptPii(Buffer.from(patient.nationalIdEnc!), OLD_KEY)).toThrow();
    expect(patient.nationalIdHash).toBe(hashForLookup('079100000111', NEW_KEY));
    expect(patient.version).toBe(1); // dữ liệu thật không đổi → không tăng version

    const card = await privileged.insuranceCard.findUniqueOrThrow({ where: { id: ids.cardA! } });
    expect(decryptPii(Buffer.from(card.cardNoEnc), NEW_KEY)).toBe('079193004512');
    expect(card.cardNoHash).toBe(hashForLookup(insuranceCardHashInput('079193004512'), NEW_KEY));

    const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: ids.encounterA! } });
    const snapshot = encounter.insuranceSnapshot as { cardNoEnc: string; validFrom: string; selfPay: boolean };
    expect(decryptPii(Buffer.from(snapshot.cardNoEnc, 'base64'), NEW_KEY)).toBe('079193004512');
    expect(snapshot.validFrom).toBe('2026-01-01'); // các trường khác của bản chụp giữ nguyên

    expect(await privileged.idempotencyKey.count({ where: { tenantId: fixture.tenantA.id } })).toBe(0);
    const setting = await privileged.tenantSetting.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, key: 'encryption_key_fingerprint' } });
    expect((setting.valueJson as { fingerprint: string }).fingerprint).toBe(keyFingerprint(NEW_KEY));
    const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'system.encryption_key_rotated' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit!.afterJson)).not.toContain(NEW_KEY);
    expect(JSON.stringify(audit!.afterJson)).not.toContain(OLD_KEY);
  });

  it('công ty KHÁC (ngoài phạm vi) không bị đụng: vẫn giải mã được bằng khoá CŨ', async () => {
    const other = await privileged.patient.findUniqueOrThrow({ where: { id: ids.patientB! } });
    expect(decryptPii(Buffer.from(other.nationalIdEnc!), OLD_KEY)).toBe('079100000222');
    expect(await privileged.tenantSetting.count({ where: { tenantId: fixture.tenantB.id, key: 'encryption_key_fingerprint' } })).toBe(0);
  });

  it('chạy lại với cùng khoá cũ sau khi đã xoay → dừng vì không đọc được (không mã hoá hỏng lần hai)', async () => {
    await expect(rotateEncryptionKey(appPrisma, { oldKey: OLD_KEY, newKey: 'khoa-moi-thu-hai-khoa-moi-thu-hai-khoa-moi-3', tenantIds: tenantAScope })).rejects.toThrow(/KHÔNG giải mã được/);
  });
});
