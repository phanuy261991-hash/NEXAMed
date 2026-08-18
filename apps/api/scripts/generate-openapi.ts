import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Bắt buộc trước khi dùng `request.params`/`request.query` — zod-to-openapi cần `.openapi()`
// (patch vào ZodType.prototype) để tự sinh định nghĩa parameter từ field của z.object thường.
extendZodWithOpenApi(z);
import {
  appointmentPhoneLookupQuerySchema,
  appointmentPhoneLookupResponseSchema,
  appointmentSummarySchema,
  breakGlassRequestSchema,
  breakGlassResponseSchema,
  cancelAppointmentRequestSchema,
  cancelEncounterRequestSchema,
  checkInRequestSchema,
  checkPatientDuplicateQuerySchema,
  checkPatientDuplicateResponseSchema,
  clinicProfileSchema,
  clinicSettingsSchema,
  createAppointmentRequestSchema,
  createPatientRequestSchema,
  createRoomRequestSchema,
  createUserAccountRequestSchema,
  encounterSummarySchema,
  listAppointmentsQuerySchema,
  listAppointmentsResponseSchema,
  listDoctorsResponseSchema,
  listPatientsQuerySchema,
  listPatientsResponseSchema,
  listProvincesResponseSchema,
  listReferenceCatalogResponseSchema,
  listRoomsResponseSchema,
  listWardsResponseSchema,
  listUserAccountsQuerySchema,
  listUserAccountsResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  patientByNationalIdQuerySchema,
  patientByNationalIdResponseSchema,
  patientByPhoneQuerySchema,
  patientByPhoneResponseSchema,
  patientDetailSchema,
  createReferenceCatalogRequestSchema,
  receptionListQuerySchema,
  receptionListResponseSchema,
  recordVitalSignRequestSchema,
  referenceCatalogCategorySchema,
  referenceCatalogItemSchema,
  registerReceptionRequestSchema,
  refreshResponseSchema,
  rescheduleAppointmentRequestSchema,
  resetUserPasswordRequestSchema,
  roomSummarySchema,
  startConsultationRequestSchema,
  updateClinicProfileRequestSchema,
  updateClinicSettingsRequestSchema,
  updatePatientRequestSchema,
  updateReferenceCatalogRequestSchema,
  updateRoomRequestSchema,
  updateUserAccountRequestSchema,
  userAccountSummarySchema,
  vitalSignResponseSchema,
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

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/by-phone',
  tags: ['patient'],
  summary: 'Tra trùng số điện thoại (cảnh báo mềm form Thêm/Sửa; chọn khách hàng ở trang Tiếp nhận) — khớp CHÍNH XÁC, SĐT được phép trùng',
  security: [{ bearerAuth: [] }],
  request: { query: patientByPhoneQuerySchema },
  responses: {
    200: jsonResponse('Thành công (mảng rỗng nếu chưa ai dùng SĐT này)', envelope(patientByPhoneResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read'),
  },
});

const patientIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/by-national-id',
  tags: ['patient'],
  summary: 'Tra trùng CCCD (màn hình "Tiếp nhận bệnh nhân") — khớp CHÍNH XÁC, CCCD là duy nhất trong tenant',
  security: [{ bearerAuth: [] }],
  request: { query: patientByNationalIdQuerySchema },
  responses: {
    200: jsonResponse('Thành công (mảng rỗng nếu chưa ai dùng CCCD này)', envelope(patientByNationalIdResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read'),
  },
});

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
  path: '/api/v1/patients/check-duplicate',
  tags: ['patient'],
  summary: 'Kiểm tra nghi trùng tên + ngày sinh trước khi tạo hồ sơ mới (PAT-03, chỉ cảnh báo)',
  security: [{ bearerAuth: [] }],
  request: { query: checkPatientDuplicateQuerySchema },
  responses: {
    200: jsonResponse('Thành công (mảng rỗng nếu không nghi trùng)', envelope(checkPatientDuplicateResponseSchema)),
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

registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/{id}/photo',
  tags: ['patient'],
  summary: 'Upload/thay ảnh đại diện (docs/DECISIONS.md #034) — chỉ JPG/PNG (kiểm magic byte), tối đa 3MB, kèm version hiện có',
  security: [{ bearerAuth: [] }],
  request: {
    params: patientIdParams,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().openapi({ format: 'binary', description: 'Ảnh JPG hoặc PNG' }),
            version: z.coerce.number().int().positive(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse('Upload thành công, trả hồ sơ kèm photoUrl mới', envelope(patientDetailSchema)),
    400: errorResponse('Sai định dạng ảnh (PATIENT_INVALID_PHOTO) hoặc quá 3MB'),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.update (có thể xin break-glass)'),
    404: errorResponse('Không tìm thấy hồ sơ (không tồn tại hoặc thuộc tenant khác)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/appointments',
  tags: ['appointment'],
  summary: 'Đặt lịch hẹn (APP-02) — chặn trùng khung giờ cùng bác sĩ ở tầng DB (APP-03)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createAppointmentRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo thành công', envelope(appointmentSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.create, hoặc bác sĩ (scope personal) cố đặt hộ bác sĩ khác'),
    409: errorResponse('Trùng khung giờ với lịch hẹn khác của cùng bác sĩ (APPOINTMENT_SLOT_CONFLICT)'),
    422: errorResponse('Bệnh nhân/bác sĩ/phòng không tồn tại hoặc thuộc tenant khác'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments',
  tags: ['appointment'],
  summary: 'Danh sách lịch hẹn, phân trang cursor (APP-01)',
  security: [{ bearerAuth: [] }],
  request: { query: listAppointmentsQuerySchema },
  responses: {
    200: jsonResponse('Thành công', envelope(listAppointmentsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments/doctors',
  tags: ['appointment'],
  summary: 'Danh sách bác sĩ (S2-09, màn hình lịch hẹn) — chiếu tối thiểu, gắn quyền appointment.read thay vì user_account.read',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(listDoctorsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments/schedule-config',
  tags: ['appointment'],
  summary: 'Giờ làm việc + độ dài slot (S2-09) — cùng dữ liệu GET /clinic-settings nhưng gắn quyền appointment.read',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(clinicSettingsSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments/lookup',
  tags: ['appointment'],
  summary: 'Tra cứu theo SĐT lúc đặt lịch — tự điền tên, cảnh báo spam theo số lần huỷ (docs/DECISIONS.md #032)',
  security: [{ bearerAuth: [] }],
  request: { query: appointmentPhoneLookupQuerySchema },
  responses: {
    200: jsonResponse('Thành công', envelope(appointmentPhoneLookupResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.read'),
  },
});

const appointmentIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/appointments/{id}',
  tags: ['appointment'],
  summary: 'Chi tiết một lịch hẹn',
  security: [{ bearerAuth: [] }],
  request: { params: appointmentIdParams },
  responses: {
    200: jsonResponse('Thành công', envelope(appointmentSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.read (có thể xin break-glass)'),
    404: errorResponse('Không tìm thấy (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal của bác sĩ)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/appointments/{id}/cancel',
  tags: ['appointment'],
  summary: 'Huỷ lịch hẹn (APP-04) — bắt buộc lý do, kèm version hiện có (optimistic locking)',
  security: [{ bearerAuth: [] }],
  request: {
    params: appointmentIdParams,
    body: { content: { 'application/json': { schema: cancelAppointmentRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Huỷ thành công', envelope(appointmentSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.cancel'),
    404: errorResponse('Không tìm thấy (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal của bác sĩ)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION), hoặc lịch không còn ở trạng thái SCHEDULED (APPOINTMENT_NOT_CANCELLABLE)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/appointments/{id}/reschedule',
  tags: ['appointment'],
  summary: 'Đổi/dời lịch hẹn (S2-09) — đổi giờ/bác sĩ/phòng, kèm version hiện có (optimistic locking)',
  security: [{ bearerAuth: [] }],
  request: {
    params: appointmentIdParams,
    body: { content: { 'application/json': { schema: rescheduleAppointmentRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Đổi lịch thành công', envelope(appointmentSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền appointment.update, hoặc bác sĩ (scope personal) cố đổi lịch cho bác sĩ khác'),
    404: errorResponse('Không tìm thấy (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal của bác sĩ)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION), lịch không còn SCHEDULED (APPOINTMENT_NOT_CANCELLABLE), hoặc trùng khung giờ khác của cùng bác sĩ (APPOINTMENT_SLOT_CONFLICT)'),
    422: errorResponse('Bác sĩ/phòng không tồn tại hoặc thuộc tenant khác'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reception/check-in',
  tags: ['reception'],
  summary: 'Tiếp nhận — check-in (Sprint 3): tạo lượt khám (encounter) + chuyển lịch hẹn sang CONVERTED, atomic. patientId đã resolve xong ở web (tìm/tạo trước)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: checkInRequestSchema } } } },
  responses: {
    200: jsonResponse('Check-in thành công', envelope(encounterSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền encounter.create'),
    404: errorResponse('Không tìm thấy lịch hẹn (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal) hoặc patientId không hợp lệ'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION), lịch không còn SCHEDULED (APPOINTMENT_NOT_CANCELLABLE), hoặc đã check-in trước đó (ENCOUNTER_ALREADY_EXISTS)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reception/direct',
  tags: ['reception'],
  summary: '"Tiếp nhận bệnh nhân" — tạo lượt khám (encounter) trực tiếp, KHÔNG qua lịch hẹn (khách đến thẳng phòng khám)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: registerReceptionRequestSchema } } } },
  responses: {
    200: jsonResponse('Tiếp nhận thành công', envelope(encounterSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền encounter.create'),
    404: errorResponse('patientId/doctorId không hợp lệ hoặc thuộc tenant khác'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/reception/list',
  tags: ['reception'],
  summary: '"Danh sách tiếp nhận" (mặc định) / "Hàng đợi khám" (kèm doctorId) — CHỈ encounter đã tiếp nhận trong ngày, KHÔNG gồm lịch hẹn chưa đến',
  security: [{ bearerAuth: [] }],
  request: { query: receptionListQuerySchema },
  responses: {
    200: jsonResponse('Thành công', envelope(receptionListResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền encounter.read'),
  },
});

const encounterIdParams = z.object({ encounterId: z.string().uuid() });

registry.registerPath({
  method: 'post',
  path: '/api/v1/reception/encounters/{encounterId}/vital-signs',
  tags: ['reception'],
  summary: 'Nhập sinh hiệu (REC-02) — luôn cho lưu, warnings chỉ để cảnh báo ngoài ngưỡng theo tuổi (REC-03), không chặn',
  security: [{ bearerAuth: [] }],
  request: {
    params: encounterIdParams,
    body: { content: { 'application/json': { schema: recordVitalSignRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Lưu thành công, kèm warnings[] nếu có chỉ số ngoài ngưỡng', envelope(vitalSignResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền vital_sign.create'),
    404: errorResponse('Không tìm thấy lượt khám (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal)'),
    409: errorResponse('Lượt khám không còn ở trạng thái CHECKED_IN (ENCOUNTER_NOT_CHECKED_IN)'),
  },
});

const encounterActionIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/start',
  tags: ['encounter'],
  summary: '"Bắt đầu khám" — CHECKED_IN → IN_CONSULTATION, chỉ bác sĩ phụ trách chính lượt khám (data_scope=personal)',
  security: [{ bearerAuth: [] }],
  request: {
    params: encounterActionIdParams,
    body: { content: { 'application/json': { schema: startConsultationRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Thành công', envelope(encounterSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền encounter.update'),
    404: errorResponse('Không tìm thấy (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal)'),
    409: errorResponse('Chuyển trạng thái không hợp lệ (ENCOUNTER_INVALID_TRANSITION) hoặc version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/cancel',
  tags: ['encounter'],
  summary: '"Bỏ về" — CHECKED_IN → CANCELLED, bắt buộc lý do',
  security: [{ bearerAuth: [] }],
  request: {
    params: encounterActionIdParams,
    body: { content: { 'application/json': { schema: cancelEncounterRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Thành công', envelope(encounterSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền encounter.cancel'),
    404: errorResponse('Không tìm thấy (không tồn tại, thuộc tenant khác, hoặc ngoài scope personal)'),
    409: errorResponse('Chuyển trạng thái không hợp lệ (ENCOUNTER_INVALID_TRANSITION) hoặc version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

const userIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'post',
  path: '/api/v1/users',
  tags: ['user-account'],
  summary: 'Tạo tài khoản nhân viên + gán vai trò (ADM-01)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createUserAccountRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo thành công', envelope(userAccountSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền user_account.manage'),
    409: errorResponse('Trùng tên đăng nhập (USER_ACCOUNT_DUPLICATE_USERNAME)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  tags: ['user-account'],
  summary: 'Danh sách tài khoản, phân trang cursor',
  security: [{ bearerAuth: [] }],
  request: { query: listUserAccountsQuerySchema },
  responses: {
    200: jsonResponse('Thành công', envelope(listUserAccountsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền user_account.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{id}',
  tags: ['user-account'],
  summary: 'Chi tiết một tài khoản',
  security: [{ bearerAuth: [] }],
  request: { params: userIdParams },
  responses: {
    200: jsonResponse('Thành công', envelope(userAccountSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền user_account.read'),
    404: errorResponse('Không tìm thấy (không tồn tại hoặc thuộc tenant khác)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{id}',
  tags: ['user-account'],
  summary: 'Sửa hồ sơ/vai trò/trạng thái tài khoản — đổi vai trò hoặc vô hiệu hoá thu hồi toàn bộ phiên đang mở',
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParams,
    body: { content: { 'application/json': { schema: updateUserAccountRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(userAccountSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền user_account.manage'),
    404: errorResponse('Không tìm thấy (không tồn tại hoặc thuộc tenant khác)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/{id}/reset-password',
  tags: ['user-account'],
  summary: 'Đặt lại mật khẩu — thu hồi toàn bộ phiên đang mở của tài khoản đó',
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParams,
    body: { content: { 'application/json': { schema: resetUserPasswordRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Thành công', envelope(userAccountSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền user_account.manage'),
    404: errorResponse('Không tìm thấy (không tồn tại hoặc thuộc tenant khác)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/rooms',
  tags: ['clinic'],
  summary: 'Tạo phòng khám (ADM-02)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createRoomRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo thành công', envelope(roomSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/rooms',
  tags: ['clinic'],
  summary: 'Danh sách phòng khám (không phân trang — quy mô nhỏ)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(listRoomsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.read'),
  },
});

const roomIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'patch',
  path: '/api/v1/rooms/{id}',
  tags: ['clinic'],
  summary: 'Sửa/khoá phòng khám — bắt buộc kèm version hiện có',
  security: [{ bearerAuth: [] }],
  request: {
    params: roomIdParams,
    body: { content: { 'application/json': { schema: updateRoomRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(roomSummarySchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
    404: errorResponse('Không tìm thấy (không tồn tại hoặc thuộc tenant khác)'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/clinic-settings',
  tags: ['clinic'],
  summary: 'Xem cấu hình phòng khám: giờ làm việc, độ dài slot (ADM-02, trừ mẫu in)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(clinicSettingsSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.read'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/clinic-settings',
  tags: ['clinic'],
  summary: 'Sửa cấu hình phòng khám — chỉ field có mặt trong body mới bị ghi đè',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: updateClinicSettingsRequestSchema } } } },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(clinicSettingsSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/clinic-profile',
  tags: ['clinic'],
  summary: 'Xem thông tin phòng khám: tên, điện thoại, địa chỉ, email, mã số thuế, đơn vị tiền tệ, múi giờ, logo',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(clinicProfileSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.read'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/clinic-profile',
  tags: ['clinic'],
  summary: 'Sửa thông tin phòng khám — bắt buộc kèm version hiện có (optimistic locking)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: updateClinicProfileRequestSchema } } } },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(clinicProfileSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

const uploadLogoBody = {
  content: {
    'multipart/form-data': {
      schema: z.object({
        file: z.string().openapi({ format: 'binary', description: 'Ảnh JPG hoặc PNG' }),
        version: z.coerce.number().int().positive(),
      }),
    },
  },
};

registry.registerPath({
  method: 'post',
  path: '/api/v1/clinic-profile/logo',
  tags: ['clinic'],
  summary: 'Upload/thay logo chính (khuyến nghị 220×110px) — chỉ JPG/PNG (kiểm magic byte), tối đa 2MB, kèm version hiện có',
  security: [{ bearerAuth: [] }],
  request: { body: uploadLogoBody },
  responses: {
    200: jsonResponse('Upload thành công, trả hồ sơ kèm logoUrl mới', envelope(clinicProfileSchema)),
    400: errorResponse('Sai định dạng ảnh (CLINIC_INVALID_LOGO) hoặc quá 2MB'),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/clinic-profile/print-logo',
  tags: ['clinic'],
  summary: 'Upload/thay logo dùng cho mẫu in (khuyến nghị 110×110px) — chỉ JPG/PNG (kiểm magic byte), tối đa 2MB, kèm version hiện có',
  security: [{ bearerAuth: [] }],
  request: { body: uploadLogoBody },
  responses: {
    200: jsonResponse('Upload thành công, trả hồ sơ kèm printLogoUrl mới', envelope(clinicProfileSchema)),
    400: errorResponse('Sai định dạng ảnh (CLINIC_INVALID_LOGO) hoặc quá 2MB'),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền clinic_config.update'),
    409: errorResponse('version không khớp (CONCURRENT_MODIFICATION)'),
  },
});

const referenceCatalogCategoryParams = z.object({ category: referenceCatalogCategorySchema });
const referenceCatalogListQuery = z.object({ includeInactive: z.enum(['true', 'false']).optional() });
const referenceCatalogIdParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/reference-catalog/{category}',
  tags: ['reference-catalog'],
  summary: 'Danh mục dùng chung theo loại (Dân tộc/Quốc tịch/Nguồn khách hàng/Loại khám) — includeInactive=true để xem cả mục đã ẩn (màn hình quản lý)',
  security: [{ bearerAuth: [] }],
  request: { params: referenceCatalogCategoryParams, query: referenceCatalogListQuery },
  responses: {
    200: jsonResponse('Thành công', envelope(listReferenceCatalogResponseSchema)),
    400: errorResponse('category không hợp lệ'),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền reference_catalog.read'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reference-catalog',
  tags: ['reference-catalog'],
  summary: 'Thêm mục mới vào danh mục dùng chung',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createReferenceCatalogRequestSchema } } } },
  responses: {
    200: jsonResponse('Tạo thành công', envelope(referenceCatalogItemSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền reference_catalog.manage'),
    409: errorResponse('Trùng mã (code) trong cùng danh mục'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/reference-catalog/{id}',
  tags: ['reference-catalog'],
  summary: 'Sửa một mục trong danh mục dùng chung',
  security: [{ bearerAuth: [] }],
  request: {
    params: referenceCatalogIdParams,
    body: { content: { 'application/json': { schema: updateReferenceCatalogRequestSchema } } },
  },
  responses: {
    200: jsonResponse('Sửa thành công', envelope(referenceCatalogItemSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền reference_catalog.manage'),
    404: errorResponse('Không tìm thấy'),
    409: errorResponse('Trùng mã (code) với mục khác trong cùng danh mục'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/reference-catalog/{id}',
  tags: ['reference-catalog'],
  summary: 'Ẩn một mục (soft — role DB không có quyền DELETE thật)',
  security: [{ bearerAuth: [] }],
  request: { params: referenceCatalogIdParams },
  responses: {
    200: jsonResponse('Đã ẩn', envelope(referenceCatalogItemSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền reference_catalog.manage'),
    404: errorResponse('Không tìm thấy'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reference-catalog/{id}/reactivate',
  tags: ['reference-catalog'],
  summary: 'Khôi phục một mục đã ẩn',
  security: [{ bearerAuth: [] }],
  request: { params: referenceCatalogIdParams },
  responses: {
    200: jsonResponse('Đã khôi phục', envelope(referenceCatalogItemSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền reference_catalog.manage'),
    404: errorResponse('Không tìm thấy'),
  },
});

const listWardsQueryParams = z.object({ provinceCode: z.string().min(1).optional() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/geo/provinces',
  tags: ['geo'],
  summary: 'Danh mục Tỉnh/Thành phố toàn hệ thống (read-only, theo mã Bộ Nội vụ)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse('Thành công', envelope(listProvincesResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/geo/wards',
  tags: ['geo'],
  summary: 'Danh mục Phường/Xã — có provinceCode: cascading theo Tỉnh; bỏ trống: toàn bộ (~3321 dòng, dựng bảng tra code→tên)',
  security: [{ bearerAuth: [] }],
  request: { query: listWardsQueryParams },
  responses: {
    200: jsonResponse('Thành công', envelope(listWardsResponseSchema)),
    401: errorResponse('Thiếu hoặc sai access token'),
    403: errorResponse('Không có quyền patient.read'),
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
