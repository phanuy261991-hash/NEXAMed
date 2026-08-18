import { Injectable } from '@nestjs/common';
import { romanToInt, stripVietnameseDiacritics } from '@nexamed/core';
import type {
  Icd10CodeItem,
  ListIcd10ChaptersResponse,
  ListIcd10CodesResponse,
  ListIcd10GroupsResponse,
  SearchIcd10Response,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { Icd10Repository } from './icd10.repository';

/**
 * Danh mục ICD-10 toàn hệ thống (S3-01, mở khoá một phần) — read-only, không `tenant_id`. Không
 * có thao tác ghi nào (không audit) — khác `reference_catalog`, giống `geo`.
 */
@Injectable()
export class Icd10Service {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly icd10Repository: Icd10Repository,
  ) {}

  async listChapters(tenantId: string): Promise<ListIcd10ChaptersResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.icd10Repository.listChapters(tx);
      // `chapterCode` là số La Mã ("I".."XXII") — KHÔNG được sắp theo thứ tự chuỗi ở DB
      // ("IX" < "V" theo alphabet, sai thứ tự thật), phải quy đổi rồi sắp lại ở tầng ứng dụng.
      const sorted = [...rows].sort((a, b) => romanToInt(a.chapterCode) - romanToInt(b.chapterCode));
      return { items: sorted };
    });
  }

  async listGroups(tenantId: string, chapterCode: string): Promise<ListIcd10GroupsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.icd10Repository.listGroups(tx, chapterCode);
      return { items: rows };
    });
  }

  async listCodes(tenantId: string, groupCode: string): Promise<ListIcd10CodesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.icd10Repository.listCodes(tx, groupCode);
      return { items: rows.map(toCodeItem) };
    });
  }

  async search(tenantId: string, q: string): Promise<SearchIcd10Response> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.icd10Repository.search(tx, { raw: q, normalized: stripVietnameseDiacritics(q) });
      return { items: rows.map(toCodeItem) };
    });
  }
}

function toCodeItem(row: {
  code: string;
  nameVi: string;
  nameEn: string | null;
  chapterCode: string;
  chapterName: string;
  blockCode: string;
  blockName: string;
  groupCode: string;
  groupName: string;
  isBillable: boolean;
  genderRestriction: string | null;
  usageRestriction: string | null;
  whoNote: string | null;
}): Icd10CodeItem {
  return {
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    chapterCode: row.chapterCode,
    chapterName: row.chapterName,
    blockCode: row.blockCode,
    blockName: row.blockName,
    groupCode: row.groupCode,
    groupName: row.groupName,
    isBillable: row.isBillable,
    genderRestriction: row.genderRestriction as Icd10CodeItem['genderRestriction'],
    usageRestriction: row.usageRestriction as Icd10CodeItem['usageRestriction'],
    whoNote: row.whoNote,
  };
}