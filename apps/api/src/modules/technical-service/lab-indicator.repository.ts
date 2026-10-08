import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LabIndicator, LabIndicatorReference } from '@prisma/client';

export interface CreateLabIndicatorData {
  code: string;
  name: string;
  abbreviation: string | null;
  unit: string | null;
  valueType: 'NUMBER' | 'TEXT' | 'CHOICE';
  decimals: number | null;
  choiceOptions: string[] | null;
  isActive: boolean;
  sortOrder: number;
}

export type UpdateLabIndicatorData = Partial<Omit<CreateLabIndicatorData, 'code'>>;

export interface CreateReferenceData {
  sex: 'ANY' | 'MALE' | 'FEMALE';
  ageFromYears: number;
  ageToYears: number | null;
  lowValue: number | null;
  highValue: number | null;
  lowInclusive: boolean;
  highInclusive: boolean;
  normalText: string | null;
  displayText: string | null;
  note: string | null;
  sortOrder: number;
}

export interface LabIndicatorRow extends LabIndicator {
  _count: { references: number; services: number };
}

const COUNT_SELECT = {
  _count: { select: { references: { where: { deletedAt: null } }, services: { where: { deletedAt: null } } } },
} as const;

/** Chỗ DUY NHẤT gọi Prisma cho `lab_indicator` + `lab_indicator_reference` (Cận lâm sàng GĐ1, #212). */
@Injectable()
export class LabIndicatorRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateLabIndicatorData): Promise<LabIndicator> {
    return tx.labIndicator.create({ data: { tenantId, ...data, choiceOptions: data.choiceOptions ?? undefined, createdBy: actorId, updatedBy: actorId } });
  }

  findRowById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<LabIndicatorRow | null> {
    return tx.labIndicator.findFirst({ where: { tenantId, id, deletedAt: null }, include: COUNT_SELECT });
  }

  async findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<LabIndicator[]> {
    if (ids.length === 0) return [];
    return tx.labIndicator.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string, filter: { search?: string; includeInactive: boolean }): Promise<LabIndicatorRow[]> {
    return tx.labIndicator.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.includeInactive ? {} : { isActive: true }),
        ...(filter.search
          ? {
              OR: [
                { code: { contains: filter.search, mode: 'insensitive' } },
                { name: { contains: filter.search, mode: 'insensitive' } },
                { abbreviation: { contains: filter.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: COUNT_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateLabIndicatorData,
  ): Promise<number> {
    const { choiceOptions, ...rest } = data;
    const result = await tx.labIndicator.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: {
        ...rest,
        ...(choiceOptions === undefined ? {} : { choiceOptions: choiceOptions === null ? Prisma.JsonNull : choiceOptions }),
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  listReferences(tx: Prisma.TransactionClient, tenantId: string, indicatorId: string): Promise<LabIndicatorReference[]> {
    return tx.labIndicatorReference.findMany({
      where: { tenantId, indicatorId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async replaceReferences(tx: Prisma.TransactionClient, tenantId: string, indicatorId: string, actorId: string, items: CreateReferenceData[]): Promise<void> {
    await tx.labIndicatorReference.updateMany({
      where: { tenantId, indicatorId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.labIndicatorReference.createMany({
        data: items.map((item) => ({ tenantId, indicatorId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}

