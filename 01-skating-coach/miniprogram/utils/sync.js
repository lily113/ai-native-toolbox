const store = require('./store');
const util = require('./util');

const CFG_KEY = 'planner_sync_meta_v1';
let pushTimer = null, busy = false, pulling = false, applying = false, lastLocalEditTs = 0;
let retryTimer = null, retryDelay = 5000, lastPushFailed = false;
const RETRY_STEPS = [5000, 15000, 45000, 120000, 180000, 300000, 600000];
// 本机有改动、但还没成功推上去（用于启动/切回前台时补推）
function pendingPush() {
  const c = cfg();
  return (Number(c.lastEdit) || 0) > (Number(c.seenTs) || 0);
}
// 上传失败 → 退避重试，别再静默放弃。次数记在本地（retryN），
// 关掉小程序再打开也会接着重试；设置页还有一个「立即重试上传」按钮兜底。
function scheduleRetry() {
  if (retryTimer) return;
  if (!cfg().auto || isDevtools()) return;
  const c0 = cfg();
  const n = Number(c0.retryN) || 0;
  if (n >= RETRY_STEPS.length) return;         // 试满 7 次就不自动试了，靠手动按钮 / 下次改动
  const wait = RETRY_STEPS[Math.min(n, RETRY_STEPS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const c = cfg();
    c.retryN = (Number(c.retryN) || 0) + 1;
    saveCfg(c);
    push(false).then(() => {
      if (lastPushFailed) scheduleRetry();
      else { const c2 = cfg(); c2.retryN = 0; saveCfg(c2); }
    });
  }, wait);
}
// ⚠️ lastLocalEditTs 必须落盘：只放内存的话，重启后「本机刚改过、但还没推上去」的记录会被
//    当成旧数据，拉取合并时被云端旧版覆盖回去 = 静默丢改动。

function cfg() {
  try {
    const v = wx.getStorageSync(CFG_KEY);
    return (v && typeof v === 'object') ? v : { auto: true, seenTs: 0, lastEdit: 0 };
  } catch (e) { return { auto: true, seenTs: 0, lastEdit: 0 }; }
}
// ---------- 同步状态：成功/失败都要留痕（以前是 8 处 .catch(()=>{}) 全静默，
//            用户删掉小程序重开后明明云端有数据，界面上却什么都看不出来） ----------
function markOk(kind) {
  const c = cfg();
  c.lastError = '';
  c[kind === 'push' ? 'lastPushAt' : 'lastPullAt'] = Date.now();
  saveCfg(c);
}
function markErr(kind, e) {
  const c = cfg();
  c.lastError = (kind === 'push' ? '上传' : '拉取') + '失败：' +
    ((e && (e.errMsg || e.message)) || '未知原因（可能是网络或云环境权限）');
  c.lastErrorAt = Date.now();
  saveCfg(c);
}
function stats() {
  const c = cfg();
  return {
    auto: !!c.auto,
    pushAt: Number(c.lastPushAt) || 0,
    pullAt: Number(c.lastPullAt) || 0,
    error: c.lastError || '',
    errorAt: Number(c.lastErrorAt) || 0,
    restored: Number(c.lastRestored) || 0,
    restoredAt: Number(c.lastRestoredAt) || 0,
    pending: pendingPush()          // 本机有改动还没推上去
  };
}
// 本机原本是空的、这次拉回来了数据 → 明确告诉用户，并让当前页面刷新
function notifyRestored(n) {
  const c = cfg();
  c.lastRestored = n;
  c.lastRestoredAt = Date.now();
  saveCfg(c);
  try { wx.showToast({ title: '已从云端恢复 ' + n + ' 条记录', icon: 'none', duration: 3500 }); } catch (e) {}
  try {
    const pages = getCurrentPages() || [];
    const cur = pages[pages.length - 1];
    if (cur && typeof cur.onDataRestored === 'function') cur.onDataRestored(n);
  } catch (e) {}
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

// ---------- 分块上传/下载 ----------
// 为什么要分块：一次 set 写整个 payload（713 条记录 ≈ 236KB）在手机网络上容易 time out，
// 而且云数据库单文档上限 1MB。改成「一串小块 + 最后写清单」：
//   · 每块 ≤ 16000 字符（中文约 48KB），失败只重发那一块；
//   · 清单（planner_data 主文档）最后写，所以传一半失败不会破坏云端那份；
//   · 数据再涨也不会撞 1MB 上限。
const CHUNK_COL = 'planner_data_chunks';
const CHUNK_CHARS = 16000;
const SINGLE_LIMIT = 20000;        // 字符数小于它就还按老样子写单文档（兼容老数据）
function chunkCol() { return wx.cloud.database().collection(CHUNK_COL); }
function chunkId(oid, gen, i) { return oid + '__' + gen + '__' + i; }
function splitChunks(str) {
  const out = [];
  for (let i = 0; i < str.length; i += CHUNK_CHARS) out.push(str.slice(i, i + CHUNK_CHARS));
  return out.length ? out : [''];
}
function setChunk(oid, gen, i, str, tries) {
  return chunkCol().doc(chunkId(oid, gen, i)).set({ data: { gen: gen, i: i, data: str, at: Date.now() } })
    .catch(e => (tries > 1) ? new Promise(r => setTimeout(r, 1500)).then(() => setChunk(oid, gen, i, str, tries - 1)) : Promise.reject(e));
}
// 读云端那份，兼容两种布局：老的单文档 { payload } / 新的分块 { chunked, gen, n }
function readRemote(oid) {
  return wx.cloud.database().collection('planner_data').doc(oid).get()
    .then(res => res.data || null)
    .catch(() => null)
    .then(doc => {
      if (!doc) return null;
      const ts = Number(doc.ts) || 0;
      if (doc.payload) return { ts: ts, payload: doc.payload, layout: 'single' };
      if (!doc.chunked) return { ts: ts, payload: '', layout: 'empty' };
      const n = Number(doc.n) || 0;
      if (!n || n > 200) return { ts: ts, payload: '', layout: 'broken' };
      const jobs = [];
      for (let i = 0; i < n; i++) {
        jobs.push(chunkCol().doc(chunkId(oid, doc.gen, i)).get()
          .then(r => (r.data && typeof r.data.data === 'string') ? r.data.data : null)
          .catch(() => null));
      }
      return Promise.all(jobs).then(parts => {
        if (parts.some(x => x === null)) return { ts: ts, payload: '', layout: 'broken' };
        return { ts: ts, payload: parts.join(''), layout: 'chunked' };
      });
    });
}
// 上传成功后清掉上一代分块（留着只占空间，回滚靠 planner_history 快照）
function dropOldChunks(oid, gen, n) {
  if (!gen || !n) return Promise.resolve();
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push(chunkCol().doc(chunkId(oid, gen, i)).remove().catch(() => {}));
  return Promise.all(jobs);
}
let fallbackNote = '';        // 分块不可用时退回单文档，成功后仍要在设置页留一句提示
function writePayload(oid, payload, ts) {
  const col = wx.cloud.database().collection('planner_data');
  const prev = cfg().lastChunk || null;
  if (payload.length > SINGLE_LIMIT) {
    const parts = splitChunks(payload);
    return parts.reduce((chain, str, i) => chain.then(() => setChunk(oid, ts, i, str, 3)), Promise.resolve())
      .then(() => col.doc(oid).set({ data: { chunked: true, gen: ts, n: parts.length, size: payload.length, ts: ts } }))
      .then(() => {
        const c2 = cfg(); c2.lastChunk = { gen: ts, n: parts.length }; saveCfg(c2);
        if (prev && prev.gen !== ts) return dropOldChunks(oid, prev.gen, prev.n);
      })
      .catch(e => {
        // 兜底：云环境里还没建 planner_data_chunks 集合（或分块被权限挡住）→ 退回老的单文档写法，
        // 至少别因为配置少一步就完全传不上去。
        const msg = String((e && (e.errMsg || e.message)) || '');
        fallbackNote = /not exist|collection|permission|denied/i.test(msg)
          ? '分块上传不可用（' + msg + '）。请到云开发控制台新建集合 planner_data_chunks（权限选「仅创建者可读写」）——建好后上传会更稳，也能支持更多数据。'
          : '';
        return col.doc(oid).set({ data: { payload: payload, ts: ts } });
      });
  }
  // 小数据：还是单文档（和以前完全一样）
  return col.doc(oid).set({ data: { payload: payload, ts: ts } })
    .then(() => {
      const c2 = cfg(); c2.lastChunk = null; saveCfg(c2);
      if (prev) return dropOldChunks(oid, prev.gen, prev.n);
    });
}

// ---------- 云端历史快照 + 上传前体检 ----------
const HIST = 'planner_history';
function histCol() { return wx.cloud.database().collection(HIST); }
// ⚠️ 对外开放后，历史快照必须在**查询里**就把范围限死在自己身上。
//    集合权限设成「仅创建者可读写」时本来也读不到别人的，但那依赖控制台配置正确；
//    这里显式带上 _openid 条件，多一层兜底（快照是客户端 add 的，_openid 由云端自动写入）。
function histMine() {
  const oid = openid();
  return oid ? histCol().where({ _openid: oid }) : histCol().where({ _openid: '__none__' });
}
function statsOf(str) {
  try {
    const d = JSON.parse(str);
    return {
      records: (d.records || []).length,
      examItems: (d.exams || []).reduce((n, e) => n + ((e.myItems || []).length), 0)
    };
  } catch (e) { return { records: -1, examItems: -1 }; }
}
function notifyFail(kind, e) {
  const msg = (e && (e.errMsg || e.message)) || '未知原因';
  try {
    wx.showModal({
      title: '⚠️ ' + kind + '失败',
      content: msg + '\n\n常见原因：网络不通、云环境未开通、数据库集合或权限没配好。\n本机数据不受影响。',
      showCancel: false
    });
  } catch (e2) {}
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
  return histMine().orderBy('at', 'desc').skip(keep).limit(20).get()
    .then(r => Promise.all((r.data || []).map(d => histCol().doc(d._id).remove().catch(() => {}))))
    .catch(() => {});
}
function listHistory(limit) {
  return ensureOpenid().then(() => histMine().orderBy('at', 'desc').limit(limit || 5).get())
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
    return readRemote(oid)
      .then(remoteDoc => {
        const localPayload = payloadString();
        const localS = statsOf(localPayload);
        const finish = () => {
          const ts = Date.now();
          return writePayload(oid, payloadString(), ts)
            .then(() => {
              const c3 = cfg(); c3.seenTs = ts; c3.retryN = 0; saveCfg(c3);
              markOk('push'); lastPushFailed = false;
              if (fallbackNote) { const c4 = cfg(); c4.lastError = fallbackNote; c4.lastErrorAt = Date.now(); saveCfg(c4); fallbackNote = ''; }
            })
            .catch(e => { markErr('push', e); lastPushFailed = true; if (manual) notifyFail('上传', e); });
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
      .catch(e => { markErr('push', e); lastPushFailed = true; })
      .then(() => {
        busy = false;
        if (lastPushFailed) scheduleRetry();
      }, () => { busy = false; });
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
    return readRemote(oid)
      .then(remote => {
        if (!remote) return;
        const ts = Number(remote.ts) || 0;
        const seen = Number(c.seenTs) || 0;
        if (remote.layout === 'broken') { markErr('pull', { message: '云端数据不完整（分块缺失），请重新上传一次' }); return; }
        if (!ts || ts <= seen) return;
        let data;
        try { data = JSON.parse(remote.payload); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        const localNewer = lastLocalEditTs > seen;
        const localBefore = store.loadRecords().length;   // 拉之前本机有几条
        applying = true;
        try {
          store.save(store.KEYS.records, mergeArrays(store.loadRecords(), data.records, localNewer));
          try { store.migrateMergeNotes(); } catch (e) {}
          store.save(store.KEYS.templates, mergeArrays(store.load(store.KEYS.templates) || [], data.templates, localNewer));
          store.save(store.KEYS.moves, store.dedupeMoves(mergeArrays(store.ensureMoves(), data.moves, localNewer)));
          if (Array.isArray(data.cats) && data.cats.length) {
            store.saveCats(util.mergeCats(store.cats(), data.cats, localNewer));
          }
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
        markOk('pull');
        // 本机原本没有记录、这次从云端拉回来了 → 提示 + 刷新当前页面
        const added = store.loadRecords().length - localBefore;
        if (localBefore === 0 && added > 0) notifyRestored(added);
        if (localNewer) schedule(800);
      })
      .catch(e => { markErr('pull', e); if (manual) notifyFail('拉取', e); })
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
  const c = cfg();
  c.lastEdit = lastLocalEditTs;
  saveCfg(c);
  schedule();
}

function init() {
  store.setAfterSave(onAfterSave);
  // 恢复上次运行的「本机最后改动时间」，否则重启后本机未推送的改动会被云端旧版盖掉
  lastLocalEditTs = Number(cfg().lastEdit) || 0;
  if (isDevtools()) return;  // 开发者工具里不做自动同步（可用设置页的手动按钮）
  ensureOpenid().then(() => { if (cfg().auto) setTimeout(() => pull(false), 800); });
  // 切回前台 / 网络恢复后：本机还有没推上去的改动就补推一次
  try {
    if (wx.onAppShow) {
      wx.onAppShow(() => {
        if (!cfg().auto || isDevtools()) return;
        if (pendingPush()) { lastPushFailed = false; retryDelay = 5000; push(false).then(() => { if (lastPushFailed) scheduleRetry(); }); }
      });
    }
  } catch (e) {}
  // 网络恢复 → 本机还有没推上去的改动就立刻补推（以前只有切回前台才补）
  try {
    if (wx.onNetworkStatusChange) {
      wx.onNetworkStatusChange(res => {
        if (!res || !res.isConnected) return;
        if (!cfg().auto || isDevtools()) return;
        if (!pendingPush()) return;
        const c2 = cfg(); c2.retryN = 0; saveCfg(c2);
        lastPushFailed = false;
        setTimeout(() => { push(false).then(() => { if (lastPushFailed) scheduleRetry(); }); }, 2000);
      });
    }
  } catch (e) {}
  // 启动时如果上次没推成功，等拉取结束再补推一次
  setTimeout(() => {
    if (!cfg().auto || isDevtools()) return;
    if (pendingPush()) push(false).then(() => { if (lastPushFailed) scheduleRetry(); });
  }, 3500);
}

function getAuto() { return !!cfg().auto; }
function setAuto(on) { const c = cfg(); c.auto = !!on; saveCfg(c); }

// 给设置页用：拿云端那份（自动处理分块），并给出上传体积
function remoteInfo() {
  return ensureOpenid().then(oid => {
    if (!oid) return null;
    return readRemote(oid).then(r => {
      if (!r) return null;
      const s = statsOf(r.payload);
      return { ts: r.ts, layout: r.layout, records: s.records, bytes: r.payload ? r.payload.length : 0 };
    });
  });
}
function localSize() { return payloadString().length; }

module.exports = { init, push, pull, getAuto, setAuto, listHistory, saveHistory, statsOf, stats, remoteInfo, localSize };
