/**
 * Factory cache key cho TanStack Query — luôn có `tenantId` ở vị trí đầu để không rò cache khi
 * đổi tenant (S1-09, theo .claude/docs/architecture.md mục "Luồng dữ liệu phía web": cache key
 * `[tenantId, domain, entityId]`). Mọi hook `useQuery` đọc dữ liệu theo tenant từ S2 trở đi
 * (patient, appointment, encounter...) dùng factory này thay vì tự ghép mảng key tay.
 */
export function queryKey(tenantId: string, domain: string, ...rest: (string | undefined)[]) {
  return [tenantId, domain, ...rest.filter((part): part is string => part !== undefined)] as const;
}
