import { z } from 'zod';

/**
 * "Đổi ca" (#225) — A đưa ca X, nhận ca Y của B (đổi 2 ca cho nhau). Chỉ B xác nhận; xác nhận xong hệ thống đổi
 * chủ 2 ca ngay, quản lý chỉ xem lịch sử. `EXPIRED` là trạng thái TÍNH LÚC ĐỌC: yêu cầu còn `PENDING` mà ngày
 * sớm hơn của 2 ca đã qua.
 */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD');
const versionSchema = z.number().int().positive();

export const shiftSwapStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED']);
export type ShiftSwapStatus = z.infer<typeof shiftSwapStatusSchema>;

export const createShiftSwapRequestSchema = z.object({
  requesterAssignmentId: z.string().uuid(),
  counterpartAssignmentId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type CreateShiftSwapRequest = z.infer<typeof createShiftSwapRequestSchema>;

export const acceptShiftSwapRequestSchema = z.object({ version: versionSchema });
export type AcceptShiftSwapRequest = z.infer<typeof acceptShiftSwapRequestSchema>;

export const declineShiftSwapRequestSchema = z.object({ version: versionSchema, reason: z.string().trim().max(500).optional() });
export type DeclineShiftSwapRequest = z.infer<typeof declineShiftSwapRequestSchema>;

export const cancelShiftSwapRequestSchema = z.object({ version: versionSchema });
export type CancelShiftSwapRequest = z.infer<typeof cancelShiftSwapRequestSchema>;

export const shiftSwapAssignmentRefSchema = z.object({
  assignmentId: z.string().uuid(),
  workDate: dateSchema,
  workShiftId: z.string().uuid(),
  workShiftName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});
export type ShiftSwapAssignmentRef = z.infer<typeof shiftSwapAssignmentRefSchema>;

export const shiftSwapItemSchema = z.object({
  id: z.string().uuid(),
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  requesterAssignment: shiftSwapAssignmentRefSchema,
  counterpartId: z.string().uuid(),
  counterpartName: z.string(),
  counterpartAssignment: shiftSwapAssignmentRefSchema,
  note: z.string().nullable(),
  status: shiftSwapStatusSchema,
  respondedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  createdAt: z.string(),
  /** Quản lý: chưa xem (hiện nhãn "Mới", tính vào chấm số). */
  isNewForManager: z.boolean(),
  /** Actor là người nhận và yêu cầu còn hiệu lực → xác nhận/từ chối được. */
  canRespond: z.boolean(),
  /** Actor là người gửi và yêu cầu còn `PENDING` → huỷ được. */
  canCancel: z.boolean(),
  version: z.number().int(),
});
export type ShiftSwapItem = z.infer<typeof shiftSwapItemSchema>;

export const listShiftSwapsQuerySchema = z.object({ status: shiftSwapStatusSchema.optional() });
export type ListShiftSwapsQuery = z.infer<typeof listShiftSwapsQuerySchema>;

export const listShiftSwapsResponseSchema = z.object({ items: z.array(shiftSwapItemSchema) });
export type ListShiftSwapsResponse = z.infer<typeof listShiftSwapsResponseSchema>;

export const shiftSwapCountResponseSchema = z.object({ count: z.number().int() });
export type ShiftSwapCountResponse = z.infer<typeof shiftSwapCountResponseSchema>;

export const shiftSwapColleagueSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  departmentName: z.string().nullable(),
});
export type ShiftSwapColleague = z.infer<typeof shiftSwapColleagueSchema>;

export const listShiftSwapColleaguesResponseSchema = z.object({ items: z.array(shiftSwapColleagueSchema) });
export type ListShiftSwapColleaguesResponse = z.infer<typeof listShiftSwapColleaguesResponseSchema>;

/** Ca sắp tới của một đồng nghiệp (hoặc của chính mình) kèm cờ có đổi được không và lý do bị chặn. */
export const shiftSwapCandidateSchema = shiftSwapAssignmentRefSchema.extend({
  swappable: z.boolean(),
  blockedReason: z.string().nullable(),
});
export type ShiftSwapCandidate = z.infer<typeof shiftSwapCandidateSchema>;

export const listShiftSwapCandidatesResponseSchema = z.object({ items: z.array(shiftSwapCandidateSchema) });
export type ListShiftSwapCandidatesResponse = z.infer<typeof listShiftSwapCandidatesResponseSchema>;

export const shiftSwapCheckResponseSchema = z.object({ swappable: z.boolean(), blockedReason: z.string().nullable() });
export type ShiftSwapCheckResponse = z.infer<typeof shiftSwapCheckResponseSchema>;
