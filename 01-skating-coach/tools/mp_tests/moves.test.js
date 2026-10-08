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
store.saveMoves([{ id: 'mv_out', name: '外勾步', category: 'step', drills: [] }]);
const m5 = store.mergeMoveLibraries(store.ensureMoves(), [{ id: 'mv_out', name: '外勾步', category: 'step', drills: [{ id: 'zz', name: '另一种组合' }] }]);
ok(m5.moves[0].drills.length === 1 && m5.moves[0].drills[0].name === '另一种组合',
   '同 id 的动作：云端多出来的组合被并进来了');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：动作库的组合不会再被合并吃掉');
process.exit(fail ? 1 : 0);
