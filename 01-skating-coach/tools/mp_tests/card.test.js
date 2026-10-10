// 运行：node tools/mp_tests/card.test.js
// 分享卡自测：① 隐私口径（时长/教练名默认不上图，累计类永不上图）
//            ② 内容拆分（自动生成的动作行 vs 教练说的/我写的）
//            ③ 版式（不越界、卡片底在文字之前画——这条抓过一次真 bug）
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

const mem = {};
let clip = '', savedPath = '', previewed = 0, modals = [];
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'ios', pixelRatio: 2 }),
  showToast: () => {}, showModal: o => { modals.push(o && o.title); }, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: o => { clip = o.data; },
  previewImage: () => { previewed++; },
  saveImageToPhotosAlbum: o => { savedPath = o.filePath; if (o.success) o.success({}); },
  canvasToTempFilePath: o => { if (o.success) o.success({ tempFilePath: '/tmp/card.png' }); },
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'OME' } }), database: () => ({ collection: () => ({}) }) }
};
global.getApp = () => ({ globalData: { openid: 'OME' } });

const store = require(MP + '/utils/store');
const sc = require(MP + '/utils/sharecard');
store.cats();
store.saveMoves([
  { id: 'm1', name: '转三', category: 'step', drills: [{ id: 'd1', name: '前外转三' }, { id: 'd2', name: '后外转三' }] },
  { id: 'm2', name: '燕式步', category: 'step', drills: [{ id: 'd3', name: '燕式接浮足' }] }
]);
const free4 = store.ensureExams().filter(e => e.key === 'free-4')[0];
store.saveExams(store.ensureExams().map(e => e.key === 'free-4' ? Object.assign({}, e, { date: '2026-11-01' }) : e));
const rec = {
  id: 'r1', date: '2026-10-08', type: 'ice', mode: 'lesson', duration: 120, coach: '张教练', units: 2,
  content: '【转三】前外转三\n转3前三拍稳住，别急着转体\n　1. 组合序号行\n贴脚，不降速\n【燕式步】燕式接浮足\n压步要贴脚',
  moves: ['m1', 'm2'], drills: ['d1', 'd3'], examPicks: [free4.id], itemOrder: []
};

console.log('① 隐私口径：默认不放时长和教练名');
const d0 = sc.recordCardData(rec, {});
ok(d0.duration === 0 && d0.coach === '', '默认调用（不传开关）→ 时长和教练名都是空的');
const d1 = sc.recordCardData(rec, { withDuration: false, withCoach: false });
ok(d1.duration === 0 && d1.coach === '', '显式关掉 → 依然不出现');
const d2 = sc.recordCardData(rec, { withDuration: true, withCoach: true });
ok(d2.duration === 120 && d2.coach === '张教练', '开关打开才带出来（时长 120、教练 张教练）');
ok(sc.NO_SHARE.indexOf('累计上冰') > -1, '代码里明确列了"累计类不上图"的清单：' + sc.NO_SHARE.join('/'));
// 只看"代码"，注释里提到这些词是故意写的口径说明
// 只看"代码"，并且把 NO_SHARE 那个清单本身也排掉：注释里的口径说明是故意写的
const scCode = fs.readFileSync(MP + '/utils/sharecard.js', 'utf8')
  .split('\n')
  .map(l => l.replace(/\/\/.*$/, ''))
  .filter(l => l.indexOf('NO_SHARE') < 0)
  .join('\n');
ok(!/累计上冰|累计上课|累计节数/.test(scCode), '除 NO_SHARE 清单外，绘制代码里没有任何累计类字段');

console.log('② 内容拆分：动作已经用标签呈现，文字区只留"教练说的/我写的"');
ok(d1.actions.length === 2 && d1.actions[0].drills.length === 1, '动作 2 个、带了组合数：' + JSON.stringify(d1.actions));
ok(d1.notes.join('|').indexOf('【转三】') < 0, '自动生成的动作行不在文字区');
ok(d1.notes.join('|').indexOf('组合序号行') < 0, '组合序号行也不在文字区');
ok(d1.notes.length === 3 && d1.notes[0].indexOf('转3前三拍') === 0, '留下的正好是三条自己的话：' + d1.notes.join(' / '));
ok(d1.exam === '自由滑 · 四级' && /还有 \d+ 天/.test(d1.examCd), '带考级和倒计时：' + d1.examCd);
ok(sc.weekdayCn('2026-10-08') === '周四', '星期算对了：' + sc.weekdayCn('2026-10-08'));

console.log('③ 版式：不越界 + 卡片底必须画在文字之前');
const ops = [];
const ctx = {
  font: '', fillStyle: '', textAlign: 'left',
  measureText: s => ({ width: String(s).length * 14 }),
  fillText: (t) => ops.push({ op: 'text', t: String(t).slice(0, 16), y: 0 }),
  fillRect: () => ops.push({ op: 'bg' }),
  beginPath: () => ops.push({ op: 'path' }),
  moveTo: () => {}, arcTo: () => {}, closePath: () => {},
  fill: () => ops.push({ op: 'fill' }),
  stroke: () => {}, scale: () => {}
};
sc.drawTrainingCard(ctx, d1);
const fills = ops.map((o, i) => o.op === 'fill' ? i : -1).filter(i => i >= 0);
const texts = ops.map((o, i) => o.op === 'text' ? i : -1).filter(i => i >= 0);
ok(fills.length >= 3, '画了底板 + 至少两张卡片（fill 次数 ' + fills.length + '）');
// 每一段文字之前，必须已经有一次卡片填充（不然文字会被后画的底盖住 —— 这个 bug 真出现过）
const noteIdx = ops.findIndex(o => o.op === 'text' && o.t.indexOf('教练说的') === 0);
const chipIdx = ops.findIndex(o => o.op === 'text' && o.t.indexOf('转三 · 1 组') === 0);
ok(fills.filter(i => i < chipIdx).length >= 2, '动作标签之前已经有卡片底（底先画）');
ok(fills.filter(i => i < noteIdx).length >= 3, '笔记文字之前已经有卡片底（底先画）');
ok(fills.filter(i => i > noteIdx).length === 0, '笔记文字之后再没有填充（不会被盖住）');

console.log('④ 导出流程：存相册 + 可转发');
const fakeCtx = { scale: () => {}, fillRect: () => {}, fillText: () => {}, measureText: s => ({ width: 10 }), beginPath: () => {}, moveTo: () => {}, arcTo: () => {}, closePath: () => {}, fill: () => {}, stroke: () => {} };
const fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx };
global.wx.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: cb => cb([{ node: fakeCanvas }]) }) }) });
sc.exportImage({ selector: '#shareCanvas' }, (ctx2) => sc.drawTrainingCard(ctx2, d1));
ok(savedPath === '/tmp/card.png', '导出后存进相册：' + savedPath);
ok(previewed === 1, '同时调了转发/预览（没有 showShareImageMenu 时走预览）');
ok(fakeCanvas.width === sc.CARD_W * 2 && fakeCanvas.height === sc.CARD_H * 2,
   '画布按 dpr 放大成 ' + fakeCanvas.width + '×' + fakeCanvas.height + '（导出正好 1080×1440，3:4）');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：分享卡只放过程、不放隐私，版式不越界');
process.exit(fail ? 1 : 0);
