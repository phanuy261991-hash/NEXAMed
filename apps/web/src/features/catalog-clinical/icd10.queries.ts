import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { listIcd10Chapters, listIcd10Codes, listIcd10Groups, searchIcd10 } from './icd10.api';

/** Danh mục ICD-10 read-only (S3-01) — `staleTime: Infinity`, không có mutation nào invalidate. */
export function useIcd10ChaptersQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'icd10', 'chapters'),
    queryFn: listIcd10Chapters,
    staleTime: Infinity,
  });
}

/** Chỉ gọi khi đã chọn Chương (`enabled`) — cascade cột 2. */
export function useIcd10GroupsQuery(chapterCode: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'icd10', 'groups', chapterCode),
    queryFn: () => listIcd10Groups(chapterCode),
    enabled: chapterCode !== '',
    staleTime: Infinity,
  });
}

/** Chỉ gọi khi đã chọn Nhóm (`enabled`) — cascade cột 3. */
export function useIcd10CodesQuery(groupCode: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'icd10', 'codes', groupCode),
    queryFn: () => listIcd10Codes(groupCode),
    enabled: groupCode !== '',
    staleTime: Infinity,
  });
}

/** Ô tìm nhanh, bỏ qua cascade — gọi component nên tự `useDebouncedValue(q, 300)` trước khi truyền vào đây. */
export function useIcd10SearchQuery(q: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'icd10', 'search', q),
    queryFn: () => searchIcd10(q),
    enabled: q.trim() !== '',
    staleTime: Infinity,
  });
}