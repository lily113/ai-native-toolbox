const store = require('./store');
const util = require('./util');

const CFG_KEY = 'planner_sync_meta_v1';
let pushTimer = null, busy = false, pulling = false, applying = false, lastLocalEditTs = 0;
let retryTimer = null, retryDelay = 5000, lastPushFailed = false;
const RETRY_STEPS = [5000, 15000, 45000, 120000, 180000, 300000, 600000];
// 本机有改动、但还没成功推上去（用于启动/切回前台时补推）
//
// ⚠️ 只比时间戳（lastEdit > seenTs）会被骗：seenTs 是"云端那份的更新时间"，
//    如果它比本机最后一次改动时间还新（时钟差异、拉取时把 seenTs 设成云端 ts、
//    某些写入路径没走到保存钩子……），就会出现"本机 713 条、云端 153 条，
//    但按钮说『本机没有未上传的改动』"——数据从此再也传不上去。
// 所以改成**比内容**：记下上次成功上传时本机有多少条、payload 多大。
function fingerprint() {
  const recs = store.loadRecords();
  let size = 0;
  try { size = payloadString().length; } catch (e) { size = 0; }
  return { n: recs.length, size: size };
}
function pendingPush() {
  const c = cfg();
  const f = fingerprint();
  if (f.n === 0 && !Number(c.pushedRecords)) return false;      // 本机本来就是空的，没什么可传
  if (c.pushedRecords === undefined || c.pushedRecords === null) return true;   // 从没成功传过
  if (f.n !== Number(c.pushedRecords)) return true;             // 条数变了 → 一定要传
  if (Number(c.pushedSize) && f.size !== Number(c.pushedSize)) return true;     // 内容变了 → 传
  return (Number(c.lastEdit) || 0) > (Number(c.seenTs) || 0);
}
// 上传成功后记下"传上去的就是这个样子"
function markPushed(payload) {
  const c = cfg();
  c.pushedSize = payload ? payload.length : fingerprint().size;
  c.pushedRecords = payload ? statsOf(payload).records : fingerprint().n;
  c.pushedAt = Date.now();
  saveCfg(c);
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
    pending: pendingPush(),         // 本机有改动还没推上去（比内容，不只看时间戳）
    pushedRecords: Number(c.pushedRecords) || 0,
    localRecords: store.loadRecords().length
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
// ⚠️ 分块就放在**已有的 planner_data 集合**里（用独立的文档 id），
//    这样不需要你去云开发控制台新建集合/配权限——少一步人为配置，就少一次上传失败。
const CHUNK_COL = 'planner_data';
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
// 3 块并发写：700 条 = 15 块，串行写要十几秒，用户切走 App 就可能被系统掐掉。
// 断点续传：已经写成功的块记在本地（cfg.upload.done），下次点上传只补没传的，
// 网络一直很差也能"每次往前挪一点"，而不是每次都从第 1 块重来。
function writeChunks(oid, gen, parts, doneList) {
  const done = {};
  (Array.isArray(doneList) ? doneList : []).forEach(i => { done[i] = 1; });
  let next = 0;
  const worker = () => {
    const i = next++;
    if (i >= parts.length) return Promise.resolve();
    if (done[i]) return worker();                 // 上次已经传成功的块，跳过
    return setChunk(oid, gen, i, parts[i], 3).then(() => {
      done[i] = 1;
      const c = cfg();
      if (c.upload && c.upload.gen === gen) {
        c.upload.done = (Array.isArray(c.upload.done) ? c.upload.done : []);
        if (c.upload.done.indexOf(i) < 0) c.upload.done.push(i);
        saveCfg(c);
      }
      return worker();
    });
  };
  const jobs = [];
  for (let k = 0; k < Math.min(3, parts.length); k++) jobs.push(worker());
  return Promise.all(jobs);
}
function writePayload(oid, payload, ts) {
  const col = wx.cloud.database().collection('planner_data');
  const prev = cfg().lastChunk || null;
  if (payload.length > SINGLE_LIMIT) {
    const parts = splitChunks(payload);
    // 上次传到一半的记录：长度和块数都没变就接着传（只补缺的块）
    const u0 = cfg().upload;
    const resume = (u0 && u0.len === payload.length && u0.total === parts.length && u0.gen) ? u0 : null;
    const gen = resume ? resume.gen : ts;
    const done = (resume && Array.isArray(resume.done)) ? resume.done.slice() : [];
    const cu = cfg();
    cu.upload = { gen: gen, len: payload.length, total: parts.length, done: done };
    saveCfg(cu);
    return writeChunks(oid, gen, parts, done)
      .then(() => col.doc(oid).set({ data: { chunked: true, gen: gen, n: parts.length, size: payload.length, ts: ts } }))
      .then(() => {
        const c2 = cfg(); c2.lastChunk = { gen: gen, n: parts.length }; c2.upload = null; saveCfg(c2);
        if (prev && prev.gen !== gen) return dropOldChunks(oid, prev.gen, prev.n);
      })
      .catch(e => {
        // 兜底：云环境里还没建 planner_data_chunks 集合（或分块被权限挡住）→ 退回老的单文档写法，
        // 至少别因为配置少一步就完全传不上去。
        const msg = String((e && (e.errMsg || e.message)) || '');
        fallbackNote = '这次没能用分块上传（' + msg + '），已改成"整份写一个文档"传上去。分块方式更稳，换到 Wi-Fi 后再点一次「立即重试上传」就会用回来。';
        return col.doc(oid).set({ data: { payload: payload, ts: ts } });
      });
  }
  // 小数据：还是单文档（和以前完全一样）
  return col.doc(oid).set({ data: { payload: payload, ts: ts } })
    .then(() => {
      const c2 = cfg(); c2.lastChunk = null; c2.upload = null; saveCfg(c2);
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
          return writePayload(oid, localPayload, ts)
            .then(() => {
              const c3 = cfg(); c3.seenTs = ts; c3.retryN = 0; saveCfg(c3);
              markPushed(localPayload);
              markOk('push'); lastPushFailed = false;
              if (fallbackNote) { const c4 = cfg(); c4.lastError = fallbackNote; c4.lastErrorAt = Date.now(); saveCfg(c4); fallbackNote = ''; }
            })
            .catch(e => {
              const u = cfg().upload;
              const n = (u && Array.isArray(u.done)) ? u.done.length : 0;
              const tot = (u && u.total) || 0;
              const wrapped = (tot && n) ? { message: '分块上传中断：已写入 ' + n + '/' + tot + ' 块，下次会自动接着传（' + ((e && (e.errMsg || e.message)) || '') + '）' } : e;
              markErr('push', wrapped); lastPushFailed = true;
              if (manual) notifyFail('上传', wrapped);
            });
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
          // 动作库：**深合并**（同 id / 同名都要把对方多出来的组合并进来），
          // 以前是"整条选一边"，云端/备份里更全的组合会被丢掉 = 外勾步组合消失的那类问题
          try {
            const mLib = store.mergeMoveLibraries(store.ensureMoves(), data.moves);
            store.save(store.KEYS.moves, mLib.moves);
            store.remapMoveRefs(mLib.moveMap, mLib.drillMap);
          } catch (e) { store.save(store.KEYS.moves, store.dedupeMoves(mergeArrays(store.ensureMoves(), data.moves, localNewer))); }
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
        if (localNewer || pendingPush()) schedule(800);
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

// ---------- 上传诊断：一步一步试，看到底卡在哪 ----------
// 上传失败的原因可能是：身份拿不到 / 读云端被权限挡住 / 写不进去 / 大请求超时。
// 这里按"小文档 → 48KB 块 → 整份"逐级试，每步都报耗时和原始错误。
function diagnose() {
  const out = { lines: [], openid: '', email: '' };
  const t0 = Date.now();
  const ms = () => (Date.now() - t0) + 'ms';
  const msgOf = e => String((e && (e.errMsg || e.message)) || e || '未知');
  const col = () => wx.cloud.database().collection('planner_data');
  const brief = o => o ? (o.slice(0, 8) + '…' + o.slice(-4)) : '';
  let oid = '';
  let testId = '';
  return ensureOpenid()
    .then(o => {
      oid = o || '';
      out.openid = oid;
      if (!oid) { out.lines.push('❌ 身份：拿不到 openid（云函数 login 没部署或环境 id 不对）'); throw new Error('stop'); }
      out.lines.push('✅ 身份：' + brief(oid) + '  ' + ms());
      testId = oid + '__selftest';
      return col().doc(oid).get()
        .then(r => {
          const d = (r && r.data) || {};
          const n = d.payload ? statsOf(d.payload).records : (d.chunked ? (Number(d.n) || 0) + ' 块' : 0);
          out.lines.push('✅ 读云端：记录 ' + n + '  ' + ms());
        })
        .catch(e => out.lines.push('⚠️ 读云端：' + msgOf(e) + '（还没上传过 / 权限不对，都可能是这句）  ' + ms()));
    })
    .then(() => col().doc(testId).set({ data: { kind: 'selftest', at: Date.now() } })
      .then(() => { out.lines.push('✅ 写小文档：成功（说明集合和权限没问题）  ' + ms()); })
      .catch(e => { out.lines.push('❌ 写小文档：' + msgOf(e) + '  ' + ms()); throw new Error('stop'); }))
    .then(() => col().doc(testId).set({ data: { kind: 'selftest', at: Date.now(), blob: '测'.repeat(16000) } })
      .then(() => out.lines.push('✅ 写 48KB：成功  ' + ms()))
      .catch(e => out.lines.push('❌ 写 48KB：' + msgOf(e) + '（小块都写不进去 → 手机网络或云环境问题）  ' + ms())))
    .then(() => {
      const size = localSize();
      const n = splitChunks(payloadString()).length;
      out.lines.push('· 本机数据 ' + Math.round(size / 1024) + 'KB，分 ' + n + ' 块上传，开始试…');
      const ts = Date.now();
      return writePayload(oid, payloadString(), ts)
        .then(() => {
          const c = cfg(); c.seenTs = ts; c.retryN = 0; saveCfg(c);
          markPushed(null); markOk('push'); lastPushFailed = false;
          out.lines.push('✅ 整份上传：成功（' + Math.round(size / 1024) + 'KB / ' + n + ' 块）  ' + ms());
        })
        .catch(e => {
          out.lines.push('❌ 整份上传：' + msgOf(e) + '（小文档能写、整份不行 → 基本就是网络太慢/请求被掐）  ' + ms());
        });
    })
    .catch(() => {})
    .then(() => col().doc(testId).remove().catch(() => {}))
    .then(() => { out.lines.push('· 已清掉诊断用的临时文档'); return out; });
}

module.exports = { init, push, pull, getAuto, setAuto, listHistory, saveHistory, statsOf, stats, remoteInfo, localSize, diagnose };
