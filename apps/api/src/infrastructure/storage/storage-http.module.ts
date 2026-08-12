import { Module } from '@nestjs/common';
import { PublicFileController } from './public-file.controller';

/** Bề mặt HTTP công khai của StoragePort (đọc file qua signed URL) — tách khỏi `PortsModule`
 * (module đó chỉ đăng ký provider/adapter, không có controller). `STORAGE_PORT` đã `@Global()`
 * qua `PortsModule` nên không cần khai `imports` ở đây. */
@Module({
  controllers: [PublicFileController],
})
export class StorageHttpModule {}
