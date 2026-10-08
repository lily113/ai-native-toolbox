// 运行：node tools/mp_tests/realdata.test.js
// 用**你自己的真实导出**跑一遍升级演练（fixture 怎么放见 fixtures/README.md）。
// 没放 fixture 时会跳过，不会误报失败。
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];
const FIX = path.join(__dirname, 'fixtures', 'real-export.json');

if (!fs.existsSync(FIX)) {
  console.log('（跳过）没有找到 ' + FIX);
  console.log('        想用真实数据演练：小程序「设置 → 数据备份 → 导出为文件」，');
  console.log('        存到 tools/mp_tests/fixtures/real-export.json（该文件不会入库）。');
  process.exit(0);
}

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

const raw = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const K = {
  records: 'figure_skating_planner_records_v1',
  moves: 'figure_skating_planner_moves_v1',
  cats: 'figure_skating_planner_cats_v1',
  exams: 'figure_skating_planner_exams_v1',
  milestones: 'figure_skating_planner_milestones_v1',
  meta: 'figure_skating_planner_meta_v1',
  templates: 'figure_skating_planner_templates_v1',
  aiKbUser: 'figure_skating_planner_ai_kb_user_v1'
};

// 把导出当成"老版本的本地存储"：有 cats 就有，没 cats 就当老版本（顺带测迁移）
const mem = {};
const put = (k, v) => { if (v !== undefined && v !== null) mem[k] = JSON.parse(JSON.stringify(v)); };
put(K.records, raw.records || []);
put(K.moves, raw.moves || []);
if (Array.isArray(raw.cats) && raw.cats.length) put(K.cats, raw.cats);
put(K.exams, raw.exams || []);
put(K.milestones, raw.milestones || []);
put(K.templates, raw.templates || []);
put(K.aiKbUser, raw.aiUserKb || '');
const meta = Object.assign({}, raw.meta || {});
delete meta.appVersion;                 // 关键：抹掉版本号，等价于"这是老版本留下的数据"
put(K.meta, meta);

global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'ios' }),
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {},
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'oREAL' } }),
    database: () => ({ collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('x')), set: () => Promise.resolve({}), remove: () => Promise.resolve({}) }),
      add: () => Promise.resolve({}), orderBy: () => Promise.resolve({ data: [] }), where: () => Promise.resolve({ data: [] }) }) }) }
};

const store = require(MP + '/utils/store');
const VERSION = require(MP + '/utils/const').APP_VERSION;

const before = JSON.parse(JSON.stringify(mem[K.records] || []));
const lines = n => [];
function allLines(recs) {
  const seen = {}, out = [];
  recs.forEach(r => {
    [r && r.content, r && r.lessonSummary, r && r.notes].forEach(t => {
      String(t == null ? '' : t).split('\n').forEach(l => { const x = l.trim(); if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    });
  });
  return out;
}
const beforeLines = allLines(before);
const beforeMoves = (mem[K.moves] || []).length;
const beforeExams = JSON.stringify(mem[K.exams] || []);
const beforeMilestones = JSON.stringify(mem[K.milestones] || []);
const payloadSize = JSON.stringify(raw).length;

console.log('真实数据：' + before.length + ' 条记录 · ' + beforeLines.length + ' 行文字 · '
  + beforeMoves + ' 个动作 · 导出体积 ' + (payloadSize / 1024).toFixed(1) + ' KB');
const dates = before.map(r => r.date).filter(Boolean).sort();
console.log('日期范围：' + (dates[0] || '—') + ' ~ ' + (dates[dates.length - 1] || '—')
  + ' · 有课后总结 ' + before.filter(r => r.lessonSummary).length + ' 条'
  + ' · 有备注 ' + before.filter(r => r.notes).length + ' 条');
console.log('目标版本：' + VERSION + '\n');

// ---------- 跑新版本的启动流程（和 app.js onLaunch 一模一样） ----------
const prev = store.upgradeGuard();
store.migrateMergeNotes();
store.migrateLessonForm();
store.cats();
store.ensureMoves();
store.ensureExams();
store.ensureMilestones();
const chk = store.upgradeVerify(prev);
const after = store.loadRecords();

console.log('① 升级自检');
ok(!!chk && chk.ok === true, '自检通过（' + chk.before + ' → ' + chk.after + ' 条，丢字 ' + chk.lost + ' 行）');
ok(prev && prev.snap === true, '升级前已在本机留快照（可一键恢复）');

console.log('\n② 记录');
ok(after.length === before.length, '条数不变：' + after.length);
const byId = {}; after.forEach(r => { byId[r.id] = r; });
ok(before.every(r => byId[r.id]), '每条记录的 id 都还在');
ok(before.every(r => byId[r.id] && byId[r.id].date === r.date), '日期都没变');
ok(before.every(r => byId[r.id] && Number(byId[r.id].units) === Number(r.units) && Number(byId[r.id].duration) === Number(r.duration)),
   '节数 / 时长都没变');
ok(before.every(r => byId[r.id] && (byId[r.id].moves || []).join() === (r.moves || []).join()
                  && (byId[r.id].drills || []).join() === (r.drills || []).join()), '勾选的动作 / 组合没变');
ok(before.every(r => byId[r.id] && (byId[r.id].examPicks || []).join() === (r.examPicks || []).join()), '考级勾选没变');

console.log('\n③ 文字');
const afterLines = {};
allLines(after).forEach(l => { afterLines[l] = 1; });
const missing = beforeLines.filter(l => !afterLines[l]);
ok(missing.length === 0, '每一行文字都还在' + (missing.length ? '（丢了 ' + missing.length + ' 行，例如「' + missing.slice(0, 3).join(' | ') + '」）' : ''));
ok(after.every(r => !r.notes && !r.lessonSummary), '隐形字段已并入 content（不会再被编辑器清空）');

console.log('\n④ 动作库 / 考级 / 里程碑');
const dangling = [];
after.forEach(r => (r.moves || []).forEach(id => { if (!store.moveById(id)) dangling.push(r.date + '→' + id); }));
ok(dangling.length === 0, '没有记录指向已不存在的动作' + (dangling.length ? '（' + dangling.slice(0, 3).join(' | ') + '）' : ''));
ok((mem[K.moves] || []).length >= beforeMoves, '动作数没变少：' + beforeMoves + ' → ' + (mem[K.moves] || []).length);
const exNow = JSON.stringify(store.ensureExams());
ok(exNow.length >= beforeExams.length * 0.5, '考级数据还在（' + exNow.length + ' 字符）');
ok(JSON.stringify(mem[K.milestones] || []) === beforeMilestones, '里程碑原样');
const m = store.load(K.meta) || {};
ok(m.appVersion === VERSION, '版本号已更新为 ' + VERSION);

console.log('\n⑤ 幂等性');
const a = JSON.stringify({ r: mem[K.records], m: mem[K.moves], e: mem[K.exams], s: mem[K.milestones] });
store.migrateMergeNotes(); store.migrateLessonForm(); store.cats(); store.ensureMoves(); store.ensureExams(); store.ensureMilestones();
const b = JSON.stringify({ r: mem[K.records], m: mem[K.moves], e: mem[K.exams], s: mem[K.milestones] });
ok(a === b, '再跑一遍完全一致（不会每次启动都在悄悄改数据）');

console.log('\n⑥ 万一这次升级真弄丢了东西，恢复能不能兜住');
const good = JSON.parse(JSON.stringify(mem[K.records]));
const cut = store.loadRecords().filter((r, i) => i % 9 !== 0);
if (cut.length) { cut[0].content = ''; mem[K.records] = cut; }
const chkBad = store.upgradeVerify({ version: '上一版', records: good.length, lines: beforeLines, snap: true });
ok(chkBad.ok === false, '自检抓到了异常（记录 ' + chkBad.before + ' → ' + chkBad.after + '，丢字 ' + chkBad.lost + ' 行）');
store.restoreUpgradeSnapshot();
const rec = store.loadRecords();
const recLinesMap = {}; allLines(rec).forEach(l => { recLinesMap[l] = 1; });
const stillGone = beforeLines.filter(l => !recLinesMap[l]);
ok(rec.length === before.length, '一键恢复后条数回到 ' + before.length + '：' + rec.length);
ok(stillGone.length === 0, '一键恢复后每一行文字都回来了' + (stillGone.length ? '（还差 ' + stillGone.slice(0, 3).join(' | ') + '）' : ''));

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项 —— 这个版本先别发！') : '\n✓ 全部通过：这一版升级不会丢你的真实数据');
process.exit(fail ? 1 : 0);
