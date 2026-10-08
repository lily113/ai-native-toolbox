// 运行：node tools/mp_tests/moves.test.js
// 动作库回归自测：组合**绝对不能**在合并/去重/导入/拉取时被丢掉。
// 起因：用户反馈「外勾步下面的组合没有了」——
//   ① 同名动作有两条（不同 id）时，旧代码"只留第一条、其余丢掉"，被丢掉那条的组合一起没了；
//   ② 同 id 的动作，导入/拉取时"整条选一边"，备份里更全的组合被跳过；
//   ③ 丢掉的 id 还被历史记录引用着（记录里结构断链）。
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

const mem = {};
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'ios' }),
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {},
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'OME' } }), database: () => ({ collection: () => ({}) }) }
};
global.getApp = () => ({ globalData: { openid: 'OME' } });

const store = require(MP + '/utils/store');
const util = require(MP + '/utils/util');
const K = store.KEYS;

const COMBO = '前外转三＋后压步＋后外乔克塔＋前内外勾';
// 本机：外勾步存在，但组合被吃掉了（用户现在的状态）
store.saveMoves([
  { id: 'mv_out', name: '外勾步', category: 'step', sort: 0, c: 10, points: ['共性要点'], drills: [] },
  { id: 'mv_in', name: '内勾步', category: 'step', sort: 1, c: 11, drills: [] }
]);
// 备份（比如你 10-08 的导出）：同一个动作，但带着组合；id 与本机不同（历史遗留）
const backupPayload = {
  moves: [
    { id: 'mv_out_old', name: '外勾步', category: 'step', sort: 0, c: 5, drills: [{ id: 'dr_combo', name: COMBO, c: 1 }] },
    { id: 'mv_in_old', name: '内勾步', category: 'step', sort: 1, c: 6, drills: [{ id: 'dr_in', name: '前内勾步', c: 1 }] }
  ],
  records: [],
  templates: [], milestones: [], cats: [], exams: []
};
// 记录里引用的是"被并掉那条"的动作 id 和组合 id（断链的元凶）
store.saveRecords([{
  id: 'rec1', date: '2026-09-19', type: 'ice', mode: 'self', duration: 90,
  content: '【外勾步】' + COMBO + '\n【内勾步】前内勾步',
  moves: ['mv_out_old', 'mv_in_old'], drills: ['dr_combo', 'dr_in'],
  itemOrder: ['m:mv_out_old::d:dr_combo', 'm:mv_in_old::d:dr_in'], examPicks: []
}]);

console.log('① 导入备份：同 id / 同名动作都要把组合并进来（不是整条跳过）');
util.applyPayload(backupPayload);
let moves = store.ensureMoves();
let out = moves.filter(m => m.name === '外勾步');
ok(out.length === 1, '外勾步只有一条（重名被合并，实际 ' + out.length + ' 条）');
ok((out[0].drills || []).length === 1 && out[0].drills[0].name === COMBO,
   '外勾步的组合回来了：' + (out[0].drills || []).map(d => d.name).join('/'));
const inn = moves.filter(m => m.name === '内勾步')[0];
ok(inn && inn.drills.length === 1, '内勾步的组合也在（' + (inn.drills || []).map(d => d.name).join('/') + '）');
ok(out[0].points.length === 1, '动作级要点也没丢');

console.log('② 历史记录的引用改指到留下的那条（不断链）');
const rec = store.loadRecords()[0];
const keptMoveIds = moves.map(m => m.id);
ok(rec.moves.every(id => keptMoveIds.indexOf(id) > -1), '记录里的动作 id 都还存在：' + rec.moves.join(','));
const keptDrillIds = [];
moves.forEach(m => (m.drills || []).forEach(d => keptDrillIds.push(d.id)));
ok(rec.drills.every(id => keptDrillIds.indexOf(id) > -1), '记录里的组合 id 都还存在：' + rec.drills.join(','));
ok(rec.itemOrder.every(k => {
  const mm = /^m:([^:]+)(?:::d:(.+))?$/.exec(String(k));
  if (!mm) return true;
  if (keptMoveIds.indexOf(mm[1]) < 0) return false;
  return !mm[2] || keptDrillIds.indexOf(mm[2]) > -1;
}), 'itemOrder 里的引用也改过来了：' + rec.itemOrder.join(' , '));
// 用真正给首页卡片用的函数验证：结构化条目行能不能把组合渲染出来
const recNow = store.loadRecords()[0];
const lines = store.recordLines(recNow, () => '');
const texts = lines.map(l => l.text).join(' | ');
ok(store.moveById(recNow.moves[0]) && store.drillById(recNow.drills[0]) !== null,
   'moveById / drillById 都能查到（不再断链）');
ok(/前外转三＋后压步＋后外乔克塔＋前内外勾/.test(texts),
   '首页卡片的结构化条目行里带着这个组合：' + texts.slice(0, 60));

console.log('③ 反复加载/重复导入不会让组合越变越少，也不会写盘空转');
const beforeCounts = JSON.stringify(store.ensureMoves().map(m => [m.name, (m.drills || []).length]));
const beforeStore = JSON.stringify(mem[K.moves]);
for (let i = 0; i < 3; i++) store.ensureMoves();
ok(JSON.stringify(store.ensureMoves().map(m => [m.name, (m.drills || []).length])) === beforeCounts,
   '连续 ensureMoves() 结果稳定不变');
ok(JSON.stringify(mem[K.moves]) === beforeStore, '没有实际变化时不写盘（否则会空转触发自动上传）');

console.log('④ 同名同 id 两份数据：组合取并集（不会"选一边"丢掉组合）');
const r = store.mergeMoveLibraries(
  [{ id: 'x', name: '转三', category: 'step', drills: [{ id: 'd1', name: '前外转三' }] }],
  [{ id: 'x', name: '转三', category: 'step', drills: [{ id: 'd2', name: '后外转三' }, { id: 'd1b', name: '前外转三' }] }]
);
ok(r.moves.length === 1 && r.moves[0].drills.length === 2,
   '并成 2 个组合：' + r.moves[0].drills.map(d => d.name).join('/'));
ok(r.drillMap['d1b'] === 'd1', '同一个组合名字对应两套 id → 映射到保留的那个（' + JSON.stringify(r.drillMap) + '）');

console.log('⑥ 修复工具的数据来源取对了（升级前快照是 { version, at, payload:{...} }）');
const setJs = fs.readFileSync(MP + '/pages/settings/settings.js', 'utf8');
ok(/repairMoves\s*\(/.test(setJs) && /snap\.payload && snap\.payload\.moves/.test(setJs),
   '🔧 修复动作库：升级前快照从 payload.moves 取（否则那份数据会被悄悄跳过）');
ok(/store\.mergeMoveLibraries/.test(setJs) && /sync\.listHistory/.test(setJs),
   '还会翻云端历史快照一起合并');

console.log('⑤ 拉取（云端）也走深合并：云端那份组合更全时能补回本机');
const cfgK = 'planner_sync_meta_v1';
mem[cfgK] = { auto: false, seenTs: 0, lastEdit: 0 };
store.saveMoves(store.ensureMoves().map(m => m.id === 'mv_out' ? Object.assign({}, m, { drills: [] }) : m));
const m5 = store.mergeMoveLibraries(store.ensureMoves(), [{ id: 'mv_out', name: '外勾步', category: 'step', drills: [{ id: 'zz', name: '另一种组合' }] }]);
ok(m5.moves[0].drills.length === 1 && m5.moves[0].drills[0].name === '另一种组合',
   '同 id 的动作：云端多出来的组合被并进来了');

console.log('⑦ 改动作名称：id 不变，历史记录、卡片都不受影响');
const before = store.ensureMoves().filter(m => m.name === '内勾步')[0];
const ro = store.renameMove(before.id, '内勾步（改）');
ok(ro.ok && ro.name === '内勾步（改）', '改名成功：' + JSON.stringify(ro));
const after = store.ensureMoves().filter(m => m.id === before.id)[0];
ok(after && after.name === '内勾步（改）', '同一 id 上新名字生效');
ok(after.drills.length === 1, '改名不影响它的组合（' + after.drills.map(d => d.name).join('/') + '）');
ok(store.loadRecords()[0].moves.indexOf(before.id) > -1, '记录里的动作引用还是这个 id');
// 只有一个组合的动作，卡片是"动作名 + 组合同一行"（kind: one），所以名字在 l.name 上
const cardTxt0 = store.recordLines(store.loadRecords()[0], () => '').map(l => (l.text || '') + ' ' + (l.name || '')).join('|');
ok(cardTxt0.indexOf('内勾步（改）') > -1, '首页卡片显示的是新名字：' + cardTxt0);
ok(!store.renameMove(before.id, '   ').ok, '空名字会被拒绝');
// 改成另一个已存在的动作名 → 合并，不产生两条同名
const dup = store.renameMove(before.id, '外勾步');
ok(dup.ok && dup.merged >= 1, '改成同名动作 → 自动合并（并了 ' + (dup.merged || 0) + ' 条）');
ok(store.ensureMoves().filter(m => m.name === '外勾步').length === 1, '不会出现两条同名动作');

console.log('⑧ 把组合挪到别的动作下（你的例子：变刃步伐串的 2 个组合 → 膝关节韵律练习）');
store.saveMoves([
  { id: 'mv_bianren', name: '变刃步伐串', category: 'other', sort: 0, c: 20, drills: [
    { id: 'bd1', name: '前外刃变后内刃 ×20', c: 1 }, { id: 'bd2', name: '连续变刃过桩 ×10', c: 2 }] },
  { id: 'mv_xiguan', name: '膝关节韵律练习', category: 'topic', sort: 0, c: 21, drills: [
    { id: 'kg1', name: '抱膝滑动 ×10', c: 1 }] }
]);
store.saveRecords([{
  id: 'rec_bd', date: '2026-09-26', type: 'ice', mode: 'self', duration: 90,
  content: '【变刃步伐串】前外刃变后内刃 ×20\n【变刃步伐串】连续变刃过桩 ×10',
  moves: ['mv_bianren'], drills: ['bd1', 'bd2'],
  itemOrder: ['m:mv_bianren::d:bd1', 'm:mv_bianren::d:bd2'], examPicks: []
}]);
const mo = store.moveDrillsTo(['bd1', 'bd2'], 'mv_xiguan');
ok(mo.ok && mo.moved === 2, '移动成功：' + JSON.stringify(mo));
let lib = store.ensureMoves();
let src = lib.filter(m => m.id === 'mv_bianren')[0];
let dst = lib.filter(m => m.id === 'mv_xiguan')[0];
ok(src.drills.length === 0, '原动作下的组合清空（实际 ' + src.drills.length + '）');
ok(dst.drills.length === 3, '新动作下有 3 个组合：' + dst.drills.map(d => d.name).join(' / '));
ok(dst.drills.filter(d => d.id === 'bd1' || d.id === 'bd2').length === 2, '组合 id 没变（历史记录不会断链）');
const recBd = store.loadRecords().filter(r => r.id === 'rec_bd')[0];
ok(recBd.moves.indexOf('mv_xiguan') > -1, '记录里加上了新动作的引用');
ok(recBd.moves.indexOf('mv_bianren') < 0, '旧动作的引用被去掉（记录里已经没有它的组合了）');
ok(recBd.itemOrder.every(k => k.indexOf('mv_xiguan::d:') > -1), 'itemOrder 也跟着改到新动作：' + recBd.itemOrder.join(' , '));
const card = store.recordLines(recBd, () => '');
const cardTxt = card.map(l => l.text).join(' | ');
ok(cardTxt.indexOf('膝关节韵律练习') > -1 && cardTxt.indexOf('前外刃变后内刃 ×20') > -1,
   '首页卡片把它们显示在新动作下：' + cardTxt.slice(0, 70));
ok(card.filter(l => l.text.indexOf('变刃步伐串') > -1).length === 0, '卡片上不再出现旧动作名');
ok(mo.records === 1, '报告更新了 1 条历史记录（实际 ' + mo.records + '）');
ok(!store.moveDrillsTo(['bd1'], 'mv_xiguan').ok, '重复移动同一个组合会被拒绝（目标已有）');

console.log('⑨ 页面接线：改名弹窗 / 点选组合 / 选目标动作');
let cap = null; global.Page = o => { cap = o; };
delete require.cache[require.resolve(MP + '/pages/move/move.js')];
require(MP + '/pages/move/move.js');
const pg = Object.create(null); Object.keys(cap).forEach(k => { pg[k] = cap[k]; });
pg.data = JSON.parse(JSON.stringify(cap.data || {}));
pg.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
let modalQ = null, modalContent = '';
global.wx.showModal = o => {
  modalQ = o;
  if (o && o.editable) o.success({ confirm: true, content: modalContent });
  else if (o && o.success) o.success({ confirm: true });
};
pg.onLoad({ id: 'mv_xiguan' });
pg.onShow();
ok(pg.data.name === '膝关节韵律练习' && pg.data.drills.length === 3, '打开动作页：3 个组合');
modalContent = '膝环节律练习';
pg.renameMove();
ok(modalQ && modalQ.editable === true, '点动作名弹的是可输入的名字弹窗');
ok(store.ensureMoves().filter(m => m.name === '膝环节律练习').length === 1, '页面改名落到动作库');
pg.reload();
pg.toggleDrillSel();
pg.tapDrill({ currentTarget: { dataset: { id: 'bd1' } } });
pg.tapDrill({ currentTarget: { dataset: { id: 'bd2' } } });
ok(pg.data.drillPickN === 2, '在页面上点选 2 个组合（实际 ' + pg.data.drillPickN + '）');
pg.tapDrill({ currentTarget: { dataset: { id: 'bd2' } } });
ok(pg.data.drillPickN === 1, '再点一次取消选择');
pg.tapDrill({ currentTarget: { dataset: { id: 'bd2' } } });
pg.openPick();
ok(pg.data.pickOn === true && pg.data.pickList.length > 0, '弹出目标动作列表（' + pg.data.pickList.length + ' 个可选）');
ok(pg.data.pickList.every(x => x.id !== 'mv_xiguan'), '列表里不含自己');
pg.doMoveDrill({ currentTarget: { dataset: { id: 'mv_bianren' } } });
lib = store.ensureMoves();
ok(lib.filter(m => m.id === 'mv_bianren')[0].drills.length === 2, '页面操作把 2 个组合移回了「变刃步伐串」');
ok(pg.data.pickOn === false && pg.data.drillSelOn === false, '移完自动退出选择模式');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：动作库的组合不会再被合并吃掉');
process.exit(fail ? 1 : 0);
