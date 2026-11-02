// 企业工作台原型的演示数据：中性命名、示意尺寸，不含真实企业资料。别墅、饰面与石材沿用 H5 客户端原型（P01）。
import {makeSchemes, defaultFacets} from '../../client-h5/src/data.js';

export const member = {name: '演示方案顾问', email: 'consultant@demo-stone.example', password: 'demo-password'};
export const followName = {new: '新线索', contacted: '已联系', active: '跟进中', won: '已成交', parked: '已搁置'};
export const followOrder = ['new', 'contacted', 'active', 'won', 'parked'];
export const statusInfo = {
  review: ['待审核', 'review'], assist: ['需辅助转换', 'assist'], converting: ['图纸转换中', 'wait'],
  published: ['已发布', 'ok'], confirmed: ['客户已确认', 'ok'], generating: ['出图中', 'wait'],
};

const ago = (h, m = 0) => Date.now() - (h * 60 + m) * 60e3;
const villaFacets = [...defaultFacets];

// 线索 = 方案需求 + 客户动作 + 分享与绑定 + 跟进。
export function seedLeads() {
  return [
    {id: 'L1', title: '示例别墅 · 方案需求', origin: 'customer', source: 'sample', status: 'confirmed',
      customer: {phone: '13900139000', name: '王女士'}, createdAt: ago(26), facets: villaFacets,
      stones: ['yashi', 'shaanna'], prefs: '浅色 · 直铺、斜铺 · 波打线由方案决定', note: '客厅想更大气；家里有老人，楼梯要防滑。',
      schemes: makeSchemes(villaFacets, ['yashi', 'shaanna']), revisions: {A: 2, B: 1, C: 1},
      events: [
        {kind: 'submit', at: ago(26), text: '提交方案需求（示例别墅，9 处饰面）'},
        {kind: 'adjust', at: ago(3, 20), text: '调整方案 A：客厅地面 雅士白 → 鱼肚白（修订 2）'},
        {kind: 'confirm', at: ago(3, 5), text: '确认 方案 A · 修订 2', message: '二层想再看看深色石材，希望周末看样品。'},
        {kind: 'contact', at: ago(3, 5), text: '请求联系 · 方便时间：下午'},
      ],
      follow: 'new', notes: [], shares: [], applications: [], history: []},
    {id: 'L2', title: '临水别墅 · 企业预置方案', origin: 'member', source: 'sample', status: 'published',
      customer: {phone: '13800138000', name: '张先生'}, createdAt: ago(50), facets: villaFacets,
      stones: ['yudu', 'shaanna', 'huimu'], prefs: '—', note: '成员预置：客户上周到店看过样板。',
      schemes: makeSchemes(villaFacets, ['yudu', 'shaanna', 'huimu']), revisions: {A: 1, B: 1, C: 1},
      events: [{kind: 'bind', at: ago(20), text: '客户用指定手机号登录，自动绑定'}, {kind: 'view', at: ago(19), text: '客户查看方案 B（暖调）'}],
      follow: 'contacted', notes: [{by: '演示方案顾问', at: ago(18), text: '已电话沟通，客户倾向暖调，周六带家人到店。'}],
      shares: [{id: 'S1', mode: 'phone', phone: '13800138000', createdAt: ago(48), expires: '2026-12-02', status: 'active'}],
      applications: [], history: [{at: ago(48), text: '定向分享给 138 **** 8000'}, {at: ago(20), text: '绑定：指定手机号一致（138 **** 8000）'}]},
    {id: 'L3', title: '湖畔别墅平面图 · 方案需求', origin: 'customer', source: 'dxf', fileName: '湖畔别墅平面图.dxf', status: 'review',
      customer: {phone: '13700137000', name: null}, createdAt: ago(5), facets: villaFacets,
      stones: ['heijin', 'yashi'], prefs: '深色 · 人字铺 · 要波打线', note: '',
      convert: {levels: 3, finishes: 10, scale: '已按图纸尺寸标注校准', hints: ['二层东侧墙体未闭合，已按相邻墙线补齐，请核对。']},
      schemes: null, revisions: {A: 1, B: 1, C: 1}, reviewReason: '图纸自动转换的结果需企业核对',
      events: [{kind: 'submit', at: ago(5), text: '提交方案需求并上传 DXF 图纸'}, {kind: 'convert', at: ago(4, 52), text: 'DXF 自动转换完成：3 层、10 处饰面'}],
      follow: 'new', notes: [], shares: [], applications: [], history: []},
    {id: 'L4', title: '老宅改造 · 方案需求', origin: 'customer', source: 'other', fileName: '老宅改造.pdf', status: 'assist',
      customer: {phone: '13600136000', name: '陈女士'}, createdAt: ago(28), facets: [], kinds: ['floor', 'stair'],
      stones: ['shaanna'], prefs: '暖色 · 工字铺 · 不要波打线', note: '一楼想做通铺，楼梯换石材踏步。',
      schemes: null, revisions: {}, events: [{kind: 'submit', at: ago(28), text: '提交方案需求并上传 PDF 图纸（需辅助转换）'}],
      follow: 'contacted', notes: [{by: '演示方案顾问', at: ago(24), text: '已联系，客户补发了二层平面照片，等设计部整理户型。'}],
      shares: [], applications: [], history: []},
    {id: 'L5', title: '山景别墅 · 企业预置方案', origin: 'member', source: 'sample', status: 'published',
      customer: null, createdAt: ago(30), facets: villaFacets,
      stones: ['shaanna', 'huimu', 'feiwang'], prefs: '—', note: '成员预置：酒店项目对接人要求先看方向。',
      schemes: makeSchemes(villaFacets, ['shaanna', 'huimu', 'feiwang']), revisions: {A: 1, B: 1, C: 1},
      events: [{kind: 'apply', at: ago(1, 40), text: '135 **** 5000 提交绑定申请'}],
      follow: 'active', notes: [],
      shares: [{id: 'S2', mode: 'code', createdAt: ago(29), expires: '2026-12-02', codeExpires: '2026-11-05 10:20', status: 'active'}],
      applications: [{id: 'A1', phone: '13500135000', note: '李先生：酒店工程部，上周和顾问一起量过尺寸。', at: ago(1, 40), status: 'pending'}],
      history: [{at: ago(29), text: '绑定码分享（一次性绑定码，48 小时有效）'}, {at: ago(1, 40), text: '135 **** 5000 提交绑定申请'}]},
    {id: 'L6', title: '示例别墅 · 方案需求', origin: 'customer', source: 'sample', status: 'published',
      customer: {phone: '13300133000', name: null}, createdAt: ago(72), facets: ['f1-living', 'f1-dining', 'f1-wall', 's12'],
      stones: ['huimu'], prefs: '不确定', note: '',
      schemes: makeSchemes(['f1-living', 'f1-dining', 'f1-wall', 's12'], ['huimu']), revisions: {A: 1, B: 1, C: 1},
      events: [{kind: 'submit', at: ago(72), text: '提交方案需求（示例别墅，4 处饰面）'}, {kind: 'message', at: ago(47), text: '留言', message: '灰色会不会太冷？想看看米色的效果。'}],
      follow: 'active', notes: [{by: '演示方案顾问', at: ago(46), text: '回复了留言，建议看方案 B，等客户反馈。'}],
      shares: [], applications: [], history: []},
    {id: 'L7', title: '示例别墅 · 方案需求', origin: 'customer', source: 'sample', status: 'confirmed',
      customer: {phone: '13200132000', name: '刘先生'}, createdAt: ago(240), facets: villaFacets,
      stones: ['heijin', 'yudu'], prefs: '深色 · 直铺', note: '展厅样板间参考。',
      schemes: makeSchemes(villaFacets, ['heijin', 'yudu']), revisions: {A: 1, B: 3, C: 1},
      events: [{kind: 'submit', at: ago(240), text: '提交方案需求'}, {kind: 'confirm', at: ago(200), text: '确认 方案 B · 修订 3'}],
      follow: 'won', notes: [{by: '演示方案顾问', at: ago(150), text: '已签约，下周安排测量深化。'}],
      shares: [], applications: [], history: []},
  ];
}
export const lastEvent = lead => [...lead.events].sort((a, b) => b.at - a.at)[0];
export const needsAction = lead => ({
  review: lead.status === 'review',
  assist: lead.status === 'assist',
  contact: lead.events.some(e => e.kind === 'contact') && lead.follow === 'new',
  apply: lead.applications.some(a => a.status === 'pending'),
});
