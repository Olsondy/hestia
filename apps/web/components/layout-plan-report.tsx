import './layout-plan-report.css';
import type { ConversationBrief } from '../../../packages/contracts/src/tasks';
import type { LayoutPlan } from '../../../packages/layout-planner/src/contract';

const checkNames: Record<string, string> = { input: '输入数据', scale: '尺寸依据', 'scope-and-locks': '家具与保留范围', boundary: '空间边界', objects: '家具与固定设施', walls: '墙体与开口', 'door-clearances': '门扇区域', 'furniture-geometry': '家具摆放', 'geometry-completed': '几何检查完整性', 'human-use-clearance': '日常使用净空', 'transport-path': '搬运路径', 'structural-safety': '结构安全', 'planner-room': '房间范围', 'planner-retained-objects': '保留已有实物', 'planner-preserved-poses': '原位与锁定条件', 'planner-functional-assets': '会客与办公家具', 'planner-workstation': '桌椅使用关系', 'planner-entry-functional-route-0.7m': '入口到功能区的 0.7 米通路', 'ergonomics-accessibility-certification': '人体工学与无障碍专业核验' };
function checksForDisplay(checks: LayoutPlan['checks']) {
  const priority = { failed: 3, not_checked: 2, passed: 1 }, grouped = new Map<string, LayoutPlan['checks'][number]>();
  for (const check of checks) {
    const prior = grouped.get(check.code);
    if (!prior || priority[check.status] > priority[prior.status]) grouped.set(check.code, check);
  }
  return [...grouped.values()];
}

/** Only persisted planner evidence is rendered here; model prose cannot create a passed check. */
export function LayoutPlanReport({ report, brief, expanded = false, historical = false }: { report: LayoutPlan; brief?: ConversationBrief; expanded?: boolean; historical?: boolean }) {
  return <section className="layout-plan-report" aria-label="布局推荐依据">
    <h3>{report.status === 'recommended' ? '会客与办公，各有位置。' : report.status === 'needs_input' ? '还需要一些空间依据' : '这次未找到合格布局'}</h3>
    <p>{historical ? '生成时：' : ''}{report.reason}</p>
    <details open={expanded}><summary>检查与需求依据</summary>
      <ul>{checksForDisplay(report.checks).map(check => <li key={check.code}><span className="layout-evidence-state">{check.status === 'passed' ? '已检查' : check.status === 'failed' ? '未通过' : '无通过结论'}</span><p>{checkNames[check.code] || '本次空间检查'}{check.detail ? `：${check.detail}` : ''}</p></li>)}</ul>
      {report.requirements.map(item => <div className="layout-requirement" key={item.id}><p>{brief?.requirements.find(requirement => requirement.id === item.id)?.content || '本轮记录的需求'}</p><small>{item.status === 'satisfied' ? '满足依据' : '尚未核实'}：{item.evidence}</small></div>)}
      {brief && report.source.inputIds.map(id => { const input = brief.inputs.find(item => item.id === id); return input ? <blockquote key={id}>{input.text}<small>你的第 {input.intentVersion} 次补充</small></blockquote> : null; })}
    </details>
  </section>;
}
