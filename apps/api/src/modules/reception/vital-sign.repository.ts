import { Injectable } from '@nestjs/common';
import type { Prisma, VitalSign } from '@prisma/client';

export interface CreateVitalSignData {
  encounterId: string;
  pulse: number | null;
  temperatureDeciC: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  weightGram: number | null;
  heightMm: number | null;
  measuredAt: Date;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `vital_sign` — module `reception` sở hữu hẳn bảng này (khác
 * `encounter`, chia sẻ qua `EncounterRepository`), đúng `architecture.md`: "reception = tạo
 * encounter + sinh hiệu ban đầu".
 */
@Injectable()
export class VitalSignRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateVitalSignData): Promise<VitalSign> {
    return tx.vitalSign.create({
      data: {
        tenantId,
        encounterId: data.encounterId,
        pulse: data.pulse,
        temperatureDeciC: data.temperatureDeciC,
        bpSystolic: data.bpSystolic,
        bpDiastolic: data.bpDiastolic,
        respiratoryRate: data.respiratoryRate,
        spo2: data.spo2,
        weightGram: data.weightGram,
        heightMm: data.heightMm,
        measuredAt: data.measuredAt,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }
}
