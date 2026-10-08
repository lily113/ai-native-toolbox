// 运行：node tools/mp_tests/pages.test.js
// 回归自测：页面级逻辑（moves 批量整理 / record 串组勾选）
const path = require('path');
const fs = require('fs');
// 本地开发目录是 figure-skating-mp/，仓库里是 01-skating-coach/miniprogram/，两边都能跑
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];
const mem = {};
let log = [];
const calls = { actionSheet: null, modal: null, toast: [] };

global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  showToast: o => { calls.toast.push(o.title); },
  showModal: o => { calls.modal = o; if (o.success) o.success({ confirm: true, content: calls.modalContent }); },
  showActionSheet: o => {
    calls.actionSheet = o;
    const i = calls.pickIndex === undefined ? 0 : calls.pickIndex;
    if (o.success) o.success({ tapIndex: i });
  },
  navigateTo: () => {},
  setNavigationBarTitle: () => {},
  cloud: { init: () => {} }
};
let captured = null;
global.Page = o => { captured = o; };
global.getApp = () => ({ globalData: {} });

function loadPage(file) {
  delete require.cache[require.resolve(file)];
  captured = null;
  require(file);
  const def = captured;
  const p = Object.create(null);
  Object.keys(def).forEach(k => { p[k] = def[k]; });
  p.data = JSON.parse(JSON.stringify(def.data || {}));
  p.setData = function (obj, cb) { Object.assign(this.data, obj); if (cb) cb(); };
  return p;
}

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

const store = require(MP + '/utils/store');
store.cats();   // 触发迁移 + 预置动作

// ---------- moves 页 ----------
const movesPage = loadPage('/Users/chloe/dsh_workspace/figure-skating-mp/pages/moves/moves.js');
movesPage.onShow();
console.log('① moves 页刷新');
ok(movesPage.data.tabs.length === 7, '标签 = 全部 + 6 个分类：' + movesPage.data.tabs.map(t => t.name).join('/'));
ok(movesPage.data.tabs[0].k === 'all', '第一个是「全部」');
ok(movesPage.data.tabs[5].name === '专题练习', '第五个是「专题练习」');
ok(movesPage.data.list.length === movesPage.data.tabs[0].n, '列表长度与「全部」数量一致');
const topicTab = movesPage.data.tabs.filter(t => t.k === 'topic')[0];
ok(topicTab.n === 3, '专题练习有 3 个动作');

movesPage.switchTab({ currentTarget: { dataset: { k: 'topic' } } });
ok(movesPage.data.list.length === 3 && movesPage.data.list[0].catName === '专题练习', '切到专题练习分类，列表正确');

console.log('② 批量整理：选中 2 个 → 移到「跳跃」');
movesPage.toggleBulk();
ok(movesPage.data.bulkOn === true, '进入整理模式');
const ids = movesPage.data.list.slice(0, 2).map(x => x.id);
ids.forEach(id => movesPage.tapRow({ currentTarget: { dataset: { id: id } } }));
ok(movesPage.data.selCount === 2, '已选 2 个');
movesPage.bulkAll();
ok(movesPage.data.selCount === 3 && movesPage.data.allSel === true, '全选本页 = 3 个，全选状态为真');
movesPage.bulkAll();
ok(movesPage.data.selCount === 0 && movesPage.data.allSel === false, '再点一次取消全选');
ids.forEach(id => movesPage.tapRow({ currentTarget: { dataset: { id: id } } }));
const jumpIdx = store.cats().findIndex(c => c.id === 'jump');
calls.pickIndex = jumpIdx;
movesPage.bulkMove();
const after = store.ensureMoves().filter(m => m.category === 'jump').length;
ok(after === 8, '跳跃分类变成 8 个（原 6 + 移入 2），实际 ' + after);
ok(movesPage.data.selCount === 0, '移动后清空选择');
const moved = store.ensureMoves().filter(m => ids.indexOf(m.id) > -1);
ok(moved.every(m => m.category === 'jump' && typeof m.sort === 'number'), '被移动的动作分类与 sort 都写好了');

console.log('③ 添加动作：停在某分类时不再追问分类');
movesPage.switchTab({ currentTarget: { dataset: { k: 'topic' } } });
calls.actionSheet = null;
calls.modalContent = '测试新动作';
movesPage.add();
ok(calls.actionSheet === null, '没有弹分类选择（直接落在当前分类）');
const added = store.ensureMoves().filter(m => m.name === '测试新动作')[0];
ok(!!added && added.category === 'topic', '新动作落在专题练习分类');

// ---------- record 页 ----------
console.log('⑤ record 页：点动作名 = 连它下面的组合一起勾（所有分类一致）');
const recPage = loadPage(MP + '/pages/record/record.js');
recPage.data.moveQuery = '';
recPage.data.recentOnly = false;
// 造两个多组合动作：一个在「专题练习」，一个在「跳跃」——规则应当完全一样
let lib = store.ensureMoves();
const boxMove = lib.filter(m => m.name === '变刃步伐串')[0];
const jumpMove = lib.filter(m => m.category === 'jump')[0];
lib.forEach(m => {
  if (m.id === boxMove.id) {
    m.category = 'topic';   // 前面的用例把它挪走了，这里放回「专题练习」
    m.drills = [
      { id: 'bd1', name: '前外刃变后内刃 ×20', c: 1 },
      { id: 'bd2', name: '后外刃变前内刃 ×20', c: 2 },
      { id: 'bd3', name: '连续变刃过桩 ×10', c: 3 }
    ];
  }
  if (m.id === jumpMove.id) {
    m.drills = [
      { id: 'jd1', name: '陆地起跳模仿 ×20', c: 1 },
      { id: 'jd2', name: '冰上两周单跳 ×10', c: 2 }
    ];
  }
});
store.saveMoves(lib);
recPage.initMoves(null);
recPage.data.content = '';
recPage.toggleMove({ currentTarget: { dataset: { id: boxMove.id } } });
ok(recPage.data.selMoveIds.indexOf(boxMove.id) > -1, '动作被勾选');
ok(recPage.data.selDrillIds.length === 3, '专题练习的动作：3 个组合一起带出，实际 ' + recPage.data.selDrillIds.length);
ok(recPage.data.content.indexOf('【变刃步伐串】') === 0, '训练笔记生成了标题行');
ok(recPage.data.content.split('\n').length === 4, '一行标题 + 3 行组合');
ok(['　1. ', '　2. ', '　3. '].every(t => recPage.data.content.indexOf(t) > -1)
   && ['前外刃变后内刃 ×20', '后外刃变前内刃 ×20', '连续变刃过桩 ×10'].every(n => recPage.data.content.indexOf(n) > -1),
   '三个组合都按序号逐行写入');
console.log('     生成内容:\n' + recPage.data.content.split('\n').map(l => '       ' + l).join('\n'));
recPage.toggleMove({ currentTarget: { dataset: { id: boxMove.id } } });
ok(recPage.data.selDrillIds.length === 0 && recPage.data.content === '', '取消勾选后组合一起撤销');
recPage.data.content = '';
recPage.toggleMove({ currentTarget: { dataset: { id: jumpMove.id } } });
ok(recPage.data.selDrillIds.length === 2, '跳跃的动作也一样：2 个组合一起带出，实际 ' + recPage.data.selDrillIds.length);
ok(recPage.data.content.split('\n').length === 3, '跳跃动作也是 标题 + 2 行');
recPage.toggleMove({ currentTarget: { dataset: { id: jumpMove.id } } });
recPage.data.content = '';
const noDrillMove = store.ensureMoves().filter(m => !(m.drills || []).length && m.category === 'jump')[0];
recPage.initMoves(null);
recPage.toggleMove({ currentTarget: { dataset: { id: noDrillMove.id } } });
ok(recPage.data.selDrillIds.length === 0 && recPage.data.content === '【' + noDrillMove.name + '】',
   '没有组合的动作就是一行动作名，不受影响');

console.log('⑥ 单独点组合 = 只按单独勾的来（并自动勾上所属动作）');
recPage.initMoves(null);
recPage.data.content = '';
recPage.toggleDrill({ currentTarget: { dataset: { mid: boxMove.id, did: 'bd1' } } });
ok(recPage.data.selMoveIds.indexOf(boxMove.id) > -1, '点组合会把所属动作勾上（否则勾了不生效）');
ok(recPage.data.selDrillIds.length === 1 && recPage.data.selDrillIds[0] === 'bd1', '只有这一个组合，实际 ' + recPage.data.selDrillIds.join(','));
ok(recPage.data.content.indexOf('【变刃步伐串】前外刃变后内刃 ×20') === 0, '笔记是单组合合并一行');
ok(recPage.data.content.split('\n').length === 1, '只有一行');
recPage.toggleDrill({ currentTarget: { dataset: { mid: boxMove.id, did: 'bd1' } } });
ok(recPage.data.selDrillIds.length === 0, '再点一次取消掉它');

console.log('⑦ 带出整组后仍能单独取消某个组合');
recPage.initMoves(null);
recPage.data.content = '';
recPage.toggleMove({ currentTarget: { dataset: { id: boxMove.id } } });
ok(recPage.data.selDrillIds.length === 3, '先带出 3 个');
const firstDrill = recPage.data.movesList.filter(m => m.id === boxMove.id)[0].drills[0];
recPage.toggleDrill({ currentTarget: { dataset: { mid: boxMove.id, did: firstDrill.id } } });
ok(recPage.data.selDrillIds.length === 2, '单独取消 1 个 → 剩 2 个，实际 ' + recPage.data.selDrillIds.length);
ok(recPage.data.content.split('\n').length === 3, '笔记跟着变成 标题 + 2 行');
ok(recPage.data.content.indexOf(firstDrill.name) === -1, '被取消的组合不在笔记里');

console.log('④ 分类被删掉后，标签自动回到「全部」');
const cats = store.cats().filter(c => c.id !== 'topic');
store.saveCats(cats);
movesPage.refresh();
ok(movesPage.data.tab === 'all' && movesPage.data.tabs.length === 6, '回到「全部」，标签剩 6 个');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);
