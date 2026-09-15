const { TYPES, MODES, DEFAULT_MOVES, EXAM_SECTIONS, SYLLABUS } = require('./const');

const KEYS = {
  records: 'figure_skating_planner_records_v1',
  templates: 'figure_skating_planner_templates_v1',
  moves: 'figure_skating_planner_moves_v1',
  milestones: 'figure_skating_planner_milestones_v1',
  meta: 'figure_skating_planner_meta_v1',
  aiKbUser: 'figure_skating_planner_ai_kb_user_v1',
  exams: 'figure_skating_planner_exams_v1'
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
  const mode = type === 'ice' ? (MODES[r.mode] ? r.mode : 'self') : 'lesson';
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
function validCat(c) { return (c === 'jump' || c === 'spin' || c === 'step' || c === 'other') ? c : 'other'; }

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
  moves.forEach(m => {
    if (!Array.isArray(m.drills)) m.drills = [];
    if (!Array.isArray(m.points)) m.points = [];      // 动作级「共性要点」
    // 迁移：给旧组合补创建时间（用很小的序号，保证一定旧于新加的）
    m.drills.forEach((d, i) => { if (d && typeof d.c !== 'number') d.c = i + 1; });
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
  if (deduped.length !== moves.length) save(KEYS.moves, deduped);
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
  normalizeRecord, loadRecords, saveRecords, recordsOf, statusOf, sumMinutes, migrateMergeNotes,
  ensureMoves, saveMoves, moveById, drillById, dedupeMoves,
  ensureMilestones, saveMilestones,
  ensureExams, saveExams, newExam, syllabusByKey
};
