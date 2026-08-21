import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedIcd10Catalog } from '../src/infrastructure/persistence/seed-icd10';
import { EncounterRepository } from '../src/modules/encounter/encounter.repository';
import { DiagnosisRepository } from '../src/modules/encounter/diagnosis.repository';
import { ClinicalNoteRepository } from '../src/modules/encounter/clinical-note.repository';

/**
 * Đo hiệu năng màn hình khám (S3-09, ENC-01: "tải màn hình khám có đủ tiền sử dưới 2 giây" —
 * docs/product/prd.md mục 5, gate cuối Sprint 3 ở docs/product/plan.md mục 6). Script thủ công,
 * KHÔNG chạy trong `pnpm test`/CI — cùng lý do/khuôn `perf-patient-search.ts` (S2-02): seed dữ
 * liệu tốn thời gian, không phù hợp vòng lặp test nhanh.
 *
 * Đo đúng 4 truy vấn tuần tự mà `EncounterService.getConsultationDetail()` (S3-05) thực hiện
 * trong CÙNG một transaction — gọi thẳng 3 repository (không có dependency ngoài `tx`, xem
 * `encounter.repository.ts`/`diagnosis.repository.ts`/`clinical-note.repository.ts`), qua đúng
 * role app (DATABASE_URL) + `SET LOCAL app.current_tenant_id`, giống hệt
 * `UnitOfWorkService.runInTenantScope()` lúc chạy thật — không đo qua role đặc quyền.
 *
 * Dùng: pnpm --filter @nexamed/api run perf:consultation
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const PATIENT_HISTORY_COUNT = 20; // PRD mục 5 / plan.md S3-09: "bệnh nhân có 20 lần khám cũ"
const PERF_TARGET_MS = 2000;
const PERF_TENANT_PREFIX = 'Perf consultation ';
const NOTE_SECTIONS = [
  'REASON_FOR_VISIT',
  'ILLNESS_PROGRESS',
  'PRELIMINARY_DIAGNOSIS',
  'GENERAL_EXAM',
  'REGIONAL_EXAM',
  'PLAN',
] as const;

async function main() {
  const privileged = new PrismaClient({
    datasources: { db: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL } },
  });
  const appDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const encounterRepository = new EncounterRepository();
  const diagnosisRepository = new DiagnosisRepository();
  const clinicalNoteRepository = new ClinicalNoteRepository();

  try {
    await privileged.$connect();
    await appDb.$connect();

    // icd10_catalog bị REVOKE INSERT khỏi role app (S3-01) — seed qua role đặc quyền, idempotent
    // (createMany skipDuplicates), cùng cách encounter-http.spec.ts tự seed cho riêng file test.
    console.log('Seed danh mục ICD-10 (idempotent, bỏ qua nếu đã có)...');
    await seedIcd10Catalog(privileged);

    const tenant = await privileged.tenant.create({
      data: { name: `${PERF_TENANT_PREFIX}${randomUUID().slice(0, 8)}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    console.log(`Tenant tạm: ${tenant.id}`);

    const passwordHash = await argon2.hash('Perf@12345', { type: argon2.argon2id });
    const doctor = await privileged.userAccount.create({
      data: {
        tenantId: tenant.id,
        username: `perf.doctor.${randomUUID().slice(0, 8)}`,
        passwordHash,
        fullName: 'Bác sĩ Perf Test',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    const patient = await privileged.patient.create({
      data: {
        tenantId: tenant.id,
        patientCode: `PFC${Date.now()}`,
        fullName: 'Bệnh nhân Perf Test 20 lần khám',
        dob: new Date('1980-06-15'),
        gender: 'male',
        phone: '0900000000',
        allergyNote: 'Dị ứng Penicillin',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    console.log(`Đang tạo ${PATIENT_HISTORY_COUNT} lượt khám cũ (COMPLETED, kèm chẩn đoán + ghi chú lâm sàng) cho bệnh nhân...`);
    for (let i = 0; i < PATIENT_HISTORY_COUNT; i++) {
      const checkedInAt = new Date(Date.now() - (PATIENT_HISTORY_COUNT - i) * 24 * 60 * 60 * 1000);
      const historyEncounter = await privileged.encounter.create({
        data: {
          tenantId: tenant.id,
          patientId: patient.id,
          doctorId: doctor.id,
          encounterNo: `PFCENC${Date.now()}${i}`,
          status: 'COMPLETED',
          checkedInAt,
          startedAt: checkedInAt,
          completedAt: checkedInAt,
          chiefComplaint: `Tái khám lần ${i + 1} — sốt, ho`,
          insuranceSnapshot: { selfPay: true },
          examTypeCode: 'KT',
          examTypeName: 'Khám thường',
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        },
      });
      await privileged.diagnosis.create({
        data: {
          tenantId: tenant.id,
          encounterId: historyEncounter.id,
          icd10Code: 'A00.0',
          type: 'PRIMARY',
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        },
      });
      await privileged.clinicalNote.createMany({
        data: NOTE_SECTIONS.map((section) => ({
          tenantId: tenant.id,
          encounterId: historyEncounter.id,
          section,
          content: `Nội dung ${section} lần khám ${i + 1}`,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        })),
      });
    }
    console.log('Xong 20 lượt khám cũ.');

    // Lượt khám đang mở màn hình khám — trạng thái thật khi bác sĩ vừa "Bắt đầu khám", trước khi
    // điền gì (đúng ca đo "tải màn hình khám" của ENC-01, không phải sau khi đã lưu dữ liệu).
    const currentEncounter = await privileged.encounter.create({
      data: {
        tenantId: tenant.id,
        patientId: patient.id,
        doctorId: doctor.id,
        encounterNo: `PFCENCCUR${Date.now()}`,
        status: 'IN_CONSULTATION',
        checkedInAt: new Date(),
        startedAt: new Date(),
        chiefComplaint: 'Đau đầu, chóng mặt',
        insuranceSnapshot: { selfPay: true },
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    await privileged.vitalSign.create({
      data: {
        tenantId: tenant.id,
        encounterId: currentEncounter.id,
        pulse: 82,
        temperatureDeciC: 372,
        bpSystolic: 120,
        bpDiastolic: 80,
        respiratoryRate: 18,
        spo2: 98,
        weightGram: 65_000,
        heightMm: 1_700,
        measuredAt: new Date(),
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    console.log('\nĐo GET /encounters/:id/consultation (4 truy vấn tuần tự trong 1 transaction, qua role app + RLS)...\n');

    const timings = await appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenant.id}'`);

      const t0 = Date.now();
      const encounter = await encounterRepository.findByIdWithConsultationContext(tx, tenant.id, currentEncounter.id);
      const t1 = Date.now();
      if (!encounter) {
        throw new Error('Không tìm thấy encounter vừa tạo — có lỗi logic seed.');
      }

      const history = await encounterRepository.listHistoryForPatient(tx, tenant.id, patient.id, currentEncounter.id, PATIENT_HISTORY_COUNT);
      const t2 = Date.now();
      if (history.length !== PATIENT_HISTORY_COUNT) {
        throw new Error(`Tiền sử trả về ${history.length} dòng, kỳ vọng ${PATIENT_HISTORY_COUNT} — có lỗi logic seed/truy vấn.`);
      }

      await diagnosisRepository.listForEncounter(tx, tenant.id, currentEncounter.id);
      const t3 = Date.now();

      await clinicalNoteRepository.listForEncounter(tx, tenant.id, currentEncounter.id);
      const t4 = Date.now();

      return {
        encounterWithContext: t1 - t0,
        history: t2 - t1,
        diagnoses: t3 - t2,
        clinicalNote: t4 - t3,
        total: t4 - t0,
      };
    });

    console.log(`  1. findByIdWithConsultationContext (encounter + bệnh nhân + sinh hiệu mới nhất): ${timings.encounterWithContext}ms`);
    console.log(`  2. listHistoryForPatient (${PATIENT_HISTORY_COUNT} lần khám cũ + tên chẩn đoán):      ${timings.history}ms`);
    console.log(`  3. diagnosisRepository.listForEncounter (lượt khám hiện tại):        ${timings.diagnoses}ms`);
    console.log(`  4. clinicalNoteRepository.listForEncounter (lượt khám hiện tại):     ${timings.clinicalNote}ms`);
    console.log(`  Tổng (đúng thời gian getConsultationDetail() bỏ qua guard/serialize): ${timings.total}ms`);

    const verdict = timings.total < PERF_TARGET_MS ? `ĐẠT (< ${PERF_TARGET_MS}ms)` : `KHÔNG ĐẠT (>= ${PERF_TARGET_MS}ms)`;
    console.log(`\nKết quả: ${timings.total}ms — ${verdict}`);
    if (timings.total >= PERF_TARGET_MS) {
      throw new Error(`Màn hình khám vượt ngưỡng ${PERF_TARGET_MS}ms (ENC-01, gate cuối Sprint 3) — cần xem lại index/truy vấn.`);
    }
  } finally {
    console.log('\nDọn dữ liệu perf test...');
    const tenants = await privileged.tenant.findMany({ where: { name: { startsWith: PERF_TENANT_PREFIX } } });
    const tenantIds = tenants.map((t) => t.id);
    if (tenantIds.length > 0) {
      await privileged.vitalSign.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.diagnosis.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.clinicalNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.encounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.userAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await privileged.$disconnect();
    await appDb.$disconnect();
    console.log('Xong.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});