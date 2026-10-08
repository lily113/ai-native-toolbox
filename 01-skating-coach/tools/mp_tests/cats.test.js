// 运行：node tools/mp_tests/cats.test.js
const path = require('path');
const fs = require('fs');
// 本地开发目录是 figure-skating-mp/，仓库里是 01-skating-coach/miniprogram/，两边都能跑
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];
// 回归自测：分类表迁移 / 编辑 / 合并（跑完即删）
const mem = {};
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'devtools' })
};

const store = require(MP + '/utils/store');
const util = require(MP + '/utils/util');

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

console.log('① 全新用户（无任何数据）');
let cats = store.cats();
ok(cats.length === 6, '6 个默认分类：' + cats.map(c => c.name).join('/'));
ok(cats[cats.length - 1].id === 'other', '「其他」固定在最后');
ok(cats.every(c => c.box === undefined), '分类只带 id + name（没有整组开关这类字段）');
let moves = store.ensureMoves();
const names = moves.map(m => m.name);
ok(names.indexOf('变刃步伐串') > -1, '预置「变刃步伐串」已加入');
ok(moves.filter(m => m.category === 'topic').length === 3, '专题练习预置 3 个动作');
ok(moves.filter(m => m.category === 'warm').length === 3, '热身预置 3 个动作');
ok(names.indexOf('后内结环跳') > -1, '原有默认动作仍在');
ok(store.validCat('topic') === 'topic' && store.validCat('nope') === 'other', 'validCat 兜底');

console.log('② 老用户（已有 step 动作 + 自建动作，但还没有分类表）');
delete mem['figure_skating_planner_cats_v1'];
delete mem['figure_skating_planner_meta_v1'];
mem['figure_skating_planner_moves_v1'] = [
  { id: 'm1', name: '前压步', category: 'step', drills: [] },
  { id: 'm2', name: '热身', category: 'other', drills: [{ id: 'd1', name: 'A 组' }] }
];
cats = store.cats();
moves = store.ensureMoves();
const m1 = moves.filter(m => m.id === 'm1')[0];
const m2 = moves.filter(m => m.id === 'm2')[0];
ok(!!m1 && m1.category === 'step', '老动作分类一字未改（步法）');
ok(!!m2 && m2.name === '热身', '老动作名字一字未改（不做「热身 → 常规热身」这种自动改名）');
ok(moves.filter(m => m.name === '膝关节激活').length === 0, '老用户不会被塞预置动作');
ok(moves.filter(m => m.name === '前压步').length === 1, '没有把已有动作重复插入');

console.log('③ 改名 / 新增 / 删除（带动作迁移）/ 排序');
let list = store.cats();
const before = list.length;
list.forEach(c => { if (c.id === 'topic') c.name = '专题组合'; });
store.saveCats(list);
ok(store.catName('topic') === '专题组合', '改名生效：' + store.catName('topic'));
const nb = store.cats();
nb.splice(nb.length - 1, 0, { id: 'cNEW', name: '体能', box: false });
store.saveCats(nb);
ok(store.catName('cNEW') === '体能' && store.cats().length === before + 1, '新增分类生效且排在兜底分类前');
// 删除 topic（先手动放 3 个动作进去，因为老用户的动作库不会被自动塞预置）→ 模拟页面的迁移逻辑
let all = store.ensureMoves();
let put = 0;
all.forEach(m => { if (put < 3 && m.category === 'step') { m.category = 'topic'; put++; } });
store.saveMoves(all);
const inTopic = store.ensureMoves().filter(m => m.category === 'topic').length;
let moved = 0;
all = store.ensureMoves();
all.forEach(m => { if (m.category === 'topic') { m.category = 'other'; moved++; } });
store.saveMoves(all);
store.saveCats(store.cats().filter(c => c.id !== 'topic'));
ok(inTopic === 3 && moved === 3, '删除分类时 3 个动作被迁移（放进去了 ' + inTopic + ' 个）');
ok(store.catName('topic') === '其他', '已删分类名回落到「其他」');
ok(store.validCat('topic') === 'other', '已删分类不再是合法分类');
ok(store.cats()[store.cats().length - 1].id === 'other', '兜底分类仍在最后');
// 重复 + 空名 + 缺 id 的脏数据
store.saveCats([{ id: 'a', name: '甲' }, { id: 'a', name: '甲2' }, { name: '' }, null, { id: 'b', name: '乙', box: 1 }]);
const clean = store.cats();
ok(clean.length === 3, '脏数据被清理（去重/去空/补 id）：' + clean.map(c => c.id + ':' + c.name).join(', '));
ok(clean[clean.length - 1].id === 'other' && !!clean[clean.length - 1].name, '兜底分类被补回来且有名字');

console.log('④ 未动过判断 + 合并');
delete mem['figure_skating_planner_cats_v1'];
delete mem['figure_skating_planner_meta_v1'];
store.cats();
ok(store.catsUntouched() === true, '默认状态下 catsUntouched = true');
let l2 = store.cats(); l2[0].name = '准备活动'; store.saveCats(l2);
ok(store.catsUntouched() === false, '改过名字后 catsUntouched = false');
const remote = [{ id: 'warm', name: '热身', box: true }, { id: 'jump', name: '跳跃' }, { id: 'xx', name: '外来的' }];
const imp = util.mergeCats(store.cats(), remote, false);
ok(imp.filter(c => c.id === 'warm')[0].name === '热身', 'localWins=false 时远端名字生效');
const keep = util.mergeCats(store.cats(), remote, true);
ok(keep.filter(c => c.id === 'warm')[0].name === '准备活动', 'localWins=true 时本机名字保留');
ok(keep.filter(c => c.id === 'xx').length === 1, '远端独有的分类被接收');

console.log('⑤ 记录渲染（分类改名不影响历史）');
mem['figure_skating_planner_records_v1'] = [{
  id: 'r1', date: '2026-09-18', type: 'ice', mode: 'self', moves: ['m1'], drills: [], examPicks: [], itemOrder: []
}];
const rec = store.loadRecords()[0];
const lines = store.recordLines(rec, () => '');
ok(lines.length === 1 && lines[0].text === '前压步', '记录仍能正常生成行');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);
