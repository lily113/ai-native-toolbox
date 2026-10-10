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

console.log('⑤ A 卡（阶段报告）：钩子句 + 这个月练了什么');
const today = store.todayKey(), ym = today.slice(0, 7);
store.saveMoves([
  { id: 'a1', name: '转三', category: 'step', drills: [] },
  { id: 'a2', name: '乔克塔步', category: 'step', drills: [] },
  { id: 'a3', name: '新动作甲', category: 'step', drills: [] }
]);
const r2 = (id, date, mv) => ({ id: id, date: date, type: 'ice', mode: 'self', duration: 90, content: '', moves: mv, drills: [], examPicks: [], itemOrder: [] });
store.saveRecords([
  r2('m1', ym + '-02', ['a1']), r2('m2', ym + '-03', ['a1']), r2('m3', ym + '-04', ['a1']),
  r2('m4', ym + '-05', ['a2']),
  r2('m5', ym + '-06', ['a3']),
  r2('m6', '2026-06-01', ['a2'])
]);
const freeIdx = store.ensureExams().filter(e => e.key === 'free-4')[0];
store.saveExams(store.ensureExams().map(e => e.key === 'free-4' ? Object.assign({}, e, { star: true, date: '2026-11-01' }) : e));
const md = sc.monthCardData(ym, {});
ok(md.count === 5 && md.days === 5, '本月 5 次训练、5 天上冰（按天去重）');
ok(md.trend.length === 12 && md.trend[11].current === true, '近 12 个月趋势、最后一个是当月');
const byName = {};
md.actions.forEach(a => { byName[a.name] = a; });
ok(byName['转三'] && byName['转三'].isNew === true, '「转三」这个月第一次练 → 标记为新学');
ok(byName['乔克塔步'] && byName['乔克塔步'].pickedBack === true, '「乔克塔步」之前 6 月练过、这个月又练 → 标记为捡回来');
ok(byName['新动作甲'] && byName['新动作甲'].n === 1, '新动作甲 1 次');
ok(byName['转三'].n === 3 && md.actions[0].name === '转三', '按次数排序，练得多的在前');
ok(md.hooks[0].indexOf('还有') > -1, '钩子第一优先是考级倒计时：' + md.hooks[0]);
ok(md.hooks.some(h => h.indexOf('捡回来了') > -1) && md.hooks.some(h => h.indexOf('新学了') > -1),
   '钩子里同时有"新学"和"捡回来"：' + md.hooks.join('｜'));
ok(md.hooks.length <= 3, '最多给 3 个候选句子（实际 ' + md.hooks.length + '）');
ok(md.minutes === 0, '默认不显示时长');
ok(sc.monthCardData(ym, { withDuration: true }).minutes === 450, '开关打开 → 本月 450 分钟');
ok(!('累计' in md) && JSON.stringify(md).indexOf('累计') < 0, 'A 卡数据里没有任何"累计"字段');
const mdHook = sc.monthCardData(ym, { hook: '我自己挑的一句话' });
ok(mdHook.hook === '我自己挑的一句话', '用户挑的句子会覆盖默认钩子');

console.log('⑥ A 卡版式：不越界、柱状数字不再压标题');
const ops2 = [];
const ctx2 = {
  font: '', fillStyle: '', textAlign: 'left',
  measureText: s2 => ({ width: String(s2).length * 13 }),
  fillText: (t, x, y) => ops2.push({ t: String(t), y: Math.round(y) }),
  fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, arcTo: () => {},
  closePath: () => {}, fill: () => {}, stroke: () => {}, scale: () => {}
};
sc.drawMonthCard(ctx2, Object.assign({}, md, { hook: md.hooks[0] }));
const maxY = Math.max.apply(null, ops2.map(o => o.y));
ok(maxY < sc.CARD_H, '所有内容都在 ' + sc.CARD_H + ' 高度内（最低 y=' + maxY + '）');
const titleOp = ops2.filter(o => o.t.indexOf('近 12 个月次数') === 0)[0];
const hit = ops2.filter(o => o.y > titleOp.y && o.y < titleOp.y + 20);
ok(hit.length === 0, '标题下方 20px 内没有任何其他文字（柱状数字不再撞标题，之前的 bug）');
ok(ops2.some(o => o.t.indexOf('花样滑冰训练') === 0), '底部有水印');

console.log('⑦ 回顾页入口：多个钩子时先让用户挑一句');
let sheet = null, drew = 0;
global.wx.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: cb => cb([{ node: { width: 0, height: 0, getContext: () => ctx2 } }]) }) }) });
global.wx.showActionSheet = o => { sheet = o.itemList; if (o.success) o.success({ tapIndex: 1 }); };
global.wx.canvasToTempFilePath = o => { drew++; if (o.success) o.success({ tempFilePath: '/tmp/a.png' }); };
let cap2 = null; global.Page = o => { cap2 = o; };
delete require.cache[require.resolve(MP + '/pages/review/review.js')];
require(MP + '/pages/review/review.js');
const rv = Object.create(null); Object.keys(cap2).forEach(k => { rv[k] = cap2[k]; });
rv.data = JSON.parse(JSON.stringify(cap2.data || {})); rv.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
rv.onLoad();
rv.makeReport();
ok(sheet && sheet.length === 3, '弹出 3 个候选句子让用户挑：' + JSON.stringify(sheet));
ok(drew === 1, '挑完就生成（导出被调用 ' + drew + ' 次）');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：分享卡只放过程、不放隐私，版式不越界');
process.exit(fail ? 1 : 0);
