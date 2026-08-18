import { z } from 'zod';

/**
 * Danh mục ICD-10 toàn hệ thống (S3-01, mở khoá một phần — bổ sung dần theo chương) — read-only lúc
 * chạy, giống `province`/`ward` (không có endpoint create/update/delete, không `tenant_id`,
 * không `version`). Dùng cho trang tra cứu "Danh mục Chuyên môn" và sau này cho bộ chọn chẩn đoán
 * ở màn khám (S3-06/07, chưa xây). Xem `.claude/docs/data-model.md` mục `icd10_catalog`.
 */
export const icd10GenderRestrictionSchema = z.enum(['male', 'female']);
export const icd10UsageRestrictionSchema = z.enum(['limited_primary', 'not_primary']);

export const icd10CodeItemSchema = z.object({
  code: z.string(),
  nameVi: z.string(),
  nameEn: z.string().nullable(),
  chapterCode: z.string(),
  chapterName: z.string(),
  blockCode: z.string(),
  blockName: z.string(),
  groupCode: z.string(),
  groupName: z.string(),
  isBillable: z.boolean(),
  genderRestriction: icd10GenderRestrictionSchema.nullable(),
  usageRestriction: icd10UsageRestrictionSchema.nullable(),
  whoNote: z.string().nullable(),
});
export type Icd10CodeItem = z.infer<typeof icd10CodeItemSchema>;

export const icd10ChapterSchema = z.object({
  chapterCode: z.string(),
  chapterName: z.string(),
});
export type Icd10Chapter = z.infer<typeof icd10ChapterSchema>;

/** `blockCode`/`blockName` đi kèm để frontend hiện Khối làm tiêu đề phụ trong cột Nhóm (cascade 3 cột). */
export const icd10GroupSchema = z.object({
  groupCode: z.string(),
  groupName: z.string(),
  blockCode: z.string(),
  blockName: z.string(),
});
export type Icd10Group = z.infer<typeof icd10GroupSchema>;

export const listIcd10ChaptersResponseSchema = z.object({ items: z.array(icd10ChapterSchema) });
export type ListIcd10ChaptersResponse = z.infer<typeof listIcd10ChaptersResponseSchema>;

export const listIcd10GroupsQuerySchema = z.object({ chapterCode: z.string().min(1) });
export type ListIcd10GroupsQuery = z.infer<typeof listIcd10GroupsQuerySchema>;
export const listIcd10GroupsResponseSchema = z.object({ items: z.array(icd10GroupSchema) });
export type ListIcd10GroupsResponse = z.infer<typeof listIcd10GroupsResponseSchema>;

export const listIcd10CodesQuerySchema = z.object({ groupCode: z.string().min(1) });
export type ListIcd10CodesQuery = z.infer<typeof listIcd10CodesQuerySchema>;
export const listIcd10CodesResponseSchema = z.object({ items: z.array(icd10CodeItemSchema) });
export type ListIcd10CodesResponse = z.infer<typeof listIcd10CodesResponseSchema>;

export const searchIcd10QuerySchema = z.object({ q: z.string().min(1) });
export type SearchIcd10Query = z.infer<typeof searchIcd10QuerySchema>;
export const searchIcd10ResponseSchema = z.object({ items: z.array(icd10CodeItemSchema) });
export type SearchIcd10Response = z.infer<typeof searchIcd10ResponseSchema>;