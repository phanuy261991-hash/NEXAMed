/**
 * UUID sentinel cho thao tác ghi do HỆ THỐNG tự kích hoạt (job nền), không có actor người dùng
 * thật — `created_by`/`updated_by` là cột UUID thuần, không FK (schema.prisma), nên giá trị này
 * hợp lệ dù không trỏ tới `user_account` nào. Trích từ hằng số cục bộ đã dùng ở `main.ts`
 * (`syncRolePermissionsForAllTenants`) — S5-07 (job tự động đánh dấu "Không đến") là nơi dùng
 * lại thứ hai, trích ra đây theo nguyên tắc "trùng lần hai phải trích xuất".
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
