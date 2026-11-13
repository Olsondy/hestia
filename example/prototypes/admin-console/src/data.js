// 平台管理后台原型（AM-P）的演示数据：供应商、地址、模型与企业都是中性示例，不代表已接入或推荐任何供应商。
// 金额以分为单位的整数，展示时换算为元（与 ADR-0018 一致）。

export const admin = {name: '运维甲', email: 'ops@hestia.example', password: 'demo-password'};

export const protocols = {
  chat: {name: 'OpenAI Chat Completions', short: 'Chat Completions', path: '/chat/completions', hint: '大多数国内与第三方模型服务'},
  responses: {name: 'OpenAI Responses', short: 'Responses', path: '/responses', hint: 'OpenAI 及兼容 Responses 接口的服务'},
  anthropic: {name: 'Anthropic Messages', short: 'Anthropic Messages', path: '/v1/messages', hint: 'Anthropic 及兼容其接口的服务'},
};

// 接入检查的项目；每项结果：ok / fail / unsupported / todo
export const checkItems = [
  ['connect', '连通与鉴权'], ['stream', '流式输出'], ['tools', '工具调用'], ['toolStream', '工具参数流式返回'],
  ['protocol', 'Hestia 协议样本（3 条合成样本）'], ['usage', '返回用量（token）'],
];
const passed = {connect: 'ok', stream: 'ok', tools: 'ok', toolStream: 'ok', protocol: 'ok', usage: 'ok'};

const day = (d, h = 10, m = 0) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, m, 0, 0); return t.getTime(); };

// 模型服务：一组接口地址 + 密钥（+ 协议级兼容设置）。连通测试、获取模型列表都按服务进行。
export function seedServices() {
  return [
    {id: 's1', name: '示例供应商甲', protocol: 'chat', baseUrl: 'https://api.vendor-a.example/v1', keyTail: '3f9a', timeout: 120, concurrency: 16,
      compat: {usageInStream: true, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking'},
      ping: {at: day(0, 9, 40), ok: true, ms: 860}, catalog: {at: day(11, 10, 12), ids: ['design-large', 'edit-fast', 'design-v1', 'vision-plus', 'embed-small']}},
    {id: 's2', name: '示例供应商乙', protocol: 'anthropic', baseUrl: 'https://api.vendor-b.example', keyTail: 'k7Qe', timeout: 120, concurrency: 4,
      compat: {apiVersion: '2023-06-01'}, ping: {at: day(0, 9, 40), ok: true, ms: 1180}, catalog: {at: day(20, 14, 50), ids: ['context-pro', 'context-lite']}},
    {id: 's3', name: '示例供应商丙', protocol: 'responses', baseUrl: 'https://gateway.vendor-c.example/v1', keyTail: 'x81D', timeout: 60, concurrency: 4,
      compat: {store: false}, ping: null, catalog: {at: day(1, 16, 30), unsupported: true, code: 'HTTP 404', ids: []}},
  ];
}

// 模型：服务里启用的一个模型 ID。显示名称、单价、调用参数与接入检查都按模型 ID 分别设置。
export function seedModels() {
  return [
    {id: 'm1', service: 's1', modelId: 'design-large', name: '深度设计', description: '整套方案、跨房间取舍时用；速度较慢。', maxOutput: 8000, params: {thinking: 'on'},
      prices: [{from: day(41), input: 400, output: 1600}, {from: day(11), input: 320, output: 1280}], state: 'admitted',
      check: {at: day(11, 10, 24), by: '运维甲', seconds: 18, results: passed}},
    {id: 'm2', service: 's1', modelId: 'edit-fast', name: '快速修改', description: '换石材、改铺法等明确的局部修改；响应快。', maxOutput: 2000, params: {thinking: 'off'},
      prices: [{from: day(41), input: 80, output: 200}], state: 'admitted', check: {at: day(11, 10, 31), by: '运维甲', seconds: 9, results: passed}},
    {id: 'm3', service: 's2', modelId: 'context-pro', name: '长上下文', description: '资料多、需求反复修改的复杂项目。', maxOutput: 8000, params: {thinking: true, thinkingBudget: 4000},
      prices: [{from: day(20), input: 2100, output: 10500}], state: 'admitted', check: {at: day(20, 15, 2), by: '运维甲', seconds: 24, results: passed}},
    {id: 'm4', service: 's3', modelId: 'reason-mini', manual: true, name: '推理增强', description: '试接入，尚未分配给企业。', maxOutput: 4000, params: {reasoning: 'medium'},
      prices: [{from: day(1), input: 110, output: 440}], state: 'failed',
      check: {at: day(1, 16, 40), by: '运维甲', seconds: 12, results: {connect: 'ok', stream: 'ok', tools: 'fail', toolStream: 'todo', protocol: 'todo', usage: 'ok'},
        failure: '工具调用：模型没有返回工具调用（结束原因为 stop），Hestia 的 Agent 无法使用这个模型。'}},
    {id: 'm5', service: 's1', modelId: 'design-v1', name: '旧版设计模型', description: '已被「深度设计」替代。', maxOutput: 4000, params: {thinking: 'unset'},
      prices: [{from: day(70), input: 400, output: 1600}], state: 'disabled', check: {at: day(70, 9, 0), by: '运维甲', seconds: 21, results: {...passed, usage: 'unsupported'}}},
  ];
}

// 演示结果。测试连通：用已存密钥发一次最小请求；获取模型列表：读服务商的模型清单（GET /models 或 /v1/models）。
export const pingOutcome = {
  s1: {ok: true, ms: 920}, s2: {ok: false, code: '超时', reason: '20 秒内没有响应，服务商可能在限流或故障'}, s3: {ok: true, ms: 640},
};
export const fetchOutcome = {
  s1: {ids: ['design-large', 'design-large-2511', 'edit-fast', 'design-v1', 'vision-plus', 'embed-small']},
  s2: {ids: ['context-pro', 'context-lite', 'context-max']},
  s3: {unsupported: true, code: 'HTTP 404'},
};

export function seedWorkspaces() {
  return [
    {slug: 'demo-home', name: '演示家装企业', domain: 'a.hestia.example', quota: 300000, used: 128450, reserved: 1200, concurrency: 3,
      grants: {m1: {enabled: true, default: true}, m2: {enabled: true}, m3: {enabled: false}}},
    {slug: 'demo-home-b', name: '演示家装企业乙', domain: 'b.hestia.example', quota: 100000, used: 100000, reserved: 0, concurrency: 2,
      grants: {m1: {enabled: true, default: true}, m2: {enabled: true}}},
    {slug: 'demo-home-c', name: '演示家装企业丙', domain: 'c.hestia.example', quota: 0, used: 0, reserved: 0, concurrency: 2, grants: {}},
  ];
}

// 按月、企业、模型汇总的调用记录（演示）。unknown：供应商未返回用量、按预占额计入的调用数。
export const months = ['2026-11', '2026-10', '2026-09'];
export const usage = {
  '2026-11': [
    {ws: 'demo-home', model: 'm1', calls: 412, input: 9_812_400, output: 1_204_300, cost: 47812, unknown: 0},
    {ws: 'demo-home', model: 'm2', calls: 1_386, input: 6_402_100, output: 410_800, cost: 5944, unknown: 2},
    {ws: 'demo-home', model: 'm3', calls: 96, input: 3_120_000, output: 240_500, cost: 74694, unknown: 0},
    {ws: 'demo-home-b', model: 'm1', calls: 688, input: 16_890_200, output: 2_102_700, cost: 80955, unknown: 1},
    {ws: 'demo-home-b', model: 'm2', calls: 1_734, input: 7_950_300, output: 512_600, cost: 7385, unknown: 0},
  ],
  '2026-10': [
    {ws: 'demo-home', model: 'm5', calls: 803, input: 18_204_000, output: 2_390_100, cost: 111058, unknown: 37},
    {ws: 'demo-home', model: 'm2', calls: 940, input: 4_310_500, output: 280_200, cost: 4009, unknown: 0},
    {ws: 'demo-home-b', model: 'm5', calls: 312, input: 7_002_000, output: 905_600, cost: 42498, unknown: 12},
  ],
  '2026-09': [],
};
export const memberUsage = [
  {name: '演示方案顾问', calls: 1_102, input: 11_204_300, output: 1_002_100, cost: 78210},
  {name: '设计师乙', calls: 640, input: 6_830_200, output: 702_400, cost: 44960},
  {name: '设计师丙', calls: 152, input: 1_300_000, output: 151_100, cost: 5280},
];

export function seedAudit() {
  return [
    {at: day(0, 9, 12), who: '运维甲', action: '调整额度', target: '演示家装企业', text: '月度额度 ¥2,000.00 → ¥3,000.00'},
    {at: day(1, 16, 40), who: '运维甲', action: '接入检查', target: '推理增强', text: '未通过：工具调用'},
    {at: day(1, 16, 31), who: '运维甲', action: '启用模型 ID', target: '示例供应商丙', text: 'reason-mini（手动添加）'},
    {at: day(1, 16, 30), who: '运维甲', action: '获取模型列表', target: '示例供应商丙', text: '失败：HTTP 404'},
    {at: day(11, 10, 31), who: '运维甲', action: '接入检查', target: '快速修改', text: '通过'},
    {at: day(11, 10, 26), who: '运维甲', action: '修改单价', target: '深度设计', text: '输入 ¥4.00 → ¥3.20、输出 ¥16.00 → ¥12.80（元 / 百万 token），从下一次调用起生效'},
    {at: day(11, 10, 20), who: '运维甲', action: '更换密钥', target: '示例供应商甲', text: '密钥已更换（末四位 3f9a）'},
    {at: day(12, 14, 0), who: '运维甲', action: '停用模型', target: '旧版设计模型', text: '2 家企业受影响'},
    {at: day(20, 15, 2), who: '运维甲', action: '接入检查', target: '长上下文', text: '通过'},
    {at: day(20, 14, 40), who: '运维甲', action: '分配模型', target: '演示家装企业', text: '新增：长上下文'},
  ];
}
