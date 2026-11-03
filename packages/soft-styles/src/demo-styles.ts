import { softStyleSchema, type SoftStyle } from '../../contracts/src/soft-styles';

// 演示软装风格（示意素材，不含真实品牌）：现代简约、轻奢、新中式。与 H5 演示数据的名称、描述与色块一致。
// 换款只在原家具占地内进行；补充陈设由 furnish() 按规则放置并校验。
const lamp = { key: 'floorLamp', width: .38, depth: .38, height: 1.6, place: 'beside' as const };
const plant = { key: 'bigPlant', width: .55, depth: .55, height: 1.3, place: 'corner' as const };
const art = (width: number, height: number) => ({ key: 'wallArt', width, depth: .04, height, place: 'wall' as const });

export const demoSoftStyles: SoftStyle[] = [
  {
    id: 'demo-modern', version: 1, name: '现代简约', line: '布艺 L 型沙发、岩板圆几、灰调地毯、线性吊灯',
    palette: ['#d8d3cb', '#2f2c2a', '#b49c86', '#c7c0b6'],
    tones: { fabric: '#8f8b85', cushion: '#c9c4bc', wood: '#c2a07c', darkWood: '#6b5444', metal: '#2f2c2a', accent: '#8c9aa1' },
    swap: { living: { coffeeTable: 'roundCoffeeTable' }, dining: {}, bedroom: {}, tea: {}, study: {} },
    extras: {
      living: [{ ...lamp, anchor: 'lSofa' }, { ...lamp, anchor: 'sofa' }, { ...art(1.4, .7), anchor: 'lSofa' }, { ...art(1.2, .6), anchor: 'sofa' }, plant],
      dining: [{ key: 'pendantLamp', width: 1.6, depth: .22, height: .9, place: 'above', anchor: 'longTable' }],
      bedroom: [{ ...art(1.2, .6), anchor: 'bed' }],
      tea: [plant], study: [plant],
    },
  },
  {
    id: 'demo-luxury', version: 1, name: '轻奢', line: '弧形丝绒沙发、大理石金属茶几、浅色长毛地毯',
    palette: ['#ece2d3', '#b08d57', '#3b3230', '#ddd1bf'],
    tones: { fabric: '#e3d6c3', cushion: '#efe6d8', wood: '#8a6a52', darkWood: '#3b3230', metal: '#b08d57', accent: '#b08d57' },
    swap: { living: { lSofa: 'curvedSofa', sofa: 'curvedSofa', coffeeTable: 'roundCoffeeTable' }, dining: { longTable: 'ovalTable' }, bedroom: {}, tea: {}, study: {} },
    extras: {
      living: [{ ...lamp, anchor: 'lSofa' }, { ...lamp, anchor: 'sofa' }, { ...art(1.6, .8), anchor: 'lSofa' }, { ...art(1.2, .7), anchor: 'sofa' }, plant],
      dining: [{ key: 'chandelier', width: 1, depth: 1, height: .9, place: 'above', anchor: 'longTable' }],
      bedroom: [{ ...art(1.4, .7), anchor: 'bed' }, { ...lamp, anchor: 'nightstand' }],
      tea: [plant], study: [plant],
    },
  },
  {
    id: 'demo-chinese', version: 1, name: '新中式', line: '实木圈椅、长条茶几、屏风、暖色地毯',
    palette: ['#e4d9c6', '#4f3324', '#6f4630', '#b39a79'],
    tones: { fabric: '#b39a79', cushion: '#e4d9c6', wood: '#8b5e3c', darkWood: '#4f3324', metal: '#6f4630', accent: '#6f4630' },
    swap: { living: { armchair: 'ringChair', lounge: 'ringChair', coffeeTable: 'teaTable' }, dining: { chair: 'ringChair' }, bedroom: { lounge: 'ringChair' }, tea: {}, study: {} },
    extras: {
      living: [{ key: 'screen', width: 1.6, depth: .3, height: 1.7, place: 'corner' }, { ...art(.8, 1.2), anchor: 'lSofa' }, { ...art(.8, 1.1), anchor: 'sofa' }, plant],
      dining: [{ key: 'lantern', width: .45, depth: .45, height: .8, place: 'above', anchor: 'longTable' }],
      bedroom: [{ ...art(.7, 1), anchor: 'bed' }],
      tea: [{ key: 'ringChair', width: .58, depth: .55, height: .9, place: 'beside', anchor: 'teaTable' }, { key: 'lantern', width: .45, depth: .45, height: .8, place: 'above', anchor: 'teaTable' },
        { key: 'screen', width: 1.6, depth: .3, height: 1.7, place: 'corner' }, plant], study: [plant],
    },
  },
].map(style => softStyleSchema.parse(style));
export const defaultDemoStyle = demoSoftStyles[0];
