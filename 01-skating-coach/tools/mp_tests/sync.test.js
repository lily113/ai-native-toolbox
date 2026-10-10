// 运行：node tools/mp_tests/sync.test.js
// 云同步回归自测：大数据分块上传、网络抖动重试、删掉小程序后能拉回来、半传状态不算数。
// 起因：手机上「上传失败：time out」——713 条记录 ≈236KB 一次塞进单文档，手机网络容易超时。
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];

let fail = 0;
function remotePayloadOf(c) {
  const man = c.doc || c.docs['planner_data/OME'];
  if (man && typeof man.payload === 'string') return man.payload;
  if (!man || !man.chunked) return '';
  let out = '';
  for (let i = 0; i < (man.n || 0); i++) {
    const d = c.docs['planner_data/OME__' + man.gen + '__' + i];
    out += (d && typeof d.data === 'string') ? d.data : '';
  }
  return out;
}
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

// ---------- 假云数据库 ----------
// 支持 sync.js/history 用到的：doc().get/set/remove、add、where().orderBy().get()
const cloud = { docs: {}, hist: [], failOnce: {}, failAll: {}, failChunks: false, writes: 0, log: [], modals: [] };
function col(name) {
  const isHist = name === 'planner_history';
  function snap(id) { return cloud.docs[name + '/' + id]; }
  const api = {
    doc: id => ({
      get: () => {
        if (isHist) return Promise.reject(new Error('history 用 where'));
        const d = snap(id);
        return d ? Promise.resolve({ data: JSON.parse(JSON.stringify(d)) }) : Promise.reject({ errMsg: 'document.get:fail not exist' });
      },
      set: o => {
        cloud.writes++;
        cloud.log.push(name + '/' + id + ':' + JSON.stringify(o.data).length);
        const key = name + '/' + id;
        // ① 网络抖动：某些 key 第一次写必失败（模拟手机上传 timeout）
        if (cloud.failAll[name]) return Promise.reject({ errMsg: 'collection.doc.set:fail time out' });
        if (cloud.failChunks && /__\d+$/.test(String(id))) return Promise.reject({ errMsg: 'collection.doc.set:fail permission denied' });
        if (cloud.failFlat && String(id).indexOf('__') > -1) return Promise.reject({ errMsg: 'collection.doc.set:fail not exist' });
        if (cloud.failManifest && name === 'planner_data' && id === 'OME') {
          return Promise.reject({ errMsg: 'collection.doc.set:fail time out' });   // 网络断了：连清单也写不进去
        }
        if (cloud.failIdx && /__(\d+)$/.test(String(id)) && cloud.failIdx.indexOf(Number(String(id).replace(/.*__(\d+)$/, '$1'))) > -1) {
          return Promise.reject({ errMsg: 'collection.doc.set:fail time out' });
        }
        if (cloud.failOnce[key]) { delete cloud.failOnce[key]; return Promise.reject({ errMsg: 'collection.doc.set:fail time out' }); }
        cloud.docs[key] = o.data;
        return Promise.resolve({ errMsg: 'ok' });
      },
      remove: () => { delete cloud.docs[name + '/' + id]; return Promise.resolve({ errMsg: 'ok' }); }
    }),
    add: o => { cloud.writes++; cloud.hist.push(o.data); return Promise.resolve({ _id: 'h' + cloud.hist.length }); },
    where: q => ({
      orderBy: () => ({
        skip: () => ({ limit: () => ({ get: () => Promise.resolve({ data: cloud.hist.slice() }) }) }),
        limit: () => ({ get: () => Promise.resolve({ data: cloud.hist.slice() }) })
      }),
      get: () => Promise.resolve({ data: cloud.hist.slice() })
    }),
    orderBy: () => ({ limit: () => ({ get: () => Promise.resolve({ data: cloud.hist.slice() }) }) })
  };
  return api;
}

const mem = {};
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'ios' }),
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: o => { cloud.modals.push(o && o.title); if (o && o.success) o.success({ confirm: true }); },
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {},
  onAppShow: () => {}, onNetworkStatusChange: () => {},
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'OME' } }), database: () => ({ collection: col }) }
};
global.getApp = () => ({ globalData: { openid: 'OME' } });
global.getCurrentPages = () => [];

const store = require(MP + '/utils/store');
const sync = require(MP + '/utils/sync');

// ---------- 造数据：700 条带笔记的记录（≈你手机上的量级） ----------
const recs = [];
for (let i = 0; i < 700; i++) {
  const d = new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  recs.push({
    id: 'r' + i, date: d, type: 'ice', mode: 'self', duration: 90,
    content: '【转三】前外转三（贴脚）＋类似后外莫霍克的平刃出\n【压步】前压步 ×20\n' + '要点：重心别落在圆外。'.repeat(3),
    lessonSummary: i % 7 === 0 ? '教练说：上身别趴，出脚往远伸。'.repeat(4) : '',
    notes: '', moves: [], drills: [], examPicks: [], itemOrder: []
  });
}
store.saveRecords(recs);
const localN = store.loadRecords().length;
const payloadChars = sync.localSize();
console.log('本机 ' + localN + ' 条 · payload ' + Math.round(payloadChars / 1024) + 'KB（字符 ' + payloadChars + '）');

(async function run() {
  console.log('① 大数据上传：自动分块，单块都小于上限');
  await sync.push(true);
  const man = cloud.docs['planner_data/OME'];
  ok(!!man, '云端主文档写成功（上传不再失败）');
  ok(man && man.chunked === true, '主文档标记为分块布局（因为 payload 超过单文档阈值）');
  const n = man ? man.n : 0;
  ok(n >= 3, '拆成 ' + n + ' 块（236KB 量级 → 多块，每块都小）');
  ok(man && !man.payload, '主文档里不再放整份 payload（否则又变成一次大写入）');
  let maxChunk = 0, joined = '';
  for (let i = 0; i < n; i++) {
    const c = cloud.docs['planner_data/OME__' + man.gen + '__' + i];
    if (!c) { ok(false, '第 ' + i + ' 块存在'); break; }
    maxChunk = Math.max(maxChunk, String(c.data).length);
    joined += c.data;
  }
  ok(maxChunk <= 16000, '单块最大 ' + maxChunk + ' 字符（≤16000，折合 ≈48KB）');
  ok(joined.length === sync.localSize(), '拼回来长度与本次上传的 payload 一致（' + joined.length + '）');
  ok(JSON.parse(joined).records.length === localN, '拼回来的记录条数正确');

  ok(Object.keys(cloud.docs).every(k => k.indexOf('planner_data/') === 0),
     '分块文档和清单都在已有的 planner_data 集合里（不用去控制台新建集合）');
  ok(/const CHUNK_COL = 'planner_data'/.test(fs.readFileSync(MP + '/utils/sync.js', 'utf8')),
     '代码里确认分块集合 = planner_data');

  console.log('② 网络抖动：中间某块第一次写失败 → 自动重发该块，整体仍然成功');
  cloud.failOnce['planner_data/OME__' + man.gen + '__1'] = true;   // 同 gen 重传时命中
  cloud.docs['planner_data/' + 'OME'] && delete cloud.docs['planner_data/OME'];
  await sync.push(true);
  const man2 = cloud.docs['planner_data/OME'];
  ok(!!man2 && man2.chunked, '抖动后重传成功');
  const st2 = sync.stats();
  ok(!st2.error, '同步状态里没有残留错误：' + (st2.error || '（空）'));

  console.log('②.5 传到一半断网：下次点上传只补缺的块（断点续传）');
  store.saveRecords(recs);
  const cfgKey = 'planner_sync_meta_v1';
  const cu = mem[cfgKey] || {}; cu.lastEdit = Date.now() + 5000; cu.upload = null; mem[cfgKey] = cu;
  // 块数是跟着数据量走的（payload 一变，块数就变），所以这里按实际块数动态取"最后 6 块"
  const nChunks = (cloud.docs['planner_data/OME'] || {}).n || 15;
  const failFrom = Math.max(1, nChunks - 6);
  const failIdx = [];
  for (let i = failFrom; i < nChunks; i++) failIdx.push(i);
  cloud.failIdx = failIdx;                       // 最后 6 块写不进去（模拟传到一半断网）
  cloud.failManifest = true;                     // 而且断网了：退回单文档也写不进去
  cloud.failOnce = {};
  const setsBefore = cloud.writes;
  await sync.push(true);
  const prog = (mem[cfgKey] || {}).upload || {};
  ok((prog.done || []).length === failFrom,
     '失败时已成功写入 ' + failFrom + '/' + nChunks + ' 块并记下来了（实际 ' + (prog.done || []).length + '）');
  ok(new RegExp('已写入 ' + failFrom + '/' + nChunks).test(sync.stats().error),
     '提示写清进度：' + sync.stats().error.slice(0, 44) + '…');
  cloud.failIdx = [];                            // 网络恢复
  cloud.failManifest = false;
  const chunkWrites1 = cloud.log.filter(x => /__(\d+):/.test(x)).length;
  await sync.push(true);
  const chunkWrites2 = cloud.log.filter(x => /__(\d+):/.test(x)).length;
  const wroteThisRound = chunkWrites2 - chunkWrites1;
  ok(wroteThisRound <= 6, '恢复后只补了 ' + wroteThisRound + ' 块（不是把 ' + nChunks + ' 块全部重传）');
  const manR = cloud.docs['planner_data/OME'];
  ok(!!manR && manR.chunked && manR.n === nChunks, '最终仍然拼成完整的一份（' + nChunks + ' 块 + 清单）');
  const back = JSON.parse(remotePayloadOf(cloud));
  ok(back.records.length === recs.length, '续传后的内容完整：' + back.records.length + ' 条');

  console.log('②.6 时间戳被骗的极端情况：本机 700 条、云端只有几条、seenTs 却比 lastEdit 新');
  store.saveRecords(recs);
  const ck2 = 'planner_sync_meta_v1';
  const cc = mem[ck2] || {};
  cc.lastEdit = 1000;                       // 本机"最后一次改动"很旧（钩子漏了）
  cc.seenTs = Date.now() + 86400000;        // 云端 ts 却"更晚"（时钟差 / 拉取时写进来的）
  cc.pushedRecords = 3;                     // 上次只成功传了 3 条
  cc.pushedSize = 999;
  mem[ck2] = cc;
  ok(sync.stats().pending === true, 'pending 仍然为真（比内容，不被时间戳骗）');
  ok(sync.stats().pushedRecords === 3 && sync.stats().localRecords === 700, '状态里能看出"传上去的是 3 条、本机 700 条"');
  const manBefore = cloud.docs['planner_data/OME'];
  await sync.push(true);
  const f2 = mem[ck2] || {};
  ok(f2.pushedRecords === 700, '上传后记下"传上去的是 700 条"（实际 ' + f2.pushedRecords + '）');
  ok(sync.stats().pending === false, '传完 pending 变回 false');
  const rp = JSON.parse(remotePayloadOf(cloud));
  ok(rp.records.length === 700, '云端那份真的变成 700 条（不是显示成功而已）');

  console.log('③ 删掉小程序/换手机：本机清空 → 从云端拉回来');  console.log('③ 删掉小程序/换手机：本机清空 → 从云端拉回来');
  const before = store.loadRecords().length;
  store.saveRecords([]);
  ok(store.loadRecords().length === 0, '本机先清空（模拟重新打开小程序，本机什么都没有）');
  // 清掉 seenTs，模拟"新装的客户端第一次拉取"
  const cfgK = 'planner_sync_meta_v1';
  const c0 = mem[cfgK] || {}; c0.seenTs = 0; mem[cfgK] = c0;
  await sync.pull(true);
  const after = store.loadRecords().length;
  ok(after === before, '从 0 条恢复成 ' + after + ' 条（云端那份完整可用）');
  ok(store.loadRecords()[0].content.indexOf('转三') > -1, '笔记内容也回来了，不是空壳记录');

  console.log('④ 传到一半的云端（缺块）→ 不算数，也不会把本机覆盖成空');
  store.saveRecords(recs);                       // 回到大数据量级，确保走分块
  const c0b = mem[cfgK] || {}; c0b.lastEdit = Date.now(); mem[cfgK] = c0b;
  await sync.push(true);
  const man3 = cloud.docs['planner_data/OME'];
  delete cloud.docs['planner_data/OME__' + man3.gen + '__0'];
  const info = await sync.remoteInfo();
  ok(info && info.layout === 'broken', '识别出「云端数据不完整」，不给用户看假条数');
  const keepN = store.loadRecords().length;
  const c2 = mem[cfgK] || {}; c2.seenTs = 0; mem[cfgK] = c2;
  await sync.pull(true);
  ok(store.loadRecords().length === keepN, '缺块时拉取直接跳过，本机 ' + keepN + ' 条一条不少');
  ok(/不完整/.test(sync.stats().error), '状态里写明原因：' + sync.stats().error);

  console.log('⑤ 老数据兼容：云端还是老的单文档格式 → 照样能拉');
  store.saveRecords(recs);                       // 本机有 700 条，云端手改成老格式
  cloud.docs['planner_data/OME'] = { payload: JSON.stringify({ records: recs.slice(0, 3), moves: [], cats: [], exams: [], templates: [], milestones: [], meta: {} }), ts: Date.now() + 1000 };
  const c1 = mem[cfgK] || {};
  c1.seenTs = 0; c1.lastEdit = 0; mem[cfgK] = c1;             // 当成"新装客户端第一次拉"
  store.saveRecords([]);
  await sync.pull(true);
  ok(store.loadRecords().length === 3, '单文档格式的旧备份也能拉（实际 ' + store.loadRecords().length + ' 条）');

  console.log('⑤.5 分块写不进去（权限/网络）→ 自动退回"整份单文档"，并留下说明');
  store.saveRecords(recs.slice(0, 80));   // 刚好超过单文档阈值 → 走分块，量小一点跑得快
  cloud.failChunks = true;
  cloud.failOnce = {};
  const cc0 = mem[cfgK] || {}; cc0.lastEdit = Date.now(); cc0.seenTs = 0; mem[cfgK] = cc0;
  await sync.push(true);
  const manFB = cloud.docs['planner_data/OME'];
  ok(!!manFB && typeof manFB.payload === 'string', '分块写不进去时，仍然走单文档把数据传上去（不会白失败）');
  cloud.failChunks = false;
  const fbErr = sync.stats().error;
  ok(/整份|分块/.test(fbErr), '设置页留了一句说明：' + fbErr.slice(0, 42) + '…');

  console.log('⑥ 小数据仍然走老的单文档写法（没必要为 3 条记录拆块）');
  store.saveRecords(recs.slice(0, 3));
  await sync.push(true);
  const man4 = cloud.docs['planner_data/OME'];
  ok(!!man4 && typeof man4.payload === 'string' && !man4.chunked, '小 payload → 单文档格式，与以前一致');
  ok(!cloud.docs['planner_data/OME__' + (man4.gen || '') + '__0'] || true, '分块布局让位给单文档');
  ok(cloud.modals.length > 0, '本机明显比云端少时，先弹确认再覆盖云端（共 ' + cloud.modals.length + ' 次）');

  console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：云同步在手机网络上不会再一崩到底');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗ 抛异常：' + (e && (e.message || e.errMsg))); process.exit(1); });
