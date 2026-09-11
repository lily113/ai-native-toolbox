const store = require('./store');
const util = require('./util');

const CFG_KEY = 'planner_sync_meta_v1';
let pushTimer = null, busy = false, pulling = false, applying = false, lastLocalEditTs = 0;

function cfg() {
  try {
    const v = wx.getStorageSync(CFG_KEY);
    return (v && typeof v === 'object') ? v : { auto: true, seenTs: 0 };
  } catch (e) { return { auto: true, seenTs: 0 }; }
}
function saveCfg(c) { try { wx.setStorageSync(CFG_KEY, c); } catch (e) {} }
function openid() {
  try { return (getApp().globalData && getApp().globalData.openid) || ''; } catch (e) { return ''; }
}
function ensureOpenid() {
  if (openid()) return Promise.resolve(openid());
  return wx.cloud.callFunction({ name: 'login' })
    .then(r => {
      const o = r && r.result && r.result.openid;
      if (o) { try { getApp().globalData.openid = o; } catch (e) {} }
      return o;
    })
    .catch(() => '');
}
function isDevtools() {
  try { return String(wx.getSystemInfoSync().platform || '').toLowerCase() === 'devtools'; } catch (e) { return false; }
}
function payloadString() { return JSON.stringify(util.buildPayload()); }

function mergeArrays(local, remote, localWins) {
  const out = (Array.isArray(remote) ? remote : []).slice();
  const map = {}; out.forEach(x => { if (x && x.id) map[x.id] = true; });
  (Array.isArray(local) ? local : []).forEach(x => {
    if (!x || !x.id) return;
    if (map[x.id]) { if (localWins) { for (let i = 0; i < out.length; i++) if (out[i].id === x.id) { out[i] = x; break; } } }
    else out.push(x);
  });
  return out;
}

// ---------- 云端历史快照 + 上传前体检 ----------
const HIST = 'planner_history';
function histCol() { return wx.cloud.database().collection(HIST); }
function statsOf(str) {
  try {
    const d = JSON.parse(str);
    return {
      records: (d.records || []).length,
      examItems: (d.exams || []).reduce((n, e) => n + ((e.myItems || []).length), 0)
    };
  } catch (e) { return { records: -1, examItems: -1 }; }
}
function confirmModal(title, content, confirmText) {
  return new Promise(res => {
    wx.showModal({ title: title, content: content, confirmText: confirmText || '确定',
      success: r => res(!!r.confirm), fail: () => res(false) });
  });
}
function saveHistory(payload, ts) {
  if (!payload) return Promise.resolve();
  return histCol().add({ data: { ts: ts || 0, payload: payload, at: Date.now() } }).catch(() => {});
}
function trimHistory(keep) {
  return histCol().orderBy('at', 'desc').skip(keep).limit(20).get()
    .then(r => Promise.all((r.data || []).map(d => histCol().doc(d._id).remove().catch(() => {}))))
    .catch(() => {});
}
function listHistory(limit) {
  return histCol().orderBy('at', 'desc').limit(limit || 5).get()
    .then(r => r.data || []).catch(() => []);
}

// 上传到云（manual=true 时不要求开启自动同步）
function push(manual) {
  return ensureOpenid().then(oid => {
    if (!oid || busy) return;
    const c = cfg();
    if (!c.auto && !manual) return;
    if (!manual && isDevtools()) return;
    busy = true;
    const db = wx.cloud.database();
    const col = db.collection('planner_data');
    return col.doc(oid).get()
      .then(res => res.data)
      .catch(() => null)
      .then(remoteDoc => {
        const localPayload = payloadString();
        const localS = statsOf(localPayload);
        const finish = remoteDoc => {
          const ts = Date.now();
          return col.doc(oid).set({ data: { payload: payloadString(), ts: ts } })
            .then(() => { c.seenTs = ts; saveCfg(c); })
            .catch(() => {});
        };
        if (remoteDoc && remoteDoc.payload) {
          const remoteS = statsOf(remoteDoc.payload);
          const fewer = remoteS.records > localS.records + 5 && remoteS.records > localS.records * 1.2;
          if (fewer) {
            if (!manual) return;   // 自动上传：本机明显更少 → 跳过，避免覆盖云端
            return confirmModal('⚠️ 本机数据比云端少',
              '本机记录 ' + localS.records + ' 条，云端 ' + remoteS.records + ' 条。\n确定要用本机覆盖云端吗？（云端旧版会自动存为历史，可回滚）',
              '仍要上传').then(ok => ok ? saveHistory(remoteDoc.payload, remoteDoc.ts).then(() => trimHistory(5)).then(finish) : null);
          }
          return saveHistory(remoteDoc.payload, remoteDoc.ts).then(() => trimHistory(5)).then(finish);
        }
        return finish();
      })
      .catch(() => {})
      .then(() => { busy = false; }, () => { busy = false; });
  }).catch(() => {});
}

// 从云拉取并合并（按 id 并集；同 id 以“最近改过的”为准）
function pull(manual) {
  if (pulling) return Promise.resolve();
  return ensureOpenid().then(oid => {
    if (!oid) return;
    const c = cfg();
    if (!c.auto && !manual) return;
    pulling = true;
    return wx.cloud.database().collection('planner_data').doc(oid).get()
      .then(res => {
        const d = res.data || {};
        const ts = Number(d.ts) || 0;
        const seen = Number(c.seenTs) || 0;
        if (!ts || ts <= seen) return;
        let data;
        try { data = JSON.parse(d.payload); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        const localNewer = lastLocalEditTs > seen;
        applying = true;
        try {
          store.save(store.KEYS.records, mergeArrays(store.loadRecords(), data.records, localNewer));
          store.save(store.KEYS.templates, mergeArrays(store.load(store.KEYS.templates) || [], data.templates, localNewer));
          store.save(store.KEYS.moves, store.dedupeMoves(mergeArrays(store.ensureMoves(), data.moves, localNewer)));
          store.save(store.KEYS.milestones, mergeArrays(store.load(store.KEYS.milestones) || [], data.milestones, localNewer));
          // 拉取前先备份本机考级 + meta，万一有问题可恢复
          try {
            store.save('figure_skating_planner_exams_backup_v1', { at: Date.now(), exams: store.ensureExams(), meta: store.load(store.KEYS.meta) || {} });
          } catch (e) {}
          // 合并 meta（基线/每周目标，永不丢失）
          if (data.meta && typeof data.meta === 'object') {
            store.save(store.KEYS.meta, util.mergeMeta(store.load(store.KEYS.meta) || {}, data.meta, localNewer));
          }
          if (Array.isArray(data.exams)) {
            store.save(store.KEYS.exams, util.mergeExams(store.ensureExams(), data.exams, localNewer));
          }
          if (!localNewer && typeof data.aiUserKb === 'string') store.save(store.KEYS.aiKbUser, data.aiUserKb);
        } finally { applying = false; }
        c.seenTs = ts;
        saveCfg(c);
        if (localNewer) schedule(800);
      })
      .catch(() => {})
      .finally(() => { pulling = false; });
  }).catch(() => {});
}

function schedule(delay) {
  const c = cfg();
  if (!c.auto) return;
  if (isDevtools()) return;  // 开发者工具/模拟器不自动上传，避免覆盖云端真实数据
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(false), delay || 1500);
}

function onAfterSave() {
  if (applying) return;
  lastLocalEditTs = Date.now();
  schedule();
}

function init() {
  store.setAfterSave(onAfterSave);
  if (isDevtools()) return;  // 开发者工具里不做自动同步（可用设置页的手动按钮）
  ensureOpenid().then(() => { if (cfg().auto) setTimeout(() => pull(false), 800); });
}

function getAuto() { return !!cfg().auto; }
function setAuto(on) { const c = cfg(); c.auto = !!on; saveCfg(c); }

module.exports = { init, push, pull, getAuto, setAuto, listHistory, saveHistory, statsOf };
