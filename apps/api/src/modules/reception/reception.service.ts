import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Encounter, type VitalSign } from '@prisma/client';
import {
  AppointmentNotCancellableError,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  EncounterAlreadyExistsError,
  EncounterNotCheckedInError,
  PatientAlreadyMergedError,
  evaluateVitalSignWarnings,
  getVietnamDateString,
  vietnamDayRange,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  calculateAgeYears,
  type CheckInRequest,
  type DataScope,
  type EncounterServiceItemInput,
  type EncounterSummary,
  type ReceptionListItem,
  type ReceptionListResponse,
  type RecordVitalSignRequest,
  type RegisterReceptionRequest,
  type VitalSignResponse,
  type VitalSignWarning,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { BusinessCodeService } from '../clinic/business-code.service';
import type { RequestMeta } from '../../common/request-meta';
import { AppointmentRepository } from '../appointment/appointment.repository';
import { EncounterRepository } from '../encounter/encounter.repository';
import { toEncounterSummary } from '../encounter/encounter.mapper';
import { InvoiceRepository } from '../billing/invoice.repository';
import { PatientRepository } from '../patient/patient.repository';
import { VitalSignRepository } from './vital-sign.repository';
import { EncounterServiceItemRepository, type CreateEncounterServiceItemData } from './encounter-service-item.repository';

/** "Chỉ định dịch vụ khám" (docs/DECISIONS.md #080) — map từ shape request web sang shape repository (BigInt hoá `examTypePrice`, field thiếu → `null`). */
function mapServiceItems(services: EncounterServiceItemInput[]): CreateEncounterServiceItemData[] {
  return services.map((s) => ({
    examTypeCode: s.examTypeCode,
    examTypeName: s.examTypeName,
    priceTypeCode: s.priceTypeCode ?? null,
    unitCode: s.unitCode ?? null,
    examTypePrice: s.examTypePrice !== undefined ? BigInt(s.examTypePrice) : null,
    quantity: s.quantity,
  }));
}

function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const TEMPERATURE_DECI_PER_CELSIUS = 10;

/** Chỉ số sinh hiệu tuỳ chọn nhập cùng lúc tiếp nhận — cùng shape ở cả `checkIn()`/`registerDirect()` (`intakeVitalSignFieldsSchema`, `packages/shared`). */
interface IntakeVitalSignFields {
  pulse?: number;
  temperatureC?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightGram?: number;
  heightMm?: number;
}

function hasAnyVitalSign(dto: IntakeVitalSignFields): boolean {
  return (
    dto.pulse !== undefined ||
    dto.temperatureC !== undefined ||
    dto.bpSystolic !== undefined ||
    dto.bpDiastolic !== undefined ||
    dto.respiratoryRate !== undefined ||
    dto.spo2 !== undefined ||
    dto.weightGram !== undefined ||
    dto.heightMm !== undefined
  );
}

/**
 * Điều phối use case Tiếp nhận (Sprint 3, REC-01→03) — check-in (từ lịch hẹn có sẵn), "Tiếp nhận
 * bệnh nhân" (tạo `encounter` trực tiếp, không qua `appointment` — khách đến thẳng phòng khám),
 * danh sách theo dõi trạng thái, sinh hiệu ban đầu. Đúng ranh giới `architecture.md`: module
 * `reception` KHÔNG sở hữu bảng `encounter` (đó là `encounter` module) — dùng
 * `AppointmentRepository`/`EncounterRepository` được export từ 2 module kia (xem
 * docs/DECISIONS.md quyết định kiến trúc "chia sẻ Repository giữa module trong 1 transaction").
 */
@Injectable()
export class ReceptionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly encounterRepository: EncounterRepository,
    private readonly vitalSignRepository: VitalSignRepository,
    private readonly encounterServiceItemRepository: EncounterServiceItemRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly businessCodeService: BusinessCodeService,
    private readonly patientRepository: PatientRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /**
   * "Ngừng cho tạo mới" cho hồ sơ đã gộp (S5-06, PAT-04, `.claude/docs/clinical-workflow.md` mục
   * Edge case) — gọi TRƯỚC khi tạo `encounter` ở cả `checkIn()`/`registerDirect()`. Không tồn tại
   * thì để FK violation ở bước tạo `encounter` xử lý tiếp (giữ nguyên hành vi cũ, 404 xuyên tenant).
   */
  private async assertPatientNotMerged(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<void> {
    const patient = await this.patientRepository.findById(tx, tenantId, patientId);
    if (patient?.mergedIntoId) {
      throw new PatientAlreadyMergedError();
    }
  }

  /**
   * Điều phối Bác sĩ/Khoa lúc Tiếp nhận ("Hàng đợi ảo", #064) — dùng chung cho `checkIn()` VÀ
   * `registerDirect()`. Chọn "đích danh bác sĩ" (`routing.doctorId` có giá trị): server TỰ SUY
   * `departmentId` từ hồ sơ bác sĩ đó, KHÔNG tin `departmentId` client có thể gửi kèm cho nhánh này
   * (chặn client giả mạo gán sai Khoa hiển thị) — fallback Khoa mặc định nếu bác sĩ chưa gán Khoa
   * nào (không throw, vẫn tạo được lượt khám). Chọn "theo Khoa, chưa rõ bác sĩ"
   * (`routing.doctorId` vắng mặt): `doctorId=null`, `departmentId` lấy thẳng từ client (Zod đã ép
   * bắt buộc có `departmentId` trong trường hợp này — `intakeRoutingFieldsSchema.superRefine`).
   */
  private async resolveRouting(
    tenantId: string,
    routing: { doctorId?: string; departmentId?: string },
  ): Promise<{ doctorId: string | null; departmentId: string }> {
    if (routing.doctorId) {
      const departmentId = (await this.doctorDirectory.getDoctorDepartmentId(tenantId, routing.doctorId)) ?? (await this.doctorDirectory.getDefaultDepartmentId(tenantId));
      return { doctorId: routing.doctorId, departmentId };
    }
    return { doctorId: null, departmentId: routing.departmentId! };
  }

  /**
   * `dto.patientId` đã resolve xong ở web TRƯỚC khi gọi (chọn từ danh sách trùng SĐT, tìm kiếm,
   * hoặc `POST /patients` tạo mới riêng — xem docs/DECISIONS.md). Atomic trong 1 transaction: tạo
   * `encounter` + cập nhật `appointment.status→CONVERTED` + gắn `patientId` — lỗi ở bước nào cũng
   * rollback toàn bộ (kể cả dòng `encounter` vừa tạo), không có trạng thái nửa vời.
   */
  async checkIn(tenantId: string, actorId: string, dataScope: DataScope, dto: CheckInRequest, meta: RequestMeta): Promise<EncounterSummary> {
    // `DoctorDirectoryPort` tự mở transaction RIÊNG (adapter chỉ nhận `tenantId`, không có `tx`
    // của caller) — resolve TRƯỚC khi vào transaction chính bên dưới để tránh $transaction lồng
    // nhau (đúng nguyên tắc "không dùng port cho phần cần atomic cùng check-in", docs/DECISIONS.md).
    const routing = await this.resolveRouting(tenantId, dto);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const appointment = await this.appointmentRepository.findById(tx, tenantId, dto.appointmentId);
      // Cùng triết lý 404 (không 403) khi ngoài scope personal — .claude/docs/multi-tenancy.md.
      if (!appointment || (dataScope === 'personal' && appointment.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (appointment.status !== 'SCHEDULED') {
        throw new AppointmentNotCancellableError();
      }
      await this.assertPatientNotMerged(tx, tenantId, dto.patientId);

      const created = await this.createEncounterAndConvert(tx, tenantId, actorId, {
        appointmentId: appointment.id,
        doctorId: routing.doctorId,
        departmentId: routing.departmentId,
        patientId: dto.patientId,
        appointmentVersion: dto.version,
        chiefComplaint: dto.chiefComplaint ?? appointment.reason,
        patientSourceCode: dto.patientSourceCode ?? null,
        receptionTypeCode: dto.receptionTypeCode,
        examFormCode: dto.examFormCode,
        isPriority: dto.isPriority,
        priorityReasonCode: dto.priorityReasonCode ?? null,
        allowsDeferredPayment: dto.allowsDeferredPayment,
        meta,
      });
      await this.encounterServiceItemRepository.createMany(tx, tenantId, actorId, created.id, mapServiceItems(dto.services));
      await this.createInvoiceForEncounter(tx, tenantId, actorId, created.id, meta);
      if (hasAnyVitalSign(dto)) {
        await this.createIntakeVitalSign(tx, tenantId, actorId, created.id, dto, meta);
      }
      return toEncounterSummary(created);
    });
  }

  /**
   * "Tiếp nhận bệnh nhân" (`POST /reception/direct`) — khách đến thẳng phòng khám, KHÔNG qua đặt
   * lịch trước, KHÔNG tạo/đụng `appointment`. Đơn giản hơn nhiều so với `checkIn()`: chỉ tạo
   * thẳng `encounter` với `appointmentId=null`, không có bước cập nhật `appointment` nào để rollback
   * kèm theo — 1 lệnh `create`, thất bại thì tự rollback nguyên transaction.
   */
  async registerDirect(tenantId: string, actorId: string, dto: RegisterReceptionRequest, meta: RequestMeta): Promise<EncounterSummary> {
    // Resolve routing TRƯỚC transaction chính — cùng lý do đã ghi ở checkIn().
    const routing = await this.resolveRouting(tenantId, dto);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientNotMerged(tx, tenantId, dto.patientId);

      const encounterNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'ENCOUNTER', new Date());

      let created: Encounter;
      try {
        created = await this.encounterRepository.create(tx, tenantId, actorId, {
          encounterNo,
          patientId: dto.patientId,
          doctorId: routing.doctorId,
          departmentId: routing.departmentId,
          appointmentId: null,
          checkedInAt: new Date(dto.checkedInAt),
          chiefComplaint: dto.chiefComplaint ?? null,
          // v1: chưa làm S2-04 (lưu thẻ BHYT) — luôn tự chi trả, xem docs/DECISIONS.md.
          insuranceSnapshot: { selfPay: true },
          patientSourceCode: dto.patientSourceCode ?? null,
          receptionTypeCode: dto.receptionTypeCode,
          examFormCode: dto.examFormCode,
          isPriority: dto.isPriority,
          priorityReasonCode: dto.priorityReasonCode ?? null,
          allowsDeferredPayment: dto.allowsDeferredPayment,
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          // patientId/doctorId không tồn tại/thuộc tenant khác — cùng triết lý 404 xuyên tenant.
          throw new NotFoundException();
        }
        throw err;
      }

      await this.encounterServiceItemRepository.createMany(tx, tenantId, actorId, created.id, mapServiceItems(dto.services));
      await this.createInvoiceForEncounter(tx, tenantId, actorId, created.id, meta);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.registered_direct',
        entityType: 'encounter',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (hasAnyVitalSign(dto)) {
        await this.createIntakeVitalSign(tx, tenantId, actorId, created.id, dto, meta);
      }

      return toEncounterSummary(created);
    });
  }

  /**
   * Sinh hiệu nhập CÙNG LÚC tiếp nhận (cả 2 luồng `checkIn()`/`registerDirect()`) — tuỳ chọn,
   * thiếu thì bác sĩ tự bổ sung sau ở form phiếu khám qua endpoint `recordVitalSigns()` riêng
   * (`docs/DECISIONS.md` #044). KHÔNG tính `warnings` ở đây (REC-03 chỉ áp cho endpoint bổ sung
   * sau — nhập lúc tiếp nhận không cần bước xem cảnh báo riêng, tránh làm phức tạp biểu mẫu).
   */
  private async createIntakeVitalSign(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    dto: IntakeVitalSignFields,
    meta: RequestMeta,
  ): Promise<void> {
    const created = await this.vitalSignRepository.create(tx, tenantId, actorId, {
      encounterId,
      pulse: dto.pulse ?? null,
      temperatureDeciC: dto.temperatureC !== undefined ? Math.round(dto.temperatureC * TEMPERATURE_DECI_PER_CELSIUS) : null,
      bpSystolic: dto.bpSystolic ?? null,
      bpDiastolic: dto.bpDiastolic ?? null,
      respiratoryRate: dto.respiratoryRate ?? null,
      spo2: dto.spo2 ?? null,
      weightGram: dto.weightGram ?? null,
      heightMm: dto.heightMm ?? null,
      measuredAt: new Date(),
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'vital_sign.created',
      entityType: 'vital_sign',
      entityId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Thu ngân cơ bản (Sprint 5/6, BIL-01) — tự động tạo phiếu thu ngay lúc tiếp nhận, dùng chung
   * cho cả `checkIn()`/`registerDirect()`. Đọc lại các dòng `encounter_service_item` VỪA tạo
   * (`createMany()` không trả về bản ghi) rồi giao cho `InvoiceRepository` tính tổng + snapshot
   * (`docs/DECISIONS.md` #080 — chỉ tính dòng có giá). Không tạo gì nếu không có dòng nào có giá
   * (không có gì để thu, không chặn hàng đợi khám).
   */
  private async createInvoiceForEncounter(tx: Prisma.TransactionClient, tenantId: string, actorId: string, encounterId: string, meta: RequestMeta): Promise<void> {
    const serviceItems = await this.encounterServiceItemRepository.findByEncounterId(tx, tenantId, encounterId);
    const invoice = await this.invoiceRepository.createFromServiceItems(tx, tenantId, actorId, encounterId, serviceItems);
    if (!invoice) {
      return;
    }
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      afterJson: { invoiceNo: invoice.invoiceNo, totalAmount: invoice.totalAmount.toString() },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Phần dùng chung giữa `checkIn()` (từ lịch hẹn có sẵn) và `walkIn()` (vừa tạo lịch xong) — tạo
   * `encounter` rồi chuyển `appointment` sang `CONVERTED`, ghi 2 dòng audit. Cả hai caller đều đã
   * mở transaction riêng và biết chắc `appointment` đang `SCHEDULED` (walkIn: vừa tạo, luôn đúng;
   * checkIn: đã kiểm tra trước khi gọi).
   */
  private async createEncounterAndConvert(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: {
      appointmentId: string;
      doctorId: string | null;
      departmentId: string;
      patientId: string;
      appointmentVersion: number;
      chiefComplaint: string | null;
      patientSourceCode: string | null;
      receptionTypeCode: string;
      examFormCode: string;
      isPriority: boolean;
      priorityReasonCode: string | null;
      allowsDeferredPayment: boolean;
      meta: RequestMeta;
    },
  ): Promise<Encounter> {
    const encounterNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'ENCOUNTER', new Date());

    let created: Encounter;
    try {
      created = await this.encounterRepository.create(tx, tenantId, actorId, {
        encounterNo,
        patientId: params.patientId,
        doctorId: params.doctorId,
        departmentId: params.departmentId,
        appointmentId: params.appointmentId,
        checkedInAt: new Date(),
        chiefComplaint: params.chiefComplaint,
        // v1: chưa làm S2-04 (lưu thẻ BHYT) — luôn tự chi trả, xem docs/DECISIONS.md.
        insuranceSnapshot: { selfPay: true },
        patientSourceCode: params.patientSourceCode,
        // Trước đây bị BỎ SÓT (bug phát hiện thật lúc chạm lại hàm này cho #064) — checkIn() từ
        // lịch hẹn có sẵn không lưu 4 trường "Thông tin tiếp nhận" dù registerDirect() (Tiếp nhận
        // trực tiếp) đã lưu đúng từ #052. Sửa cùng lúc. "Chỉ định dịch vụ khám" tách riêng thành
        // encounter_service_item, tạo ở caller sau khi có created.id (docs/DECISIONS.md #080).
        receptionTypeCode: params.receptionTypeCode,
        examFormCode: params.examFormCode,
        isPriority: params.isPriority,
        priorityReasonCode: params.priorityReasonCode,
        allowsDeferredPayment: params.allowsDeferredPayment,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new EncounterAlreadyExistsError();
      }
      if (isForeignKeyViolation(err)) {
        // patientId không tồn tại/thuộc tenant khác — cùng triết lý 404 xuyên tenant.
        throw new NotFoundException();
      }
      throw err;
    }

    const checkinCount = await this.appointmentRepository.checkin(
      tx,
      tenantId,
      params.appointmentId,
      params.patientId,
      params.appointmentVersion,
      actorId,
    );
    if (checkinCount === 0) {
      // Ném lỗi ở đây rollback CẢ transaction (Prisma $transaction) — dòng encounter vừa tạo ở
      // trên cũng bị huỷ theo, không để lại encounter mồ côi khi appointment version lệch.
      throw new ConcurrentModificationError();
    }

    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'appointment.checked_in',
      entityType: 'appointment',
      entityId: params.appointmentId,
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'encounter.checked_in',
      entityType: 'encounter',
      entityId: created.id,
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });

    return created;
  }

  /**
   * Danh sách Tiếp nhận — CHỈ encounter (đã có mặt), theo dõi trạng thái trong ngày (`date`, mặc
   * định "hôm nay" giờ Việt Nam). KHÔNG gồm lịch hẹn `SCHEDULED` chưa check-in — xem
   * `packages/shared/src/encounter.ts` (`receptionListItemSchema`). `doctorIdFilter` — trang
   * "Hàng đợi khám" lọc theo 1 bác sĩ cụ thể; chỉ áp dụng khi scope `global` (scope `personal`
   * luôn tự ép về chính actor, bỏ qua tham số này — bác sĩ không thể lọc xem người khác).
   * `includeDepartmentPool` ("Hàng đợi ảo", #064) — cờ TƯỜNG MINH do client gửi: khi `true` VÀ có
   * `doctorId` hiệu lực, gộp thêm "hàng chờ chung Khoa của doctorId đó" vào cùng kết quả. Mặc định
   * `false` — "Danh sách tiếp nhận" (lễ tân, không truyền cờ này) giữ nguyên hành vi cũ tuyệt đối.
   */
  async listReceptions(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    date?: string,
    doctorIdFilter?: string,
    includeDepartmentPool?: boolean,
    queueView?: boolean,
  ): Promise<ReceptionListResponse> {
    const targetDate = date ?? getVietnamDateString();
    const dayRange = vietnamDayRange(targetDate);
    const doctorId = dataScope === 'personal' ? actorId : doctorIdFilter;

    // Resolve TRƯỚC transaction chính — cùng lý do đã ghi ở checkIn()/registerDirect() (port tự mở
    // transaction riêng, tránh $transaction lồng nhau).
    const poolDepartmentId =
      includeDepartmentPool && doctorId ? ((await this.doctorDirectory.getDoctorDepartmentId(tenantId, doctorId)) ?? undefined) : undefined;

    const encounters = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.encounterRepository.listForDay(tx, tenantId, {
        dayStart: dayRange.startUtc,
        dayEnd: dayRange.endUtc,
        doctorId,
        poolDepartmentId,
        requirePaymentCleared: queueView,
      }),
    );

    // Resolve tên "Người tiếp nhận" SAU transaction đọc chính — `DoctorDirectoryPort` tự mở
    // transaction riêng (cùng nguyên tắc đã áp dụng cho routing ở checkIn()/registerDirect()).
    const receivedByNames = await this.doctorDirectory.getUserFullNames(tenantId, encounters.map((e) => e.createdBy));

    const items: ReceptionListItem[] = encounters.map((e) => ({
      encounterId: e.id,
      encounterNo: e.encounterNo,
      appointmentId: e.appointmentId,
      patientId: e.patientId,
      patientCode: e.patient.patientCode,
      fullName: e.patient.fullName,
      phone: e.patient.phone,
      doctorId: e.doctorId,
      departmentId: e.departmentId,
      isPriority: e.isPriority,
      chiefComplaint: e.chiefComplaint,
      receivedByName: receivedByNames.get(e.createdBy) ?? null,
      status: e.status,
      checkedInAt: e.checkedInAt.toISOString(),
      startedAt: e.startedAt?.toISOString() ?? null,
      completedAt: e.completedAt?.toISOString() ?? null,
      version: e.version,
    }));

    return { items };
  }

  /**
   * REC-02/03 — luôn cho lưu (kể cả không chỉ số nào trong ngưỡng), `warnings` chỉ để hiển thị
   * cảnh báo phía web, không bao giờ chặn. `temperatureC` (độ C thập phân, web-facing) quy đổi
   * sang `temperature_deci_c` (DB) ở đây — xem `packages/shared/src/encounter.ts`.
   */
  async recordVitalSigns(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    encounterId: string,
    dto: RecordVitalSignRequest,
    meta: RequestMeta,
  ): Promise<VitalSignResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findByIdWithPatientDob(tx, tenantId, encounterId);
      if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (encounter.status !== 'CHECKED_IN' && encounter.status !== 'IN_CONSULTATION') {
        throw new EncounterNotCheckedInError();
      }

      const temperatureDeciC = dto.temperatureC !== undefined ? Math.round(dto.temperatureC * TEMPERATURE_DECI_PER_CELSIUS) : null;
      const measuredAt = new Date();

      const created: VitalSign = await this.vitalSignRepository.create(tx, tenantId, actorId, {
        encounterId,
        pulse: dto.pulse ?? null,
        temperatureDeciC,
        bpSystolic: dto.bpSystolic ?? null,
        bpDiastolic: dto.bpDiastolic ?? null,
        respiratoryRate: dto.respiratoryRate ?? null,
        spo2: dto.spo2 ?? null,
        weightGram: dto.weightGram ?? null,
        heightMm: dto.heightMm ?? null,
        measuredAt,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'vital_sign.created',
        entityType: 'vital_sign',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const ageYears = calculateAgeYears(encounter.patient.dob.toISOString().slice(0, 10), measuredAt);
      const warnings = evaluateVitalSignWarnings(
        {
          pulse: dto.pulse,
          temperatureC: dto.temperatureC,
          bpSystolic: dto.bpSystolic,
          bpDiastolic: dto.bpDiastolic,
          respiratoryRate: dto.respiratoryRate,
          spo2: dto.spo2,
          weightGram: dto.weightGram,
          heightMm: dto.heightMm,
        },
        ageYears,
      );

      return this.toVitalSignResponse(created, warnings);
    });
  }

  private toVitalSignResponse(vitalSign: VitalSign, warnings: VitalSignWarning[]): VitalSignResponse {
    return {
      id: vitalSign.id,
      encounterId: vitalSign.encounterId,
      pulse: vitalSign.pulse,
      temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : null,
      bpSystolic: vitalSign.bpSystolic,
      bpDiastolic: vitalSign.bpDiastolic,
      respiratoryRate: vitalSign.respiratoryRate,
      spo2: vitalSign.spo2,
      weightGram: vitalSign.weightGram,
      heightMm: vitalSign.heightMm,
      measuredAt: vitalSign.measuredAt.toISOString(),
      warnings,
    };
  }
}