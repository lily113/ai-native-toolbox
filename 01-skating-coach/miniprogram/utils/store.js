const { APP_VERSION, TYPES, MODES, DEFAULT_MOVES, DEFAULT_CATS, CAT_FALLBACK, CAT_SEED_MOVES, EXAM_SECTIONS, SYLLABUS } = require('./const');

const KEYS = {
  records: 'figure_skating_planner_records_v1',
  templates: 'figure_skating_planner_templates_v1',
  moves: 'figure_skating_planner_moves_v1',
  cats: 'figure_skating_planner_cats_v1',
  milestones: 'figure_skating_planner_milestones_v1',
  meta: 'figure_skating_planner_meta_v1',
  aiKbUser: 'figure_skating_planner_ai_kb_user_v1',
  exams: 'figure_skating_planner_exams_v1',
    poseMap: 'figure_skating_planner_pose_map_v1',  // 姿态自查：关键点索引映射（校准后保存）
  upgradeSnap: 'figure_skating_planner_upgrade_snapshot_v1',   // 升级前的本地快照（可一键恢复）
  upgradeGuard: 'figure_skating_planner_upgrade_guard_v1'      // 升级自检结果（少没少东西）
};

function load(key) { try { return wx.getStorageSync(key) || null; } catch (e) { return null; } }
function save(key, val) {
  try {
    wx.setStorageSync(key, val);
    if (_afterSave) _afterSave(key);
  } catch (e) { console.warn('保存失败', e); }
}
let _afterSave = null;
function setAfterSave(fn) { _afterSave = fn; }

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayKey() { return dateKey(new Date()); }
function keyToDate(k) { const p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function normalizeRecord(r) {
  let type = r.type === 'strength' ? 'land' : r.type;
  if (!TYPES[type]) type = 'ice';
  // 陆地也支持自己练习：保留记录里的方式，缺失时默认「自己训练」
  const mode = MODES[r.mode] ? r.mode : 'self';
  const date = r.date || todayKey();
  // 节数：上课时一节算几节（2021-07-16 起通常每次 2 节）
  let units = Number(r.units);
  if (!units || units < 0) units = (mode === 'lesson' && date >= '2021-07-16') ? 2 : 1;
  return {
    id: r.id || uid(),
    date: date,
    type: type,
    mode: mode,
    units: units,
    // 上课形式：one / two / multi；旧记录未标注就是空串（不擅自假设）
    lessonForm: (mode === 'lesson' && typeof r.lessonForm === 'string' && r.lessonForm) ? r.lessonForm : '',
    time: r.time || '',
    duration: Number(r.duration) || 0,
    content: r.content || '',
    status: r.status === 'done' ? 'done' : 'pending',
    notes: r.notes || '',
    lessonSummary: r.lessonSummary || '',
    moves: Array.isArray(r.moves) ? r.moves : [],
    drills: Array.isArray(r.drills) ? r.drills : [],
    examPicks: Array.isArray(r.examPicks) ? r.examPicks : [],
    itemOrder: Array.isArray(r.itemOrder) ? r.itemOrder : [],
    pointPicks: Array.isArray(r.pointPicks) ? r.pointPicks : []
  };
}

function loadRecords() {
  const arr = load(KEYS.records) || [];
  return (Array.isArray(arr) ? arr : []).map(normalizeRecord);
}
function saveRecords(rec) { save(KEYS.records, rec); }
function recordsOf(date) { return loadRecords().filter(r => r.date === date); }
function statusOf(r) { return r.date < todayKey() ? 'done' : 'pending'; }

// 由记录里保存的动作/组合/考级 + itemOrder 生成结构化条目行（kind: head/item/one）
// 首页日历卡片使用；顺序规则与训练笔记一致（展示样式各自不同：卡片用竖条 + 缩进）
function recordLines(rec, examLabelOf) {
  const order = Array.isArray(rec.itemOrder) ? rec.itemOrder.slice() : [];
  const groups = {};
  (rec.moves || []).forEach(id => {
    const m = moveById(id);
    if (m) groups[id] = { id: id, name: m.name, drills: [] };
  });
  (rec.drills || []).forEach(did => {
    const f = drillById(did);
    if (f && groups[f.move.id]) {
      groups[f.move.id].drills.push({ key: 'm:' + f.move.id + '::d:' + did, name: f.drill.name });
    }
  });
  const pos = k => { const i = order.indexOf(k); return i < 0 ? 1e9 : i; };
  const blocks = [];
  Object.keys(groups).forEach(id => {
    const g = groups[id];
    // 位置取「动作级旧键」与「各组合键」的最小值（兼容旧记录的动作级排序）
    const ps = [pos('m:' + id)].concat(g.drills.map(d => pos(d.key)));
    blocks.push({ pos: Math.min.apply(null, ps), kind: 'move', g: g });
  });
  (rec.examPicks || []).forEach(eid => blocks.push({ pos: pos('e:' + eid), kind: 'exam', id: eid, seq: blocks.length }));
  blocks.sort((a, b) => (a.pos - b.pos) || ((a.seq || 0) - (b.seq || 0)));

  // 返回结构化行：{ kind:'head'|'item'|'one', text, idx }
  //   head = 动作标题；item = 组内某组合；one = 单组合（标题与组合同一行）
  const lines = [];
  blocks.forEach(b => {
    if (b.kind === 'exam') {
      const lab = examLabelOf ? examLabelOf(b.id) : '';
      // 考级项：作为「标签」呈现（方括号 + tag 标记，界面用不同颜色区分）
      if (lab) lines.push({ kind: 'head', text: '【' + lab + '】', tag: true, idx: 0 });
      return;
    }
    const g = b.g;
    if (g.drills.length > 1) {
      lines.push({ kind: 'head', text: g.name, idx: 0 });
      g.drills.slice().sort((x, y) => pos(x.key) - pos(y.key))
        .forEach((d, i) => lines.push({ kind: 'item', text: d.name, idx: i + 1 }));
    } else if (g.drills.length === 1) {
      // 单组合：合并一行（界面在行首加标题竖条，保持“标题 + 内容”的层级）
      lines.push({ kind: 'one', name: g.name, text: g.drills[0].name, idx: 1 });
    } else {
      lines.push({ kind: 'head', text: g.name, idx: 0 });
    }
  });
  return lines;
}

// 一次性迁移：历史「上课」记录默认标为「一对一」（特殊的用户自己改）
function migrateLessonForm() {
  const meta = load(KEYS.meta) || {};
  if (meta.lessonFormV1) return;
  const recs = loadRecords();
  let n = 0;
  recs.forEach(r => {
    if (r.mode === 'lesson' && !r.lessonForm) { r.lessonForm = 'one'; n++; }
  });
  if (n) save(KEYS.records, recs);
  meta.lessonFormV1 = true;
  save(KEYS.meta, meta);
  return n;
}

// 把「课后总结 / 备注」并入「训练内容」，统一为一个笔记框。
// ⚠️ 每次启动、以及每次导入/拉取之后都要跑：网页版(PWA)的记录至今仍是 content + notes +
//    lessonSummary 三个字段，导入进来的 notes/课后总结在小程序里既看不见、又会被编辑器
//    保存时清成空串 → 那就是真的丢字。这个迁移只「并没并过的」，重复跑是安全的。
function migrateMergeNotes() {
  const meta = load(KEYS.meta) || {};
  const recs = loadRecords();
  let changed = false;
  recs.forEach(r => {
    const extra = [r.lessonSummary, r.notes].filter(x => x && String(x).trim().length);
    if (!extra.length) return;
    let c = String(r.content || '');
    extra.forEach(x => { if (c.indexOf(x) === -1) c = c ? (c + '\n' + x) : String(x); });
    r.content = c;
    r.lessonSummary = '';
    r.notes = '';
    changed = true;
  });
  if (changed) save(KEYS.records, recs);
  if (!meta.recordMergeV1) { meta.recordMergeV1 = true; save(KEYS.meta, meta); }
  return changed;
}
function sumMinutes(list) { return list.reduce((s, r) => s + (Number(r.duration) || 0), 0); }

// ==================== 升级保护（每次发版不丢数据的保险） ====================
// 思路：换版本时，**先**把现有数据整份快照到本机、并把"每一行文字"记成指纹，
//       跑完迁移**再**比对：记录条数不能变少、原来写下的每一行字都还找得到。
//       任何一条不满足 → 记下异常（首页会提示），本地快照可一键恢复。
function rawArr(key) { const v = load(key); return Array.isArray(v) ? v : []; }
// 一条记录里"用户真正写下的字"：content + 旧的 lessonSummary / notes
function recLines(r) {
  const out = [];
  [r && r.content, r && r.lessonSummary, r && r.notes].forEach(t => {
    String(t == null ? '' : t).split('\n').forEach(l => {
      const x = l.trim();
      if (x) out.push(x);
    });
  });
  return out;
}
function allLines(recs) {
  const seen = {}, out = [];
  (Array.isArray(recs) ? recs : []).forEach(r => {
    recLines(r).forEach(l => { if (!seen[l]) { seen[l] = 1; out.push(l); } });
  });
  return out;
}
function snapshotPayload() {
  return {
    records: rawArr(KEYS.records),
    moves: rawArr(KEYS.moves),
    cats: rawArr(KEYS.cats),
    exams: rawArr(KEYS.exams),
    milestones: rawArr(KEYS.milestones),
    templates: rawArr(KEYS.templates),
    meta: load(KEYS.meta) || {},
    aiUserKb: load(KEYS.aiKbUser) || ''
  };
}
// 升级前：换版本了就把整份数据存一份本机快照（只留最近 1 份，避免撑爆单键 1MB）
function upgradeGuard() {
  const meta = load(KEYS.meta) || {};
  if (meta.appVersion === APP_VERSION) return null;       // 同一版本，日常启动不折腾
  const recs = rawArr(KEYS.records);
  const moves = rawArr(KEYS.moves);
  let prev = { version: meta.appVersion || '(首次安装)', at: Date.now(), records: recs.length, lines: allLines(recs) };
  if (recs.length || moves.length) {
    const payload = snapshotPayload();
    let str = '';
    try { str = JSON.stringify({ version: prev.version, at: prev.at, payload: payload }); } catch (e) { str = ''; }
    // 单键上限 1MB：太大就不存本机（云端另有 5 份历史快照兜底），并记下来
    if (str && str.length < 700 * 1024) {
      save(KEYS.upgradeSnap, JSON.parse(str));
      prev.snap = true;
    } else {
      prev.snap = false;
      prev.snapSkip = str ? Math.round(str.length / 1024) + 'KB 过大' : '序列化失败';
    }
  }
  meta.appVersion = APP_VERSION;
  save(KEYS.meta, meta);
  return prev;
}
// 升级后：比对指纹，少一条记录 / 少一行字都要报出来
function upgradeVerify(prev) {
  if (!prev) return null;
  const recs = rawArr(KEYS.records);
  const after = allLines(recs);
  const seen = {};
  after.forEach(l => { seen[l] = 1; });
  const missing = prev.lines.filter(l => !seen[l]);
  const check = {
    ok: !missing.length && recs.length >= prev.records,
    lost: missing.length,
    sample: missing.slice(0, 5),
    before: prev.records,
    after: recs.length,
    at: Date.now(),
    prevVersion: prev.version,
    version: APP_VERSION,
    snap: !!prev.snap,
    snapSkip: prev.snapSkip || ''
  };
  save(KEYS.upgradeGuard, check);
  return check;
}
function upgradeCheck() { const v = load(KEYS.upgradeGuard); return (v && typeof v === 'object') ? v : null; }
function upgradeSnapshotInfo() {
  const s = load(KEYS.upgradeSnap);
  return (s && s.payload) ? { version: s.version, at: s.at, records: (s.payload.records || []).length } : null;
}
// 首页提示用：异常只提示一次
function takeUpgradeWarning() {
  const v = upgradeCheck();
  if (!v || v.ok || v.warned) return null;
  v.warned = true;
  save(KEYS.upgradeGuard, v);
  return v;
}
// 一键恢复升级前的数据（只补不删，和导入恢复同一套规则）
function mergeByIdLocal(cur, inc) {
  const map = {}, out = (Array.isArray(cur) ? cur : []).slice();
  out.forEach(x => { if (x && x.id) map[x.id] = 1; });
  (Array.isArray(inc) ? inc : []).forEach(x => { if (x && x.id && !map[x.id]) { out.push(x); map[x.id] = 1; } });
  return out;
}
// 两边笔记取并集：恢复快照时，既要把升级中丢掉的文字找回来，
// 也不能抹掉升级之后你自己新写的内容（谁包含谁就直接用更全的那份）
function unionNotes(cur, snap) {
  const c = String(cur == null ? '' : cur), s = String(snap == null ? '' : snap);
  if (!s) return c;
  if (!c) return s;
  if (c.indexOf(s) > -1) return c;
  if (s.indexOf(c) > -1) return s;
  const seen = {}, out = [];
  [s, c].forEach(t => t.split('\n').forEach(l => {
    const k = l.trim();
    if (k && !seen[k]) { seen[k] = 1; out.push(l); }
  }));
  return out.join('\n');
}
function restoreUpgradeSnapshot() {
  const s = load(KEYS.upgradeSnap);
  if (!s || !s.payload) return null;
  const p = s.payload;
  // 同 id 的记录：补齐笔记（并集），不覆盖升级后新写的内容
  const snapById = {};
  (p.records || []).forEach(r => { if (r && r.id) snapById[r.id] = r; });
  const cur = loadRecords().map(r => {
    const o = snapById[r.id];
    if (!o) return r;
    // 快照是升级前的原始形态，文字可能分散在 content / lessonSummary / notes 三处
    const snapText = [o.content, o.lessonSummary, o.notes].map(t => String(t == null ? '' : t).trim()).filter(t => t).join('\n');
    const merged = unionNotes(r.content, snapText);
    return merged === r.content ? r : Object.assign({}, r, { content: merged });
  });
  saveRecords(mergeByIdLocal(cur, (p.records || []).map(normalizeRecord)));
  save(KEYS.moves, dedupeMoves(mergeByIdLocal(rawArr(KEYS.moves), p.moves)));
  save(KEYS.milestones, mergeByIdLocal(rawArr(KEYS.milestones), p.milestones));
  save(KEYS.templates, mergeByIdLocal(rawArr(KEYS.templates), p.templates));
  if (Array.isArray(p.cats) && p.cats.length) _catCache = null;
  if (Array.isArray(p.exams) && p.exams.length) save(KEYS.exams, mergeExamsLocal(rawArr(KEYS.exams), p.exams));
  // 补回来的记录是升级前的原始形态，文字可能还在 lessonSummary / notes 里 → 立刻并进 content
  migrateMergeNotes();
  return { records: (p.records || []).length, at: s.at, version: s.version };
}
// 考级：本地版合并（同 id 合并字段 + itemExtra 并集），避免和 util.js 互相 require
function mergeExamsLocal(cur, inc) {
  const out = (Array.isArray(inc) ? inc.map(e => Object.assign({}, e)) : []);
  const idx = {};
  out.forEach((e, i) => { if (e && e.id) idx[e.id] = i; });
  (Array.isArray(cur) ? cur : []).forEach(le => {
    if (!le || !le.id) return;
    const i = idx[le.id];
    if (i === undefined) { out.push(le); return; }
    const re = out[i];
    const base = Object.assign({}, re, le);
    const ie = Object.assign({}, re.itemExtra || {});
    Object.keys(le.itemExtra || {}).forEach(k => { if (ie[k] === undefined) ie[k] = le.itemExtra[k]; });
    base.itemExtra = ie;
    base.mySections = mergeByIdLocal(re.mySections, le.mySections);
    base.myItems = mergeByIdLocal(re.myItems, le.myItems);
    out[i] = base;
  });
  return out;
}

// ---------- 动作分类（可编辑；分类只决定动作库分组，记录按动作 id 关联） ----------
let _catCache = null;

// 把任意来源的分类数组整理成规范表：去空、去重、补 id、兜底分类固定最后
function normalizeCats(arr) {
  const out = [];
  const seen = {};
  let fbName = '';
  (Array.isArray(arr) ? arr : []).forEach(c => {
    if (!c || typeof c !== 'object') return;
    let id = String(c.id || '').trim();
    const nm = String(c.name || '').trim();
    if (!id && !nm) return;                    // 既没 id 也没名字：无从归属，丢弃
    if (!id) id = 'c' + uid().slice(0, 6);
    if (seen[id]) return;
    seen[id] = 1;
    if (id === CAT_FALLBACK && nm) fbName = nm;
    out.push({ id: id, name: nm || id });
  });
  const at = out.findIndex(c => c.id === CAT_FALLBACK);
  if (at >= 0) out.splice(at, 1);
  if (!fbName) fbName = (DEFAULT_CATS.filter(c => c.id === CAT_FALLBACK)[0] || {}).name || '其他';
  out.push({ id: CAT_FALLBACK, name: fbName });
  return out;
}

// 是否还是「没动过的默认分类表」（用于导入时判断要不要让备份里的分类名生效）
function catsUntouched() {
  const l = cats();
  if (l.length !== DEFAULT_CATS.length) return false;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = DEFAULT_CATS[i];
    if (a.id !== b.id || a.name !== b.name) return false;
  }
  return true;
}

// 一次性迁移：只补默认分类表。
// ⚠️ 原则：**绝不改动用户已有数据**。
//   - 分类表是新键（只增不改），随便建；
//   - 预置动作**只给全新安装**补（老用户库里已经有自己的动作，硬塞进去只会造成重复和困惑，
//     而且改名/挪动老动作属于"动用户数据"，不做——想归类可以在「动作库 → 整理」里两下搞定）。
function migrateCatsV1(list) {
  const hadMoves = Array.isArray(load(KEYS.moves));   // 迁移前就有动作库 = 老用户
  // ① 补齐默认分类（插在兜底分类之前，保持默认顺序）
  const have = {};
  list.forEach(c => { have[c.id] = 1; });
  DEFAULT_CATS.forEach(d => {
    if (have[d.id]) return;
    const at = list.findIndex(c => c.id === CAT_FALLBACK);
    const item = { id: d.id, name: d.name };
    if (at >= 0) list.splice(at, 0, item); else list.push(item);
  });
  if (hadMoves) return;                                // 老用户：到此为止，一根手指都不碰他的数据
  // ② 全新安装：补一批预置动作，让专题练习/热身这两栏一开始就不是空的
  let moves = null;
  try { moves = ensureMoves(); } catch (e) { moves = null; }
  if (!Array.isArray(moves)) return;
  const byName = n => moves.filter(m => m && m.name === n)[0];
  CAT_SEED_MOVES.forEach(s => {
    if (byName(s.name)) return;
    let max = -1;
    moves.forEach(m => { if (m && m.category === s.category && typeof m.sort === 'number' && m.sort > max) max = m.sort; });
    moves.push({ id: uid(), name: s.name, category: s.category, drills: [], sort: max + 1, c: 0 });
  });
  save(KEYS.moves, moves);
}

// 分类表（唯一入口；首次调用会跑一次性迁移）
function cats() {
  let list = normalizeCats(load(KEYS.cats));
  const meta = load(KEYS.meta) || {};
  if (!meta.catsV1) {
    migrateCatsV1(list);            // 内部可能触发 ensureMoves()，它也会写 meta
    const m2 = load(KEYS.meta) || {};   // 所以这里必须重新读一次，别把它的标记覆盖掉
    m2.catsV1 = true;
    save(KEYS.meta, m2);
    save(KEYS.cats, list);
  } else if (JSON.stringify(list) !== JSON.stringify(load(KEYS.cats))) {
    save(KEYS.cats, list);
  }
  _catCache = list.map(c => c.id);
  return list;
}
function saveCats(list) {
  const out = normalizeCats(list);
  _catCache = out.map(c => c.id);
  save(KEYS.cats, out);
  return out;
}
function catName(id) {
  const l = cats();
  const c = l.filter(x => x.id === id)[0];
  return c ? c.name : ((DEFAULT_CATS.filter(x => x.id === CAT_FALLBACK)[0] || {}).name || '其他');
}
// 收集 id → 分类 的映射（一次调用，避免逐条读存储）
function catMap() {
  const m = {};
  cats().forEach(c => { m[c.id] = c; });
  return m;
}

function dedupeMoves(moves) {
  const seen = {};
  return (Array.isArray(moves) ? moves : []).filter(m => {
    if (!m || !m.name) return false;
    const k = m.name + '|' + (m.category || 'other');
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}
// 合法分类 id（不在当前分类表里的一律落到兜底分类）
function validCat(c) {
  if (_catCache && _catCache.indexOf(c) > -1) return c;
  const raw = load(KEYS.cats);
  const ids = Array.isArray(raw) ? raw.map(x => x && x.id).filter(Boolean) : [];
  if (!ids.length) DEFAULT_CATS.forEach(x => { if (ids.indexOf(x.id) < 0) ids.push(x.id); });
  if (ids.indexOf(CAT_FALLBACK) < 0) ids.push(CAT_FALLBACK);
  return ids.indexOf(c) > -1 ? c : CAT_FALLBACK;
}

// ---------- 动作库（与网页版同一数据结构，可 JSON 互导） ----------
function ensureMoves() {
  let moves = load(KEYS.moves);
  if (!Array.isArray(moves)) {
    const catCnt = {};
    moves = DEFAULT_MOVES.map(m => {
      const n = (catCnt[m.category] = (catCnt[m.category] || 0) + 1);
      return { id: uid(), name: m.name, category: m.category, drills: [], sort: n - 1, c: 0 };
    });
    save(KEYS.moves, moves);
    return moves;
  }
  let changed = false;
  moves.forEach(m => {
    if (!Array.isArray(m.drills)) m.drills = [];
    if (!Array.isArray(m.points)) m.points = [];      // 动作级「共性要点」
    // 迁移：给旧组合补创建时间（用很小的序号，保证一定旧于新加的）
    m.drills.forEach((d, i) => { if (d && typeof d.c !== 'number') d.c = i + 1; });
    // 「整组」开关已废弃（改成所有分类统一规则），清掉残留字段
    if (m.boxMode !== undefined) { delete m.boxMode; changed = true; }
  });
  // 迁移：补 sort（同类内顺序）/ c（创建时间，缺省视为较旧）
  const catCnt = {};
  moves.forEach(m => {
    const cat = validCat(m.category);
    const n = (catCnt[cat] = (catCnt[cat] || 0) + 1);
    if (typeof m.sort !== 'number') m.sort = n - 1;
    if (typeof m.c !== 'number') m.c = 0;
  });
  const deduped = dedupeMoves(moves);
  const meta = load(KEYS.meta) || {};
  if (!meta.movesStdV1) {
    const existing = {};
    deduped.forEach(m => { existing[m.name + '|' + validCat(m.category)] = 1; });
    DEFAULT_MOVES.forEach(d => {
      if (!existing[d.name + '|' + d.category]) {
        const catCnt2 = {};
        deduped.forEach(m => { const c = validCat(m.category); catCnt2[c] = (catCnt2[c] || 0) + 1; });
        const n = (catCnt2[d.category] = (catCnt2[d.category] || 0) + 1);
        deduped.push({ id: uid(), name: d.name, category: d.category, drills: [], sort: n - 1, c: 0 });
      }
    });
    meta.movesStdV1 = true;
    save(KEYS.meta, meta);
  }
  // ⚠️ 去重是"同名同分类只留一条"。但历史记录里可能正引用着被丢掉的那条 id，
  //    静默丢掉 = 那条记录在首页卡片上失去这个动作（文字还在，但结构没了）。
  //    所以：被记录引用的动作一律救回来（库里顶多多一条重名，也不会让历史记录断链）。
  let out = deduped;
  const dropped = deduped.length !== moves.length;
  if (dropped) {
    const used = {};
    loadRecords().forEach(r => (r.moves || []).forEach(id => { used[id] = 1; }));
    const has = {};
    deduped.forEach(m => { has[m.id] = 1; });
    const rescued = moves.filter(m => m && m.id && used[m.id] && !has[m.id]);
    if (rescued.length) out = deduped.concat(rescued);
  }
  if (changed || dropped) save(KEYS.moves, out);
  return out;
}
function saveMoves(moves) { save(KEYS.moves, moves); }
function moveById(id) { return ensureMoves().filter(m => m.id === id)[0] || null; }
function drillById(did) {
  const list = ensureMoves();
  for (let i = 0; i < list.length; i++) {
    const ds = list[i].drills || [];
    for (let j = 0; j < ds.length; j++) if (ds[j].id === did) return { move: list[i], drill: ds[j] };
  }
  return null;
}

// ---------- 纪念日 / 里程碑（轻量） ----------
function ensureMilestones() { const v = load(KEYS.milestones); return Array.isArray(v) ? v : []; }
function saveMilestones(arr) { save(KEYS.milestones, arr); }

// ---------- 考级备考（内置考纲只读 + 用户个性化） ----------
// 用户数据只存：个性化条目(itemExtra)、自建分节/条目(mySections/myItems)、图片、日期、备注
function syllabusByKey(key) { return SYLLABUS.filter(s => s.key === key)[0] || null; }
function normalizeExam(e) {
  if (!e) return e;
  if (!Array.isArray(e.images)) e.images = [];
  if (!e.itemExtra || typeof e.itemExtra !== 'object') e.itemExtra = {};
  if (!Array.isArray(e.mySections)) e.mySections = [];
  if (!Array.isArray(e.myItems)) e.myItems = [];
  const cat = 'other';
  e.mySections.forEach(s => { if (!Array.isArray(s.items)) s.items = []; });
  e.myItems.forEach(it => {
    if (!Array.isArray(it.points)) it.points = [];
    if (!Array.isArray(it.mistakes)) it.mistakes = [];
    if (!it.sectionKey) it.sectionKey = '';
  });
  for (const k in e.itemExtra) {
    const v = e.itemExtra[k] || {};
    if (!Array.isArray(v.points)) v.points = [];
    if (!Array.isArray(v.mistakes)) v.mistakes = [];
    e.itemExtra[k] = { points: v.points, mistakes: v.mistakes, note: v.note || '', moveId: v.moveId || '' };
  }
  return e;
}
// 旧版把整份考纲塞进本地（预置项）；现在考纲改为代码内置。
// ⚠️ 直接删这些外壳会连带删掉用户当时写在里面的要点，所以先把内容搬进「我的」条目再丢壳。
function examLegacyShell(e) {
  if (!e) return false;
  if (e.id && String(e.id).indexOf('preset_') === 0) return true;
  return !!(e.key && syllabusByKey(e.key) && e.sections);
}
function examHasUserContent(e) {
  if (!e) return false;
  if (e.date) return true;
  if (e.note && String(e.note).trim()) return true;
  if (Array.isArray(e.images) && e.images.length) return true;
  if (Array.isArray(e.myItems) && e.myItems.length) return true;
  if (Array.isArray(e.mySections) && e.mySections.length) return true;
  const ie = e.itemExtra || {};
  return Object.keys(ie).some(k => {
    const v = ie[k] || {};
    return (v.points && v.points.length) || (v.mistakes && v.mistakes.length) || v.note || v.moveId;
  });
}
// 把旧壳里的要点搬进「我的」条目：能对上内置条目 key 的进 itemExtra，其余进 myItems
function harvestExamSections(old, target) {
  if (!old || !target || !Array.isArray(old.sections)) return 0;
  const sy = old.key ? syllabusByKey(old.key) : null;
  const known = {};
  if (sy) (sy.sections || []).forEach(s => (s.items || []).forEach(it => { known[it.key] = 1; }));
  if (!target.itemExtra || typeof target.itemExtra !== 'object') target.itemExtra = {};
  if (!Array.isArray(target.myItems)) target.myItems = [];
  let moved = 0;
  old.sections.forEach(sec => {
    const items = (sec && Array.isArray(sec.items)) ? sec.items : [];
    items.forEach(it => {
      if (!it) return;
      const pts = []
        .concat(Array.isArray(it.points) ? it.points : [])
        .concat(Array.isArray(it.mistakes) ? it.mistakes : [])
        .concat(it.note ? [it.note] : [])
        .map(x => String(x == null ? '' : x).trim())
        .filter(x => x.length);
      if (!pts.length) return;
      const key = String(it.key || '').trim();
      if (key && known[key]) {
        const cur = target.itemExtra[key] || { points: [], mistakes: [], note: '', moveId: '' };
        if (!Array.isArray(cur.points)) cur.points = [];
        pts.forEach(p => { if (cur.points.indexOf(p) < 0) cur.points.push(p); });
        target.itemExtra[key] = cur;
      } else {
        const title = String(it.title || key || '旧版要点').trim();
        const dup = target.myItems.filter(x => x && x.title === title)[0];
        if (dup) {
          pts.forEach(p => { if ((dup.points || []).indexOf(p) < 0) dup.points.push(p); });
        } else {
          target.myItems.push({ id: uid(), sectionKey: 'my-points', title: title, points: pts, mistakes: [], note: '', moveId: '' });
        }
      }
      moved++;
    });
  });
  return moved;
}
function ensureExams() {
  let arr = load(KEYS.exams);
  if (!Array.isArray(arr)) arr = [];
  let changed = false;
  // ① 先抢救旧壳里的用户内容，再删壳（认不出归属、且确实有内容的，宁可留着也不删）
  const shells = arr.filter(examLegacyShell);
  if (shells.length) {
    shells.forEach(old => {
      if (!old.key || !syllabusByKey(old.key)) return;
      let target = arr.filter(x => x && x !== old && x.key === old.key && !x.sections)[0];
      if (!target) {
        const sy = syllabusByKey(old.key);
        target = { key: sy.key, id: uid(), kind: sy.kind, level: sy.level, date: '', note: '', images: [], itemExtra: {}, mySections: [], myItems: [] };
        arr.push(target);
      }
      harvestExamSections(old, target);
    });
    arr = arr.filter(e => {
      if (!examLegacyShell(e)) return true;
      if (e.key && syllabusByKey(e.key)) return false;   // 内容已搬到「我的」条目
      return examHasUserContent(e);                      // 认不出归属：有内容就留着
    });
    changed = true;
  }
  // 迁移：旧「我的易错」分节下的条目并入「我的要点」，避免内容丢失
  arr.forEach(e => {
    if (e && Array.isArray(e.myItems)) {
      e.myItems.forEach(it => { if (it && it.sectionKey === 'my-mistakes') { it.sectionKey = 'my-points'; changed = true; } });
    }
  });
  // 确保每个内置考级都有一条“用户个性化”记录
  SYLLABUS.forEach(sy => {
    if (!arr.some(e => e && e.key === sy.key)) {
      arr.push({ key: sy.key, id: 'sy_' + sy.key, kind: sy.kind, level: sy.level, date: '', note: '', images: [], itemExtra: {}, mySections: [], myItems: [] });
      changed = true;
    }
  });
  // 迁移：清掉「曾经内置、后来改了 key」的空白壳（早期版本用中文 key 生成过 sy_free-一级 这类）。
  // 只删既不在当前考纲里、又完全没内容的；用户写过东西的一律保留。
  const known = {};
  SYLLABUS.forEach(sy => { known[sy.key] = 1; });
  arr = arr.filter(e => {
    if (!e || !e.key || known[e.key]) return true;        // 自建考级(key='')或当前内置 → 保留
    const hasContent = !!e.date || !!e.star ||
      (e.note && String(e.note).trim()) ||
      (Array.isArray(e.images) && e.images.length) ||
      (Array.isArray(e.myItems) && e.myItems.length) ||
      (Array.isArray(e.mySections) && e.mySections.length) ||
      Object.keys(e.itemExtra || {}).some(k => {
        const v = e.itemExtra[k] || {};
        return (v.points || []).length || (v.mistakes || []).length || v.note || v.moveId;
      });
    if (hasContent) return true;                          // 有内容 → 留着
    changed = true;
    return false;                                        // 空白壳 → 清掉
  });
  arr.forEach(e => {
    const b = JSON.stringify(e);
    normalizeExam(e);
    if (JSON.stringify(e) !== b) changed = true;
  });
  if (changed) save(KEYS.exams, arr);
  return arr;
}
function saveExams(arr) { save(KEYS.exams, arr); }
function newExam(kind, level) {
  const secs = (EXAM_SECTIONS[kind] || EXAM_SECTIONS.free).map(n => ({ id: uid(), name: n, items: [] }));
  return { key: '', id: uid(), kind: kind, level: level, date: '', note: '', images: [], itemExtra: {}, mySections: secs.map(s => ({ id: s.id, name: s.name })), myItems: [] };
}

module.exports = {
  KEYS, load, save, setAfterSave, pad, dateKey, todayKey, keyToDate, uid,
  normalizeRecord, loadRecords, saveRecords, recordsOf, statusOf, sumMinutes, migrateMergeNotes, migrateLessonForm, recordLines,
  upgradeGuard, upgradeVerify, upgradeCheck, upgradeSnapshotInfo, takeUpgradeWarning, restoreUpgradeSnapshot,
  cats, saveCats, catName, catMap, catsUntouched, normalizeCats, validCat,
  CAT_FALLBACK, DEFAULT_CATS,
  ensureMoves, saveMoves, moveById, drillById, dedupeMoves,
  ensureMilestones, saveMilestones,
  ensureExams, saveExams, newExam, syllabusByKey
};
