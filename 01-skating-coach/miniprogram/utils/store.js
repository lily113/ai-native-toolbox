const { TYPES, MODES, DEFAULT_MOVES, DEFAULT_CATS, CAT_FALLBACK, CAT_SEED_MOVES, EXAM_SECTIONS, SYLLABUS } = require('./const');

const KEYS = {
  records: 'figure_skating_planner_records_v1',
  templates: 'figure_skating_planner_templates_v1',
  moves: 'figure_skating_planner_moves_v1',
  cats: 'figure_skating_planner_cats_v1',
  milestones: 'figure_skating_planner_milestones_v1',
  meta: 'figure_skating_planner_meta_v1',
  aiKbUser: 'figure_skating_planner_ai_kb_user_v1',
  exams: 'figure_skating_planner_exams_v1',
    poseMap: 'figure_skating_planner_pose_map_v1'   // 姿态自查：关键点索引映射（校准后保存）
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

// 一次性迁移：把「课后总结 / 备注」并入「训练内容」，统一为一个笔记框
function migrateMergeNotes() {
  const meta = load(KEYS.meta) || {};
  if (meta.recordMergeV1) return;
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
  meta.recordMergeV1 = true;
  save(KEYS.meta, meta);
}
function sumMinutes(list) { return list.reduce((s, r) => s + (Number(r.duration) || 0), 0); }

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

// 一次性迁移：补齐默认分类 + 预置「串/组」动作 + 把旧「热身」动作规范成「常规热身」
function migrateCatsV1(list) {
  // ① 补齐默认分类（插在兜底分类之前，保持默认顺序）
  const have = {};
  list.forEach(c => { have[c.id] = 1; });
  DEFAULT_CATS.forEach(d => {
    if (have[d.id]) return;
    const at = list.findIndex(c => c.id === CAT_FALLBACK);
    const item = { id: d.id, name: d.name };
    if (at >= 0) list.splice(at, 0, item); else list.push(item);
  });
  // ② 动作库：旧「热身」→「常规热身」并归到热身分类；再补预置动作（不覆盖同名动作）
  let moves = null;
  try { moves = load(KEYS.moves); } catch (e) { moves = null; }
  if (!Array.isArray(moves)) { try { moves = ensureMoves(); } catch (e) { moves = null; } }
  if (!Array.isArray(moves)) return;
  const byName = n => moves.filter(m => m && m.name === n)[0];
  const hot = byName('热身');
  if (hot && !byName('常规热身')) { hot.name = '常规热身'; hot.category = 'warm'; }
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
  if (changed || deduped.length !== moves.length) save(KEYS.moves, deduped);
  return deduped;
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
function ensureExams() {
  let arr = load(KEYS.exams);
  if (!Array.isArray(arr)) arr = [];
  let changed = false;
  // 迁移：删掉旧版把整份考纲塞进本地的预置项（改为代码内置）
  const before = arr.length;
  arr = arr.filter(e => e && !(e.id && String(e.id).indexOf('preset_') === 0) && !(e.key && syllabusByKey(e.key) && e.sections));
  if (arr.length !== before) changed = true;
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
  cats, saveCats, catName, catMap, catsUntouched, normalizeCats, validCat,
  CAT_FALLBACK, DEFAULT_CATS,
  ensureMoves, saveMoves, moveById, drillById, dedupeMoves,
  ensureMilestones, saveMilestones,
  ensureExams, saveExams, newExam, syllabusByKey
};
