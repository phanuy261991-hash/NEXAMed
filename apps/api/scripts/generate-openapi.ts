import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Bắt buộc trước khi dùng `request.params`/`request.query` — zod-to-openapi cần `.openapi()`
// (patch vào ZodType.prototype) để tự sinh định nghĩa parameter từ field của z.object thường.
extendZodWithOpenApi(z);
import {
  breakGlassRequestSchema,
  breakGlassResponseSchema,
  createPatientRequestSchema,
  listPatientsQuerySchema,
  listPatientsResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  patientDetailSchema,
  refreshResponseSchema,
  updatePatientRequestSchema,
} from '@nexamed/shared';

/**
 * Sinh `openapi/openapi.json` từ chính các Zod schema dùng chung ở `@nexamed/shared` — một
 * nguồn sự thật duy nhất cho request/response (đúng .claude/docs/coding-standards.md, không viết
 * lại validation theo trí nhớ). Không dùng `@nestjs/swagger` scan decorator vì hệ thống validate
 * bằng Zod trong controller (`schema.parse(body)`), không dùng DTO class + class-validator.
 *
 * Chạy: pnpm --filter @nexamed/api run openapi:generate (S1-09, xem docs/DECISIONS.md).
 * apps/web dùng file output này để sinh type qua `openapi-typescript` — không cần API đang chạy.
 */
const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

function envelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema, meta: z.object({}) });
}

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return jsonResponse(description, errorEnvelopeSchema);
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['auth'],
  summary: 'Đăng nhập bằng tenantId + username + password',
  request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
  responses: {
    200: jsonResponse('Đăng nhập thành công', envelope(loginResponseSchema)),
    401: errorResponse('Sai tenantId/username/password'),
    423: errorResponse('Tài khoản đang bị khoá tạm sau nhiều lần đăng nhập sai'),
    403: errorResponse('Tài khoản đã bị vô hiệu hoá'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Xoay vòng refresh token (đọc từ cookie httpOnly), cấp access token mới',
  responses: {
    200: jsonResponse('Refresh thành công', envelope(refreshResponseSchema)),
    401: errorResponse('Refresh token thiếu, sai, hết hạn, hoặc đã bị thu hồi'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  summary: 'Đăng xuất — thu hồi phiên refresh token hiện tại',
  responses: {
    200: jsonResponse('Đăng xuất thành công', envelope(logoutResponseSchema)),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  tags: ['auth'],
  summary: 'Danh tính + vai trò của user đang đăng nhập (khôi phục phiên lúc reload trang)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(meResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/break-glass',
  tags: ['break-glass'],
  summary: 'Xin vượt quyền tạm thời — xác thực lại mật khẩu + lý do bắt buộc',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: breakGlassRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo phiên break-glass thành công', envelope(breakGlassResponseSchema)),
    401: errorResponse('Thiếu access token hoặc sai mật khẩu'),
  },
});

const patientIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'post',
  path: '/api/v1/patients',
  tags: ['patient'],
  summary: 'Tạo hồ sơ bệnh nhân (PAT-01)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createPatientRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo thành công', envelope(patientDetailSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.create'),
    409: errorResponse('Trùng số CCCD/CMND với bệnh nhân khác trong tenant'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients',
  tags: ['patient'],
  summary: 'Danh sách bệnh nhân, phân trang cursor (PAT-02)',
  security: [{ bearerAuth: [] }],
  request: { query: listPatientsQuerySchema },
  responses: {
    200: jsonResponse('Thành công', envelope(listPatientsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}',
  tags: ['patient'],
  summary: 'Chi tiết một hồ sơ bệnh nhân (kèm CCCD đã giải mã)',
  security: [{ bearerAuth: [] }],
  request: { params: patientIdParams },
  responses: {
    200: jsonResponse('Thành công', envelope(patientDetailSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read (có thể xin break-glass)'),
    404: errorResponse('Không tìm thấy hồ sơ (không tồn tại hoặc thuộc tenant khác)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/patients/{id}',
  tags: ['patient'],
  summary: 'Sửa hồ sơ bệnh nhân — bắt buộc kèm version hiện có (optimistic locking)',
  security: [{ bearerAuth: [] }],
  request: {
    params: patientIdParams,
    body: { content: { 'application/json': { schema: updatePatientRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(patientDetailSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.update (có thể xin break-glass)'),
    404: errorResponse('Không tìm thấy hồ sơ (không tồn tại hoặc thuộc tenant khác)'),
    409: errorResponse('version không khớp (dữ liệu đã đổi) hoặc trùng CCCD với bệnh nhân khác'),
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'NEXAMed API', version: '1.0.0', description: 'Sinh tự động từ packages/shared — không sửa tay.' },
  servers: [{ url: '/' }],
});

const outDir = path.resolve(__dirname, '..', 'openapi');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'openapi.json');
writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n', 'utf-8');

console.log(`Đã sinh ${outFile}`);
