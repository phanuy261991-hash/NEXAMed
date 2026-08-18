import { Module } from '@nestjs/common';
import { Icd10Controller } from './icd10.controller';
import { Icd10Service } from './icd10.service';
import { Icd10Repository } from './icd10.repository';

/** Danh mục ICD-10 toàn hệ thống, read-only — S3-01 (mở khoá một phần, bổ sung dần theo chương). */
@Module({
  controllers: [Icd10Controller],
  providers: [Icd10Service, Icd10Repository],
})
export class Icd10Module {}