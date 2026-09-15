const store = require('./store');

function mergeById(cur, inc) {
  const map = {};
  const out = (Array.isArray(cur) ? cur : []).slice();
  out.forEach(x => { if (x && x.id) map[x.id] = true; });
  (Array.isArray(inc) ? inc : []).forEach(x => {
    if (x && x.id && !map[x.id]) { out.push(x); map[x.id] = true; }
  });
  return out;
}

function buildPayload() {
  const meta = store.load(store.KEYS.meta) || {};
  return {
    exportedAt: new Date().toISOString(),
    records: store.loadRecords(),
    templates: store.load(store.KEYS.templates) || [],
    moves: store.load(store.KEYS.moves) || [],
    milestones: store.load(store.KEYS.milestones) || [],
    exams: store.ensureExams(),
    meta: meta,
    aiUserKb: store.load(store.KEYS.aiKbUser) || ''
  };
}

function applyPayload(d) {
  if (!d || typeof d !== 'object') throw new Error('数据格式异常');
  const inc = (d.records ? (d.records || []).map(store.normalizeRecord) : []);
  // 导入前先把本机记录备份一份（万一有问题可一键恢复）
  try { store.save('figure_skating_planner_records_backup_v1', { at: Date.now(), records: store.loadRecords() }); } catch (e) {}
  store.saveRecords(mergeById(store.loadRecords(), inc));
  store.save(store.KEYS.templates, mergeById(store.load(store.KEYS.templates) || [], d.templates));
  store.save(store.KEYS.moves, mergeById(store.load(store.KEYS.moves) || [], d.moves));
  store.save(store.KEYS.milestones, mergeById(store.load(store.KEYS.milestones) || [], d.milestones));
  if (Array.isArray(d.exams)) {
    try { store.save('figure_skating_planner_exams_backup_v1', { at: Date.now(), exams: store.ensureExams() }); } catch (e) {}
    store.save(store.KEYS.exams, mergeExams(store.ensureExams(), d.exams, true));
  }
  if (typeof d.aiUserKb === 'string') store.save(store.KEYS.aiKbUser, d.aiUserKb);
  // meta 用“合并”而不是覆盖，避免冲掉本机已设的基线等字段
  if (d.meta && typeof d.meta === 'object') {
    store.save(store.KEYS.meta, mergeMeta(store.load(store.KEYS.meta) || {}, d.meta, true));
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const p = String(dateStr).split('-').map(Number);
  if (!p[0] || !p[1] || !p[2]) return null;
  const target = new Date(p[0], p[1] - 1, p[2]);
  return Math.round((target - today) / 86400000);
}
function countdownText(dateStr, label) {
  const d = daysUntil(dateStr);
  const who = label || '考级';
  if (d === null) return '';
  if (d > 0) return '距' + who + '还有 ' + d + ' 天';
  if (d === 0) return '今天就是' + who + '！';
  return who + '已过 ' + (-d) + ' 天';
}

// ---------- 考级数据的安全合并（不整条覆盖） ----------
function unionById(a, b) {
  const out = (Array.isArray(a) ? a : []).slice();
  const map = {};
  out.forEach((x, i) => { if (x && x.id) map[x.id] = i; });
  (Array.isArray(b) ? b : []).forEach(x => {
    if (!x || !x.id) return;
    const i = map[x.id];
    if (i === undefined) { out.push(x); map[x.id] = out.length - 1; }
    else { out[i] = Object.assign({}, out[i], x); }   // 同 id 合并字段
  });
  return out;
}
// localWins=true 时，标量字段冲突以本地为准
function mergeExams(localArr, remoteArr, localWins) {
  const out = (Array.isArray(remoteArr) ? remoteArr : []).map(e => Object.assign({}, e));
  const idx = {};
  out.forEach((e, i) => { if (e && e.id) idx[e.id] = i; });
  (Array.isArray(localArr) ? localArr : []).forEach(le => {
    if (!le || !le.id) return;
    const i = idx[le.id];
    if (i === undefined) { out.push(le); return; }
    const re = out[i];
    const base = localWins ? Object.assign({}, re, le) : Object.assign({}, le, re);
    // itemExtra：键并集，同键冲突按时效性取舍，另一边独有的键一定保留
    const leIE = le.itemExtra || {}, reIE = re.itemExtra || {};
    const ie = {};
    Object.keys(reIE).forEach(k => { ie[k] = reIE[k]; });
    Object.keys(leIE).forEach(k => {
      if (ie[k] === undefined) { ie[k] = leIE[k]; return; }
      ie[k] = localWins ? leIE[k] : reIE[k];
    });
    base.itemExtra = ie;
    // 自建分节 / 自建条目 / 图片：并集保留
    base.mySections = unionById(re.mySections, le.mySections);
    base.myItems = unionById(re.myItems, le.myItems);
    const imgs = [];
    (re.images || []).concat(le.images || []).forEach(x => { if (x && imgs.indexOf(x) < 0) imgs.push(x); });
    base.images = imgs;
    out[i] = base;
  });
  return out;
}

// ---------- meta 安全合并：基线/目标 永不被 0 或缺失覆盖 ----------
function mergeMeta(local, incoming, localWins) {
  const L = local || {}, I = incoming || {};
  const out = Object.assign({}, L, I);
  ['weeklyIceGoal', 'iceBase', 'lessonBase'].forEach(k => {
    const a = Number(L[k]) || 0;
    const b = Number(I[k]) || 0;
    if (a > 0 && b > 0) out[k] = localWins ? a : b;
    else out[k] = Math.max(a, b);
  });
  return out;
}

module.exports = { mergeById, buildPayload, applyPayload, daysUntil, countdownText, mergeExams, mergeMeta };
