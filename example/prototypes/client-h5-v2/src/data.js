// H5 客户端 v2 原型的演示数据：与后台真实出图一致的示例别墅三个方案；中性命名，示意素材。
import img1 from '../../client-h5-styles/assets/scheme-1.jpg';
import img2 from '../../client-h5-styles/assets/scheme-2.jpg';
import img3 from '../../client-h5-styles/assets/scheme-3.jpg';
import aerial from '../../client-h5-styles/assets/aerial.jpg';
export {softStyles} from '../../client-h5/src/data.js';

export const images = {aerial, schemes: [img1, img2, img3]};
export const workspace = {name: '演示家装企业', tagline: '石材铺贴 · 全屋软装 · 一站式家装'};

// 企业石材库（示意素材）。tex 为程序生成贴图的配方名。
export const stones = [
  {id: 'white', name: '白色细纹大理石', surface: '抛光', tex: 'yashi'},
  {id: 'beige', name: '米黄大理石', surface: '抛光', tex: 'shaanna'},
  {id: 'wood', name: '灰色木纹石', surface: '哑光', tex: 'huimu'},
  {id: 'lime', name: '浅米灰石灰石', surface: '哑光', tex: 'yudu'},
  {id: 'gold', name: '深色金脉石', surface: '抛光', tex: 'heijin'},
];
export const stoneById = Object.fromEntries(stones.map(s => [s.id, s]));
export const sizes = ['600×600', '800×800', '1200×1200', '1200×600', '600×200'];
export const patterns = [['straight', '直铺'], ['running', '工字'], ['herringbone', '人字'], ['diagonal', '斜铺']];
export const patternName = Object.fromEntries(patterns);

// 示例别墅一层的可铺贴饰面（示意尺寸）。
export const finishes = [
  {id: 'living', name: '客厅地面', kind: 'floor', size: '5.8 × 6.8 m'},
  {id: 'dining', name: '餐厅地面', kind: 'floor', size: '4.2 × 4.2 m'},
  {id: 'hall', name: '楼梯过厅地面', kind: 'floor', size: '整间'},
  {id: 'tv', name: '客厅电视背景墙', kind: 'wall', size: '宽 2.9 m'},
  {id: 'stair', name: '一层至二层楼梯踏面', kind: 'stair', size: '踏步与平台'},
];

// 规则生成的三个整体方案（硬装 + 默认软装风格）。
export function makeSchemes() {
  return [
    {id: 'A', name: '留白', line: '大板直铺，深色波打线收边', soft: 'modern', img: 0,
      floor: {stone: 'white', size: '1200×1200', pattern: 'straight', border: 'gold'}, wall: {stone: 'white', size: '1200×600', pattern: 'running'}},
    {id: 'B', name: '暖调', line: '方砖斜铺，柔和过渡', soft: 'luxury', img: 1,
      floor: {stone: 'beige', size: '800×800', pattern: 'diagonal', border: null}, wall: {stone: 'beige', size: '1200×600', pattern: 'running'}},
    {id: 'C', name: '肌理', line: '条板人字铺，纹理有方向感', soft: 'chinese', img: 2,
      floor: {stone: 'wood', size: '600×200', pattern: 'herringbone', border: null}, wall: {stone: 'wood', size: '1200×600', pattern: 'running'}},
  ];
}
// 校验：人字铺只能用条板；大板直铺在过厅出现窄条提示。只做演示用的确定性判断。
export function checks(floor) {
  const out = [];
  const strip = floor.size === '600×200';
  if (floor.pattern === 'herringbone' && !strip) out.push({level: 'conflict', text: `人字铺需要条板规格，${floor.size} 排不出人字。请改用 600×200，或换一种铺法。`});
  if (floor.pattern !== 'herringbone' && strip) out.push({level: 'conflict', text: '600×200 条板只用于人字铺。请换规格，或改为人字铺。'});
  if (!out.length && floor.size === '1200×1200' && floor.pattern === 'straight') out.push({level: 'hint', text: '客厅南北向靠墙约 20 cm 会出现窄条，可改为起铺点居中或换 800×800。'});
  return out;
}
export const shares = {
  direct: {token: 'direct', mode: 'phone', phone: '13800138000', status: 'active', expires: '2026-12-02', title: '临水别墅 · 企业预置方案'},
  code: {token: 'code', mode: 'code', code: 'K7M2Q9', status: 'active', expires: '2026-12-02', title: '山景别墅 · 企业预置方案'},
  revoked: {token: 'revoked', mode: 'phone', phone: '13800138000', status: 'revoked', expires: '2026-12-02', title: '临水别墅 · 企业预置方案'},
  expired: {token: 'expired', mode: 'code', code: 'K7M2Q9', status: 'expired', expires: '2026-10-20', title: '山景别墅 · 企业预置方案'},
};
export const demoPhone = '13800138000';
export const maskPhone = p => (p ? `${p.slice(0, 3)} **** ${p.slice(7)}` : '');
export const spaced = p => p.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3');
