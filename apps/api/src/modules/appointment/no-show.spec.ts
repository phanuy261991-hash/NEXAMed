import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { ClinicConfigReaderPort } from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AppointmentRepository } from './appointment.repository';
import { markNoShowForAllTenants } from './no-show';

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

/**
 * Integration test thật trên Postgres cục bộ (cùng pattern `system-log-purge.spec.ts`) cho hàm
 * thuần `markNoShowForAllTenants` (S5-07, APP-05). Dùng `ClinicConfigReaderPort` GIẢ (không phải
 * `ClinicSettingsService` thật) để tách bạch: test này CHỈ kiểm logic job (chọn đúng lịch quá hạn,
 * đánh dấu đúng, ghi audit_log, bỏ qua tenant tắt) — round-trip lưu cấu hình thật đã có
 * `clinic-http.spec.ts` riêng. QUAN TRỌNG: `markNoShowForAllTenants` lặp qua MỌI tenant trong DB
 * test dùng chung (không chỉ tenant của spec này) — reader giả PHẢI mặc định `enabled: false` cho
 * mọi tenant không nằm trong danh sách chỉ định, tránh đụng dữ liệu của spec khác chạy chung DB.
 */
describe('markNoShowForAllTenants — S5-07, APP-05', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const appointmentRepository = new AppointmentRepository();

  let tenantId: string;
  let disabledTenantId: string;
  let doctorId: string;
  let disabledTenantDoctorId: string;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();

    const [tenant, disabledTenant] = await Promise.all([
      privileged.tenant.create({ data: { name: `No-show job ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } }),
      privileged.tenant.create({ data: { name: `No-show job tắt ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } }),
    ]);
    tenantId = tenant.id;
    disabledTenantId = disabledTenant.id;

    // FK (tenant_id, doctor_id) composite — mỗi tenant cần bác sĩ riêng, không dùng chung 1 doctorId.
    const [doctor, disabledTenantDoctor] = await Promise.all([
      privileged.userAccount.create({
        data: { tenantId, username: `no-show-doctor-${randomUUID()}`, passwordHash: 'x', fullName: 'BS Kiểm thử', createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
      }),
      privileged.userAccount.create({
        data: {
          tenantId: disabledTenantId,
          username: `no-show-doctor-${randomUUID()}`,
          passwordHash: 'x',
          fullName: 'BS Kiểm thử (tenant tắt)',
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        },
      }),
    ]);
    doctorId = doctor.id;
    disabledTenantDoctorId = disabledTenantDoctor.id;
  });

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId: { in: [tenantId, disabledTenantId] } } });
    await privileged.appointment.deleteMany({ where: { tenantId: { in: [tenantId, disabledTenantId] } } });
    await privileged.userAccount.deleteMany({ where: { tenantId: { in: [tenantId, disabledTenantId] } } });
    await privileged.tenant.deleteMany({ where: { id: { in: [tenantId, disabledTenantId] } } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  function minutesAgo(minutes: number): Date {
    return new Date(Date.now() - minutes * 60_000);
  }

  function createAppointment(targetTenantId: string, targetDoctorId: string, scheduledAt: Date, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') {
    return privileged.appointment.create({
      data: {
        tenantId: targetTenantId,
        doctorId: targetDoctorId,
        bookingCode: `LH-TEST-${randomUUID().slice(0, 8)}`,
        fullName: 'Khách kiểm thử',
        phone: '0900000000',
        scheduledAt,
        durationMinutes: 15,
        status,
        source: 'phone',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
  }

  /** Reader giả — CHỈ tenant có trong `overrides` mới bật, mọi tenant khác (kể cả của spec khác chạy chung DB) mặc định tắt. */
  function fakeReader(overrides: Record<string, { enabled: boolean; thresholdMinutes: number }>): ClinicConfigReaderPort {
    return {
      getScheduleConfig: () => Promise.reject(new Error('không dùng trong test này')),
      getTodayDoctorRoomAssignments: () => Promise.reject(new Error('không dùng trong test này')),
      getDeferredPaymentEnabled: () => Promise.reject(new Error('không dùng trong test này')),
      getNoShowConfig: (tid: string) => Promise.resolve(overrides[tid] ?? { enabled: false, thresholdMinutes: 60 }),
      getDoctorAvailabilityPolicy: () => Promise.reject(new Error('không dùng trong test này')),
      getBlockBookingOutsideWorkShiftEnabled: () => Promise.reject(new Error('không dùng trong test này')),
      getAllowStaffSelfScheduleEnabled: () => Promise.reject(new Error('không dùng trong test này')),
      getWorkShiftAssignmentLockGraceDays: () => Promise.reject(new Error('không dùng trong test này')),
      getCashierShiftMultiCashierEnabled: () => Promise.reject(new Error('không dùng trong test này')),
    };
  }

  it('tenant BẬT: lịch SCHEDULED quá ngưỡng → NO_SHOW + ghi audit_log; chưa quá ngưỡng và không phải SCHEDULED thì giữ nguyên', async () => {
    const overdue = await createAppointment(tenantId, doctorId, minutesAgo(45));
    const notYetDue = await createAppointment(tenantId, doctorId, minutesAgo(10));
    const alreadyCancelled = await createAppointment(tenantId, doctorId, minutesAgo(60), 'CANCELLED');

    const marked = await markNoShowForAllTenants(appPrisma, unitOfWork, appointmentRepository, fakeReader({ [tenantId]: { enabled: true, thresholdMinutes: 30 } }));
    expect(marked).toBeGreaterThanOrEqual(1);

    const [overdueAfter, notYetDueAfter, cancelledAfter] = await Promise.all([
      privileged.appointment.findUniqueOrThrow({ where: { id: overdue.id } }),
      privileged.appointment.findUniqueOrThrow({ where: { id: notYetDue.id } }),
      privileged.appointment.findUniqueOrThrow({ where: { id: alreadyCancelled.id } }),
    ]);
    expect(overdueAfter.status).toBe('NO_SHOW');
    expect(notYetDueAfter.status).toBe('SCHEDULED');
    expect(cancelledAfter.status).toBe('CANCELLED');

    const auditRows = await privileged.auditLog.findMany({ where: { tenantId, entityId: overdue.id, action: 'appointment.no_show' } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(SYSTEM_ACTOR);
  });

  it('tenant TẮT: lịch SCHEDULED quá ngưỡng vẫn giữ nguyên, không tự động đánh dấu', async () => {
    const overdue = await createAppointment(disabledTenantId, disabledTenantDoctorId, minutesAgo(9999));

    await markNoShowForAllTenants(appPrisma, unitOfWork, appointmentRepository, fakeReader({ [tenantId]: { enabled: true, thresholdMinutes: 30 } }));

    const after = await privileged.appointment.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(after.status).toBe('SCHEDULED');
  });
});
