// 运行：node tools/mp_tests/upgrade.test.js
// 目的：模拟「手机上装着旧版本 + 六年真实数据」→ 发新版本后第一次启动，
//       验证一条记录、一个字段都不丢，且云端不会被写坏。
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

// ---------- 假 wx（真机：platform=ios，所以自动同步会生效）+ 假云数据库 ----------
const mem = {};
const cloud = { doc: null, sets: 0, history: [], removes: 0 };
function chain(resolve) {
  const p = Promise.resolve(resolve);
  p.orderBy = () => p; p.skip = () => p; p.limit = () => p; p.where = () => p; p.get = () => p;
  return p;
}
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'ios', system: 'iOS 18' }),
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {},
  cloud: {
    init: () => {},
    callFunction: () => Promise.resolve({ result: { openid: 'oPHONE' } }),
    database: () => ({
      collection: () => ({
        doc: () => ({
          get: () => (cloud.doc ? chain({ data: cloud.doc }) : Promise.reject(new Error('not exist'))),
          set: o => { cloud.sets++; cloud.doc = JSON.parse(JSON.stringify(o.data)); return Promise.resolve({}); },
          remove: () => { cloud.removes++; return Promise.resolve({}); }
        }),
        add: o => { cloud.history.push(o.data); return Promise.resolve({}); },
        orderBy: () => chain({ data: cloud.history.slice() }),
        where: () => chain({ data: [] })
      })
    })
  }
};

const store = require(MP + '/utils/store');
const util = require(MP + '/utils/util');
const K = store.KEYS;

// ---------- ① 造一份「老手机」的本地数据（形态照抄老版本） ----------
const MOVE_IDS = [];
const moves = [];
const CATS_OLD = ['jump', 'spin', 'step', 'other'];
const NAMES = ['后内结环跳', '后外点冰跳', '直立旋转', '蹲踞旋转', '前压步', '转3', '莫霍克步', '接续步'];
NAMES.forEach((n, i) => {
  const id = 'mv' + i;
  MOVE_IDS.push(id);
  moves.push({
    id: id, name: n, category: CATS_OLD[i % 4], sort: i, c: 0,
    points: ['共性要点' + i],
    drills: [
      { id: 'dr' + i + 'a', name: n + ' 基础组 ×10', points: ['要点A'], c: 1 },
      { id: 'dr' + i + 'b', name: n + ' 进阶组 ×5', points: [], c: 2 }
    ]
  });
});
moves[5].boxMode = 'off';        // 上一版残留字段：升级时应被清掉

const records = [];
let n = 0;
for (let y = 2020; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 3; d++) {
      n++;
      const date = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const lesson = n % 3 === 0;
      const mi = n % MOVE_IDS.length;
      records.push({
        id: 'imp-' + y + '-' + m + '-' + d + '-' + n,
        date: date,
        type: n % 5 === 0 ? 'land' : 'ice',
        mode: lesson ? 'lesson' : 'self',
        units: lesson ? 2 : 1,
        duration: lesson ? 60 : 90,
        // 老版本：没有 time / itemOrder / lessonForm
        content: '【' + NAMES[mi] + '】\n　1. ' + NAMES[mi] + ' 基础组 ×10\n手写的一句：今天状态不错 ' + n,
        // 老版本还可能把课后总结 / 备注分开存（网页版至今如此）
        lessonSummary: lesson ? '老师说的第 ' + n + ' 条要点' : '',
        notes: n % 7 === 0 ? '备注文本 ' + n : '',
        status: 'done',
        moves: [MOVE_IDS[mi]],
        drills: ['dr' + mi + 'a'],
        examPicks: n % 40 === 0 ? ['ex1'] : []
      });
    }
  }
}
const exams = [
  { id: 'preset_steps-4', key: 'steps-4', kind: 'steps', level: '四级', sections: [
    { items: [{ key: 's-3-5', title: '第3、5步 前内刃双3字步', points: ['我当年写的要点（绝不能被删）'] }] },
    { items: [{ key: '', title: '旧版随手记', points: ['旧版杂记一条'] }] }
  ] },
  { id: 'ex1', key: '', kind: 'free', level: '三级', date: '2027-03-01', note: '自由滑三级备注',
    itemExtra: { 'k1': { points: ['我的个性化要点'], mistakes: [] } },
    mySections: [{ id: 's1', name: '我的要点', items: [] }],
    myItems: [{ id: 'i1', sectionKey: 'my-points', title: '自建条目', points: ['自建内容'] }],
    images: ['cloud://x.png'] }
];
const milestones = [
  { id: 'ms1', date: '2021-06-01', type: 'skates', title: '上冰 100 次', emoji: '⛸️', note: '纪念' },
  { id: 'ms2', date: '2023-09-01', type: 'exam', title: '步法三级通过', emoji: '🎖️', note: '' }
];
mem[K.records] = records;
mem[K.moves] = moves;
mem[K.exams] = exams;
mem[K.milestones] = milestones;
mem[K.meta] = { weeklyIceGoal: 3, iceBase: 420, lessonBase: 120, movesStdV1: true, recordMergeV1: true, lessonFormV1: true };
// 老版本没有 KEYS.cats；云端也还是旧 payload
const beforeRecs = JSON.parse(JSON.stringify(records));
const totalTextLen = beforeRecs.reduce((s, r) => s + (r.content + r.lessonSummary + r.notes).length, 0);
console.log('准备完毕：' + records.length + ' 条记录、' + moves.length + ' 个动作、' + totalTextLen + ' 字笔记');

// ---------- ①.5 升级保护：换版本时先本地快照 + 记指纹 ----------
console.log('\n①.5 升级保护（换版本时自动快照 + 自检）');
const APP_VERSION = require(MP + '/utils/const').APP_VERSION;
const guardPrev = store.upgradeGuard();
ok(!!guardPrev, '检测到版本变化（老数据里没有 appVersion），返回指纹');
ok(guardPrev.records === beforeRecs.length, '指纹记录了升级前的记录数：' + guardPrev.records);
ok(guardPrev.lines.length > beforeRecs.length, '指纹记下了每一行文字，共 ' + guardPrev.lines.length + ' 行');
ok(guardPrev.snap === true, '整份数据已存成本机快照');
ok(JSON.stringify(store.upgradeSnapshotInfo()) !== 'null', '快照信息可读：' + JSON.stringify(store.upgradeSnapshotInfo()));
ok(store.upgradeGuard() === null, '同一版本再次启动不再重复快照（日常启动不做无用功）');

// ---------- ② 跑新版本的启动流程（app.js onLaunch 的顺序） ----------
store.migrateMergeNotes();
store.migrateLessonForm();
store.cats();
store.ensureMoves();
store.ensureExams();
store.ensureMilestones();

const afterRecs = store.loadRecords();
console.log('\n① 记录本体');
ok(afterRecs.length === beforeRecs.length, '记录条数不变：' + afterRecs.length);
const byId = {}; afterRecs.forEach(r => { byId[r.id] = r; });
ok(beforeRecs.every(r => byId[r.id]), '每条记录的 id 都还在');
ok(beforeRecs.every(r => byId[r.id].date === r.date && byId[r.id].type === r.type && byId[r.id].mode === r.mode),
   '日期 / 类型 / 方式 都没变');
ok(beforeRecs.every(r => Number(byId[r.id].units) === Number(r.units) && Number(byId[r.id].duration) === Number(r.duration)),
   '节数 / 时长 都没变');
ok(beforeRecs.every(r => (byId[r.id].moves || []).join() === (r.moves || []).join()
                      && (byId[r.id].drills || []).join() === (r.drills || []).join()),
   '勾选的动作 / 组合 id 都没变');
ok(beforeRecs.every(r => (byId[r.id].examPicks || []).join() === (r.examPicks || []).join()), '考级勾选没变');

const chkOk = store.upgradeVerify(guardPrev);
ok(chkOk && chkOk.ok === true, '升级自检通过：记录 ' + chkOk.before + ' → ' + chkOk.after + ' 条，没有文字丢失');
ok(chkOk.lost === 0, '自检报告的丢字行数 = 0');

console.log('\n①.6 迁移的幂等性：再跑一遍启动流程，数据不能有任何变化');
const snapA = JSON.stringify({ r: mem[K.records], m: mem[K.moves], c: mem[K.cats], e: mem[K.exams], s: mem[K.milestones] });
store.migrateMergeNotes(); store.migrateLessonForm(); store.cats(); store.ensureMoves(); store.ensureExams(); store.ensureMilestones();
const snapB = JSON.stringify({ r: mem[K.records], m: mem[K.moves], c: mem[K.cats], e: mem[K.exams], s: mem[K.milestones] });
ok(snapA === snapB, '再跑一遍完全一致（迁移是幂等的，每次启动不会慢慢改坏数据）');

console.log('\n② 文字一个字都不能少');
let textLost = [];
beforeRecs.forEach(r => {
  const a = byId[r.id];
  const all = String(r.content || '') + '\n' + String(r.lessonSummary || '') + '\n' + String(r.notes || '');
  all.split('\n').map(x => x.trim()).filter(x => x.length).forEach(line => {
    if (String(a.content || '').indexOf(line) === -1) textLost.push(r.id + ' → ' + line);
  });
});
ok(textLost.length === 0, '原来写在 content/课后总结/备注 里的每一行都还在 content 里' + (textLost.length ? '：' + textLost.slice(0, 3).join(' | ') : ''));
ok(afterRecs.every(r => !r.notes && !r.lessonSummary), '旧的 notes/lessonSummary 已清空（内容已并入 content，不会重复）');
const afterTextLen = afterRecs.reduce((s, r) => s + String(r.content || '').length, 0);
ok(afterTextLen >= totalTextLen, '笔记总字数没变少：' + totalTextLen + ' → ' + afterTextLen);

console.log('\n③ 编辑一条老记录再保存，文字不能丢');
delete require.cache[require.resolve(MP + '/pages/record/record.js')];
let captured = null;
global.Page = o => { captured = o; };
global.getApp = () => ({ globalData: {} });
require(MP + '/pages/record/record.js');
const page = Object.assign(Object.create(null), captured);
page.data = JSON.parse(JSON.stringify(captured.data));
page.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
const target0 = beforeRecs.filter(r => r.lessonSummary && r.notes)[0];   // 同时有课后总结和备注的那条
const target = store.loadRecords().filter(r => r.id === target0.id)[0];
const origLines = [target0.content, target0.lessonSummary, target0.notes]
  .join('\n').split('\n').map(x => x.trim()).filter(x => x.length);
page.onLoad({ id: target.id });
ok(page.data.content.indexOf('手写的一句') > -1, '笔记框里能看到手写内容');
ok(origLines.every(l => page.data.content.indexOf(l) > -1),
   '原来的每一行（含课后总结 / 备注）都出现在笔记框里，共 ' + origLines.length + ' 行');
page.save();
const saved = store.loadRecords().filter(r => r.id === target.id)[0];
ok(saved, '记录还在');
ok(!saved.notes && !saved.lessonSummary, '保存后旧字段是空的（内容已在 content 里）');
ok(origLines.every(l => String(saved.content).indexOf(l) > -1), '保存后原来每一行都还在（一个字没丢）');
ok(saved.id === target.id && saved.date === target.date, '保存没有产生新记录 / 没改日期');
ok(store.loadRecords().length === afterRecs.length, '总条数不变：' + store.loadRecords().length);

console.log('\n④ 动作库与考级');
const mv = store.ensureMoves();
ok(mv.length >= moves.length, '动作一个没少：' + moves.length + ' → ' + mv.length + '（新增的是预置动作）');
ok(moves.every(m => mv.some(x => x.id === m.id)), '原来每个动作 id 都还在');
ok(mv.every(m => m.boxMode === undefined), '废弃字段 boxMode 已清掉');
const dangling = [];
store.loadRecords().forEach(r => (r.moves || []).forEach(id => { if (!store.moveById(id)) dangling.push(r.id + '→' + id); }));
ok(dangling.length === 0, '没有任何记录指向已不存在的动作' + (dangling.length ? '：' + dangling.slice(0, 3).join(' | ') : ''));
const ex = store.ensureExams();
ok(ex.some(e => e.id === 'ex1') && ex.filter(e => e.id === 'ex1')[0].note === '自由滑三级备注', '自建考级记录与备注都在');
ok(ex.filter(e => e.id === 'ex1')[0].myItems.length === 1 && ex.filter(e => e.id === 'ex1')[0].images.length === 1,
   '自建条目 / 图片都在');
ok(!ex.some(e => e.id === 'preset_steps-4'), '旧版考纲外壳已清理');
const sy = ex.filter(e => e.key === 'steps-4')[0];
ok(!!sy && JSON.stringify(sy.itemExtra).indexOf('我当年写的要点（绝不能被删）') > -1,
   '旧壳里用户写过的要点被搬进「我的要点」，没被删');
ok(!!sy && JSON.stringify(sy.myItems).indexOf('旧版杂记一条') > -1, '认不出归属的旧内容进「我的条目」，也没被删');
ok(store.ensureMilestones().length === 2, '里程碑 2 条都在');

console.log('\n⑤ 分类表');
const cats = store.cats();
ok(cats.length === 6 && cats[cats.length - 1].id === 'other', '新分类表建好且「其他」在最后');
ok(cats.every(c => c.box === undefined), '分类不带已废弃的 box 字段');
ok(store.catName('jump') === '跳跃' && store.catName('topic') === '专题练习', '老分类名照旧、新分类可用');

console.log('\n⑥ meta（基线/目标）不能被冲掉');
const meta = store.load(K.meta) || {};
ok(meta.weeklyIceGoal === 3 && meta.iceBase === 420 && meta.lessonBase === 120, '基线 / 目标都在');
ok(meta.catsV1 === true && meta.movesStdV1 === true && meta.recordMergeV1 === true, '各迁移标记都在（没有互相覆盖）');

console.log('\n⑦ 云端同步：两个方向都不能丢东西');
const sync = require(MP + '/utils/sync');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitFor(fn, ms) {
  return new Promise(res => {
    const t0 = Date.now();
    (function tick() {
      if (fn()) return res(true);
      if (Date.now() - t0 > ms) return res(false);
      setTimeout(tick, 150);
    })();
  });
}
// 模拟「手机上刚改过、还没推上去」：本机最后改动时间 = 现在，云端 payload 是 1 分钟前的
const editAt = Date.now();
mem['planner_sync_meta_v1'] = { auto: true, seenTs: 0, lastEdit: editAt };
const oldPayload = JSON.stringify({
  records: beforeRecs.slice(0, 50), moves: moves, milestones: milestones,
  meta: { weeklyIceGoal: 5, iceBase: 400 }, exams: exams
});   // 旧 payload：只有 50 条记录、没有 cats、基线也旧
cloud.doc = { payload: oldPayload, ts: editAt - 60000 };
const localBefore = store.loadRecords().length;
sync.init();

(async () => {
  await sleep(1500);                       // 等启动自动拉取
  const afterPull = store.loadRecords();
  ok(afterPull.length === localBefore, '拉取合并后条数没变少：' + afterPull.length);
  ok(afterPull.every(r => !r.notes && !r.lessonSummary), '拉进来的旧记录，notes 也被并进 content 了');
  ok(Number((store.load(K.meta) || {}).iceBase) === 420,
     '本机比云端新 → 基线保持本机的 420（不会被云端旧值 400 盖回去），实际 ' + (store.load(K.meta) || {}).iceBase);
  const t = afterRecs.filter(r => !r.notes && r.content.indexOf('手写的一句') > -1)[0];
  ok(t && String(store.loadRecords().filter(x => x.id === t.id)[0].content).indexOf('手写的一句') > -1,
     '本机未推送的记录内容没有被云端旧版覆盖');

  await waitFor(() => cloud.sets > 0, 8000);   // 等自动上传跑完
  for (let i = 0; i < 3 && cloud.sets === 0; i++) { await sync.push(true); await sleep(600); }
  const up = JSON.parse(cloud.doc.payload);
  ok(cloud.sets > 0, '确实上传了（set 次数 ' + cloud.sets + '）');
  ok(up.records.length === store.loadRecords().length, '云端记录数 = 本机记录数：' + up.records.length);
  ok(up.records.length >= beforeRecs.length, '云端记录数不少于升级前的 ' + beforeRecs.length);
  ok(!!cloud.history.length, '上传前把云端旧版存进了历史快照（可回滚），共 ' + cloud.history.length + ' 份');
  ok(Array.isArray(up.cats) && up.cats.length === 6, '新 payload 带上分类表');
  ok(up.records.every(r => !r.notes && !r.lessonSummary), '上传的记录里没有隐形字段（文字都在 content）');
  const size = cloud.doc.payload.length;
  ok(size < 1024 * 1024, 'payload 体积 ' + (size / 1024).toFixed(1) + ' KB，在 1MB 云文档上限内');

  console.log('\n⑦.5 假设某个版本迁移出错（删了记录 / 吞了文字），保险能不能兜住');
const goodRecs = JSON.parse(JSON.stringify(mem[K.records]));
const goodLines = store.loadRecords().reduce((a, r) => a.concat(String(r.content || '').split('\n').map(x => x.trim()).filter(Boolean)), []);
// 模拟"坏迁移"：悄悄删掉 40 条记录、并把第 3 条记录的笔记清掉
const bad = store.loadRecords().filter((r, i) => i % 7 !== 0);
bad[3].content = '';
mem[K.records] = bad;
const chkBad = store.upgradeVerify({ version: '上一版', records: goodRecs.length, lines: goodLines, snap: true });
ok(chkBad.ok === false, '自检没通过（检测到异常）');
ok(chkBad.after < chkBad.before, '报出记录变少：' + chkBad.before + ' → ' + chkBad.after);
ok(chkBad.lost > 0, '报出丢失的笔记行数：' + chkBad.lost + ' 行，例如「' + chkBad.sample[0] + '」');
ok(!!store.takeUpgradeWarning(), '首页会拿到提示（只提示一次）');
ok(store.takeUpgradeWarning() === null, '第二次不再重复提示');
const restored = store.restoreUpgradeSnapshot();
ok(!!restored && restored.records > 0, '一键恢复执行成功（快照 ' + restored.records + ' 条）');
const nowRecs = store.loadRecords();
ok(nowRecs.length === goodRecs.length, '恢复后记录数回到 ' + goodRecs.length + '：' + nowRecs.length);
const nowLines = {};
nowRecs.forEach(r => String(r.content || '').split('\n').forEach(l => { const t = l.trim(); if (t) nowLines[t] = 1; }));
const stillMissing = goodLines.filter(l => !nowLines[l]);
ok(stillMissing.length === 0, '恢复后每一行文字都回来了' + (stillMissing.length ? '（还差 ' + stillMissing.slice(0, 3).join(' | ') + '）' : ''));
ok(store.loadRecords().every(r => r.id) && store.ensureMoves().length > 0, '动作库 / 记录结构完好');
// 把状态还原成"好的"，后面的云端用例继续跑
mem[K.records] = JSON.parse(JSON.stringify(goodRecs));

console.log('\n⑧ 反方向：云端更新时，本机数据也不能被删');
  const cloudNewer = JSON.parse(cloud.doc.payload);
  cloudNewer.records = cloudNewer.records.slice(0, 5);      // 云端"更新"但只有 5 条
  cloudNewer.ts = undefined;
  cloud.doc = { payload: JSON.stringify(cloudNewer), ts: Date.now() + 60000 };
  mem['planner_sync_meta_v1'] = { auto: true, seenTs: 0, lastEdit: editAt };
  delete require.cache[require.resolve(MP + '/utils/sync.js')];
  const sync2 = require(MP + '/utils/sync.js');
  sync2.init();
  await sleep(1500);
  ok(store.loadRecords().length === localBefore,
     '云端更"新"但内容更少的极端情况下，本机 ' + localBefore + ' 条一条没被删（合并只做并集）');

  console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：升级不会丢数据');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 异步流程异常: ' + (e && e.stack || e)); process.exit(1); });
