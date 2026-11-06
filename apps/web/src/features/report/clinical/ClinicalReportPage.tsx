import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar, type TabBarItem } from '../../../shared/ui/TabBar';
import { useFilterByPermission } from '../../auth/usePermission';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { ClinicalDiagnosisTab } from './ClinicalDiagnosisTab';
import { ClinicalParaclinicalTab } from './ClinicalParaclinicalTab';
import { CLINICAL_DEFAULT_TAB, CLINICAL_TABS, parseClinicalTab } from './clinical-model';

/**
 * Trang "Chuyên môn" (docs/DECISIONS.md #287): 3 tab — Cơ cấu chẩn đoán ICD-10, Dịch vụ đã dùng, Cận lâm sàng. "Dịch vụ đã dùng" là báo cáo đã có ở trang Doanh thu ("Theo nhóm và dịch vụ", cùng số
 * liệu) nên bấm tab là chuyển sang trang đó, chỉ hiện khi người xem có quyền xem Doanh thu; hai tab còn lại nhớ trong `?tab=`. Kỳ và phạm vi chi nhánh được giữ chung giữa các tab. Quyền của trang:
 * `clinical_report.read` (mặc định chỉ quản lý phòng khám).
 */
export function ClinicalReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = parseClinicalTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như các trang báo cáo khác: Báo cáo / Chuyên môn / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Chuyên môn' }, { label: CLINICAL_TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');

  // Tab dẫn sang trang khác chỉ hiện khi có quyền của trang đích (cùng quyền route).
  const visibleTabs = useFilterByPermission(CLINICAL_TABS.map((t) => ({ ...t, permission: 'permission' in t ? t.permission : undefined })));
  const tabs: TabBarItem<string>[] = visibleTabs.map((t) => ({ id: t.id, label: t.label }));

  const onChangeTab = (next: string) => {
    const link = CLINICAL_TABS.find((t) => t.id === next);
    if (link && 'to' in link) {
      navigate(link.to);
      return;
    }
    setSearchParams(next === CLINICAL_DEFAULT_TAB ? {} : { tab: next }, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Chuyên môn</h1>
      <TabBar tabs={tabs} active={tab} onChange={onChangeTab} variant="underline" className="flex-shrink-0" />
      {tab === 'diagnoses' && <ClinicalDiagnosisTab period={period} scope={scope} />}
      {tab === 'paraclinical' && <ClinicalParaclinicalTab period={period} scope={scope} />}
    </div>
  );
}
