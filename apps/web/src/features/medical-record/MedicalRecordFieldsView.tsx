import type { FieldGroup } from './medical-record-model';

/**
 * Cách xem thứ hai của hồ sơ bệnh án: "Theo trường dữ liệu" (docs/DECISIONS.md #269). Mỗi nhóm là một hàng có cột tiêu đề bên trái (cùng khuôn `RecordSection`), nội dung là bảng
 * Trường · Giá trị · Ghi nhận bởi. Cố ý KHÔNG hiện tên bảng/cột kỹ thuật — người dùng chỉ cần biết ai ghi và lúc nào. Không gắn nhãn "mới" cho trường nào: đó là chú thích của mockup để duyệt, không phải nội dung sản phẩm.
 */
export function MedicalRecordFieldsView({ groups }: { groups: FieldGroup[] }) {
  return (
    <div className="px-[18px] py-3.5">
      <div className="overflow-hidden rounded-[10px] border border-slate-300">
        {groups.map((g) => (
          <section key={g.title} className="grid grid-cols-1 border-t border-slate-300 first:border-t-0 md:grid-cols-[180px_minmax(0,1fr)]">
            <h3 className="flex flex-col items-start gap-0.5 border-b border-slate-300 bg-slate-100 px-4 py-3.5 text-sm font-semibold leading-snug text-slate-900 md:border-b-0 md:border-r">
              <span>{g.title}</span>
              <span className="text-xs font-normal text-slate-500">{g.rows.length} trường</span>
            </h3>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
                <colgroup>
                  <col className="w-[150px]" />
                  <col />
                  <col className="w-[185px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                    <th scope="col" className="border-b border-slate-200 px-3 py-1.5">Trường</th>
                    <th scope="col" className="border-b border-slate-200 px-3 py-1.5">Giá trị</th>
                    <th scope="col" className="border-b border-slate-200 px-3 py-1.5">Ghi nhận bởi</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, index) => (
                    <tr key={`${r.field}-${index}`} className="align-top">
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                        {r.field}
                      </td>
                      <td className={`whitespace-pre-line border-b border-slate-100 px-3 py-2 leading-relaxed tabular-nums ${r.value === '—' ? 'italic text-slate-500' : 'text-slate-900'}`}>
                        {r.value === '—' ? '— chưa ghi —' : r.value}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 leading-snug">
                        <div className="text-slate-700">{r.who.name}</div>
                        {r.who.time !== '' && <div className="text-xs tabular-nums text-slate-500">{r.who.time}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
