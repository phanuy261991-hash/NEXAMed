import { Controller, Get } from '@nestjs/common';
import { SystemVersionService } from './system-version.service';

/**
 * `GET /api/v1/system/version` — phiên bản phần mềm đang chạy (docs/DECISIONS.md #236). CÔNG KHAI (không `JwtAuthGuard`) như `/health`: trang đăng nhập hiện số phiên bản để khách báo lỗi
 * đúng bản, và web dùng nó phát hiện máy chủ vừa được cập nhật. Chỉ trả thông tin phiên bản — không cấu hình, không địa chỉ máy chủ, không dữ liệu của công ty nào.
 */
@Controller('system')
export class SystemController {
  constructor(private readonly versionService: SystemVersionService) {}

  @Get('version')
  async version() {
    return this.versionService.getVersion();
  }
}
