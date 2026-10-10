const store = require('../../utils/store');
const { TYPES, MODES } = require('../../utils/const');
const util = require('../../utils/util');
const sync = require('../../utils/sync');
const app = getApp();

// 分享图的两个开关（默认都关：时长和教练名都可能是隐私）
function loadMetaShare() {
  const meta = store.load(store.KEYS.meta) || {};
  return Object.assign({ duration: false, coach: false }, meta.shareCard || {});
}

Page({
  data: {
    goal: 0,
    iceBase: 0,
    lessonBase: 0,
    openid: '',
    aiStatus: '检查中…',
    aiVisible: false,     // 只有你是本人时才会显示「AI 教练」这一行
    remindText: '',
    remindOn: false,        // 只在配好订阅消息模板后才显示这一行
    shareDuration: false,   // 分享图默认不带时长
    shareCoach: false,      // 分享图默认不带教练名
    dataWhere: '本机 0 条 · 云端 ? 条',
    syncErr: '',
    syncStatus: '未配置',
    auto: false,
    showImport: false,
    advOn: false,
    importText: '',
    // 升级自检状态（onShow 时用 guardInfo() 填）
    guardOk: true,
    guardText: '',
    snapText: ''
  },

  onShow() {
    const meta = store.load(store.KEYS.meta) || {};
    this.setData(this.guardInfo());
    this.refreshAiStatus();
    this.refreshDataWhere();
    this.setData({
      goal: meta.weeklyIceGoal || 0,
      iceBase: Number(meta.iceBase) || 0,
      lessonBase: Number(meta.lessonBase) || 0,
      openid: app.globalData.openid,
      auto: sync.getAuto(),
      ver: require('../../utils/const').APP_VERSION,
      remindText: this.remindInfo(),
      remindOn: this.remindVisible(),
      shareDuration: !!(loadMetaShare().duration),
      shareCoach: !!(loadMetaShare().coach),
      recN: store.loadRecords().length
    });
    if (app.globalData.openid) this.refreshSync();
    else this.fetchOpenid();
  },

  onReady() {
    this.fetchOpenid();
  },

  // 「数据在哪」：本机多少条、云端多少条、上次同步时间、上次失败原因 —— 一眼看出云端有没有备份
  refreshDataWhere() {
    const st = sync.stats ? sync.stats() : {};
    const local = store.loadRecords().length;
    const fmt = t => {
      if (!t) return '从未';
      const d = new Date(t);
      const p = n => (n < 10 ? '0' + n : '' + n);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    };
    const tail = [];
    if (st.pushAt) tail.push('上次上传 ' + fmt(st.pushAt));
    if (st.pullAt) tail.push('上次拉取 ' + fmt(st.pullAt));
    if (st.pending) tail.push('⚠️ 有改动还没传上去');
    this.setData({
      syncErr: st.error ? (st.error + (st.errorAt ? '（' + fmt(st.errorAt) + '）' : '')) : '',
      dataWhere: '本机 ' + local + ' 条 · 云端 ' + (this.data.cloudCount === undefined ? '?' : this.data.cloudCount) + ' 条'
        + (tail.length ? ' · ' + tail.join(' · ') : '')
    });
    // 真正去云端问一次（自动处理分块），拿到"云端到底有没有备份"
    const oid = app.globalData.openid || this.data.openid;
    if (!oid) return;
    sync.remoteInfo()
      .then(info => {
        if (!info) throw new Error('no remote');
        if (info.layout === 'broken') {
          this.setData({ cloudCount: -1, dataWhere: '本机 ' + store.loadRecords().length + ' 条 · ⚠️ 云端数据不完整（上次传到一半），请点「上传」重传一次' });
          return;
        }
        const s2 = { records: info.records };
        const localN = store.loadRecords().length;
        const sizeKb = Math.round(sync.localSize() / 1024);
        const behind = localN - s2.records;
        const meta0 = store.load(store.KEYS.meta) || {};
        const lastExp = Number(meta0.lastExportAt) || 0;
        const days = lastExp ? Math.floor((Date.now() - lastExp) / 86400000) : -1;
        const expTip = (days < 0) ? '⚠️ 还没导出过备份，建议现在导出一份' :
          (days > 30 ? '⚠️ 已经 ' + days + ' 天没导出备份了' : '');
        this.setData({
          cloudCount: s2.records,
          dataWhere: '本机 ' + localN + ' 条（约 ' + sizeKb + 'KB）· 云端 ' + s2.records + ' 条'
            + (behind > 5 ? '（⚠️ 云端比本机少 ' + behind + ' 条，建议点上方「上传」）' : '')
            + (tail.length ? ' · ' + tail.join(' · ') : '')
            + (expTip ? '\n' + expTip : '')
        });
      })
      .catch(() => {
        this.setData({ cloudCount: 0 });
        this.setData({ dataWhere: '本机 ' + store.loadRecords().length + ' 条 · 云端读取失败（见下方提示）' });
      });
  },

  // 复制 openid：配云函数的 OWNER_OPENID 环境变量时直接粘，不用手打 28 位
  // 上传失败时的一键重试：不用等自动退避，也不用再改一次数据
  retryUpload() {
    const st = sync.stats();
    const localN = st.localRecords || store.loadRecords().length;
    const cloudN = this.data.cloudCount;
    const cloudBehind = (typeof cloudN === 'number' && cloudN >= 0 && cloudN !== localN);
    // 以前这里只要 pending=false 就拒绝上传——而 pending 是比时间戳算出来的，
    // 一旦被时钟/时间戳骗到，就会出现"云端比本机少 560 条，但按钮说没有未上传的改动"，
    // 数据从此再也传不上去。所以：只要本机和云端对不上，就允许（并确认）上传。
    if (!st.pending && !cloudBehind) { wx.showToast({ title: '本机没有未上传的改动', icon: 'none' }); return; }
    if (!st.pending && cloudBehind) {
      wx.showModal({
        title: '要用本机覆盖云端吗',
        content: '本机 ' + localN + ' 条 · 云端 ' + cloudN + ' 条。\n同步状态以为已经传过了，但两边条数不一致（可能是同步时间戳被别的情况影响）。\n\n确定把本机这份传上去吗？云端旧版会自动存成历史，可回滚。',
        confirmText: '上传本机',
        success: r => { if (r.confirm) this.doRetryUpload(); }
      });
      return;
    }
    this.doRetryUpload();
  },

  doRetryUpload() {
    wx.showLoading({ title: '正在上传…', mask: true });
    // 兜底：万一网络卡住没回调，最多 45 秒也要把转圈关掉
    const guard = setTimeout(() => { try { wx.hideLoading(); } catch (e) {} }, 45000);
    Promise.resolve()
      .then(() => sync.push(true))
      .then(() => new Promise(r => setTimeout(r, 600)))
      .then(() => {
        clearTimeout(guard);
        wx.hideLoading();
        const st = sync.stats();
        if (st.error && st.pending) {
          wx.showModal({
            title: '还是没传上去',
            content: st.error + '\n\n本机数据没受影响，云端那份也还是完整的。\n\n① 先换网络（连 Wi-Fi）再点一次；\n② 还不行就点「确定」跑一遍逐级诊断，看清卡在哪一步。',
            confirmText: '跑诊断',
            cancelText: '知道了',
            success: r => { if (r.confirm) this.diagnose(); }
          });
        } else {
          wx.showToast({ title: '已上传到云端' });
        }
        this.onShow();
      })
      .catch(() => { clearTimeout(guard); wx.hideLoading(); wx.showToast({ title: '上传失败，稍后再试', icon: 'none' }); });
  },

  // ---------- 分享图里放不放"时长 / 教练名"（默认都不放）----------
  toggleShareField(e) {
    const k = e.currentTarget.dataset.k;      // 'duration' | 'coach'
    const meta = store.load(store.KEYS.meta) || {};
    const cfg = Object.assign({ duration: false, coach: false }, meta.shareCard || {});
    cfg[k] = !cfg[k];
    meta.shareCard = cfg;
    store.save(store.KEYS.meta, meta);
    this.setData({ shareDuration: cfg.duration, shareCoach: cfg.coach });
    wx.showToast({ title: (k === 'duration' ? '时长' : '教练名') + (cfg[k] ? ' 会出现在分享图上' : ' 不放进分享图'), icon: 'none' });
  },

  // 考级提醒：订阅消息（需要先在公众平台申请模板，把模板 ID 填进 const.js）
  setupReminder() {
    const TMPL = require('../../utils/const').SUBSCRIBE_TMPL;
    if (!TMPL) {
      wx.showModal({
        title: '考级提醒还没配好',
        content: '小程序给你发微信提醒，需要先在微信公众平台申请一个「订阅消息」模板：\n\n1. 公众平台 → 功能 → 订阅消息 → 公共模板库，搜索"考试"或"日程提醒"，选一个合适的模板\n2. 把模板 ID 填进 `utils/const.js` 的 SUBSCRIBE_TMPL\n3. 部署云函数 `remind`（它的 config.json 里已经写好每天 9 点的定时触发器）\n4. 回到这里点一下，微信会弹一次授权\n\n没配之前这一项不影响其他功能。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [TMPL],
      success: res => {
        const ok = res[TMPL] === 'accept';
        const meta = store.load(store.KEYS.meta) || {};
        meta.subscribeExam = { on: ok, at: Date.now() };
        store.save(store.KEYS.meta, meta);
        this.setData({ remindOn: ok });
        wx.showToast({ title: ok ? '已开启考级提醒' : '你拒绝了授权', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '订阅失败，稍后再试', icon: 'none' })
    });
  },
  // 没配订阅消息模板时，这一行对整个界面隐藏（发布时别让审核看到"没配好的功能"）；
  // 想配置就先把模板 ID 填进 utils/const.js 的 SUBSCRIBE_TMPL，这一行会自动出现。
  remindInfo() {
    const TMPL = require('../../utils/const').SUBSCRIBE_TMPL;
    const meta = store.load(store.KEYS.meta) || {};
    const st = meta.subscribeExam || {};
    if (!TMPL) return '';
    return st.on ? '已开启（考级前 7 天提醒一次）' : '未开启';
  },
  remindVisible() { return !!require('../../utils/const').SUBSCRIBE_TMPL; },

  copyOpenid() {
    if (!this.data.openid) { wx.showToast({ title: '还没取到身份', icon: 'none' }); return; }
    wx.setClipboardData({
      data: this.data.openid,
      success: () => wx.showToast({ title: '已复制，粘到云函数的 OWNER_OPENID' })
    });
  },

  // AI 教练当前对谁开放（真实判定在云函数里，这里只是显示）
  refreshAiStatus() {
    const app = getApp();
    const apply = () => {
      const g = (app && app.globalData) || {};
      // 普通用户不需要知道"本人/鉴权"这些内部概念：只有你是本人时才显示这一行
      const visible = !!g.isOwner;
      const s = g.isOwner ? '已开放（仅你自己能用）' : '';
      this.setData({ aiVisible: visible, aiStatus: s });
    };
    apply();
    try {
      wx.cloud.callFunction({ name: 'login' }).then(r => {
        const res = (r && r.result) || {};
        if (app && app.globalData) {
          if (res.openid) app.globalData.openid = res.openid;
          app.globalData.isOwner = !!res.isOwner;
          app.globalData.ownerConfigured = !!res.ownerConfigured;
        }
        if (res.openid) this.setData({ openid: res.openid });
        apply();
      }).catch(() => {});
    } catch (e) {}
  },

  // 升级自检状态：上次换版本时有没有少记录 / 少文字，以及本机有没有升级前快照
  guardInfo() {
    const chk = store.upgradeCheck();
    const snap = store.upgradeSnapshotInfo();
    const d = new Date((chk && chk.at) || Date.now());
    const when = d.getFullYear() + '-' + store.pad(d.getMonth() + 1) + '-' + store.pad(d.getDate());
    let text = '暂无升级记录（当前版本 ' + require('../../utils/const').APP_VERSION + '）';
    let ok = true;
    if (chk) {
      if (chk.ok) {
        text = '上次升级自检通过：' + when + '（' + chk.before + ' → ' + chk.after + ' 条记录，笔记文字都在）';
      } else {
        ok = false;
        text = '⚠️ 上次升级自检未通过：' + when + '（记录 ' + chk.before + ' → ' + chk.after
          + (chk.lost ? '，' + chk.lost + ' 行笔记没找到' : '') + '），建议用下方「恢复升级前数据」';
      }
    }
    const snapText = snap ? (snap.version + ' · ' + snap.records + ' 条') : '';
    return { guardOk: ok, guardText: text, snapText: snapText };
  },

  // 修复动作库：把"本机 / 云端历史快照 / 升级前快照"里的动作库深度合并，
  // 找回被早期版本吃掉的动作组合（例如外勾步下面的组合）。
  repairMoves() {
    const K = store.KEYS;
    const srcs = [];
    const local = store.ensureMoves();
    srcs.push({ label: '本机', moves: local });
    // 升级前快照的结构是 { version, at, payload:{ moves, records, ... } }
    const snap = store.load(K.upgradeSnap);
    const snapMoves = snap && ((snap.payload && snap.payload.moves) || snap.moves);
    if (Array.isArray(snapMoves)) srcs.push({ label: '升级前快照', moves: snapMoves });
    const before = local.reduce((n, m) => n + ((m.drills || []).length), 0);
    wx.showLoading({ title: '正在翻云端历史…', mask: true });
    sync.listHistory(5)
      .catch(() => [])
      .then(list => {
        (list || []).forEach((h, i) => {
          try {
            const d = JSON.parse(h.payload);
            if (d && Array.isArray(d.moves)) srcs.push({ label: '云端历史 #' + (i + 1), moves: d.moves });
          } catch (e) {}
        });
        wx.hideLoading();
        let lib = local;
        const found = [];      // 找回来的组合
        srcs.slice(1).forEach(src => {
          const beforeNames = {};
          lib.forEach(m => (m.drills || []).forEach(d => { beforeNames[m.name + '|' + d.name] = 1; }));
          const r = store.mergeMoveLibraries(lib, src.moves);
          lib = r.moves;
          lib.forEach(m => (m.drills || []).forEach(d => {
            const k = m.name + '|' + d.name;
            if (!beforeNames[k] && found.length < 40) found.push(src.label + '：' + m.name + ' → ' + d.name);
          }));
        });
        const after = lib.reduce((n, m) => n + ((m.drills || []).length), 0);
        const gained = after - before;
        if (!gained) {
          wx.showModal({
            title: '动作库检查完毕',
            content: '翻了 ' + (srcs.length - 1) + ' 份备份，没有找到本机缺的组合（本机现有 ' + before + ' 个组合）。\n\n如果你记得某个动作该有哪几个组合，直接到「动作库 → 该动作 → ＋ 添加组合」补上就行；用过的组合名字可以在训练记录的笔记里看到。',
            showCancel: false
          });
          return;
        }
        const detail = found.slice(0, 8).join('\n') + (found.length > 8 ? '\n…' : '');
        wx.showModal({
          title: '找回 ' + gained + ' 个组合',
          content: '本机原来 ' + before + ' 个组合 → 现在 ' + after + ' 个（来自 ' + srcs.length + ' 份数据）。\n\n' + detail,
          confirmText: '保存并上传',
          success: r2 => {
            if (!r2.confirm) return;
            store.saveMoves(lib);
            wx.showToast({ title: '已补回 ' + gained + ' 个组合', icon: 'none', duration: 2500 });
            // 顺手推上去，免得只修好本机、云端还是缺组合的那份
            try { sync.push(true); } catch (e) {}
            this.refreshDataWhere();
          }
        });
      });
  },

  restoreUpgrade() {
    const snap = store.upgradeSnapshotInfo();
    if (!snap) { wx.showToast({ title: '没有升级前快照', icon: 'none' }); return; }
    const d = new Date(snap.at || Date.now());
    wx.showModal({
      title: '恢复升级前的数据',
      content: '快照来自 ' + snap.version + '（' + d.toLocaleString() + '，' + snap.records + ' 条记录）。\n\n会把这份快照合并回来（只补缺失、不删除现有记录）。确定？',
      success: r => {
        if (!r.confirm) return;
        try { store.save('figure_skating_planner_records_backup_v1', { at: Date.now(), records: store.loadRecords() }); } catch (e) {}
        const out = store.restoreUpgradeSnapshot();
        this.refreshSync();
        wx.showModal({ title: '已恢复', showCancel: false, content: out ? ('合并回 ' + out.records + ' 条记录，当前共 ' + store.loadRecords().length + ' 条。') : '没有可恢复的快照。' });
      }
    });
  },

  fetchOpenid() {
    wx.cloud.callFunction({ name: 'login' })
      .then(r => {
        const oid = r && r.result && r.result.openid;
        if (oid) { app.globalData.openid = oid; this.setData({ openid: oid }); this.refreshSync(); }
      })
      .catch(() => {
        this.setData({ syncStatus: '未获取 openid：请在开发者工具开通云开发，并右击 cloudfunctions/login 部署' });
      });
  },

  refreshSync() {
    if (!this.data.openid) return;
    const db = wx.cloud.database();
    db.collection('planner_data').doc(this.data.openid).get()
      .then(res => {
        const ts = (res.data && res.data.ts) || 0;
        this.setData({ syncStatus: '上次同步：' + (ts ? new Date(ts).toLocaleString() : '从未') });
      })
      .catch(() => this.setData({ syncStatus: '云端暂无数据（点「上传到云」完成首次）' }));
  },

  setGoal(e) { this.setData({ goal: e.detail.value }); },
  setIceBase(e) { this.setData({ iceBase: e.detail.value }); },
  setLessonBase(e) { this.setData({ lessonBase: e.detail.value }); },
  saveBase() {
    const meta = store.load(store.KEYS.meta) || {};
    meta.iceBase = Number(this.data.iceBase) || 0;
    meta.lessonBase = Number(this.data.lessonBase) || 0;
    store.save(store.KEYS.meta, meta);
    wx.showToast({ title: '已保存基线' });
  },
  quickGoal(e) {
    const v = Number(e.currentTarget.dataset.v) || 0;
    this.setData({ goal: v });
  },
  saveGoal() {
    const meta = store.load(store.KEYS.meta) || {};
    meta.weeklyIceGoal = Number(this.data.goal) || 0;
    store.save(store.KEYS.meta, meta);
    wx.showToast({ title: '已保存' });
  },

  // 导出为文件（全过程都有可见反馈）
  exportFile() {
    let path = '', name = '';
    try {
      wx.showLoading({ title: '正在打包…' });
      const data = JSON.stringify(util.buildPayload());
      const now = new Date();
      const pad = n => (n < 10 ? '0' + n : '' + n);
      name = '花样滑冰训练备份_' + store.todayKey() + '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.json';
      const dir = (wx.env && wx.env.USER_DATA_PATH) ? wx.env.USER_DATA_PATH : '';
      path = dir + '/' + name;
      wx.getFileSystemManager().writeFileSync(path, data, 'utf-8');
      // 记下导出时间（用于「多久没备份」提醒）
      try {
        const meta = store.load(store.KEYS.meta) || {};
        meta.lastExportAt = Date.now();
        store.save(store.KEYS.meta, meta);
      } catch (e) {}
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '❌ 生成文件失败', showCancel: false, content: String((e && e.errMsg) || e) });
      return;
    }

    let devtools = false;
    try { devtools = String(wx.getSystemInfoSync().platform).toLowerCase() === 'devtools'; } catch (e) {}

    if (devtools || typeof wx.shareFileMessage !== 'function') {
      wx.showModal({
        title: '✅ 文件已生成', showCancel: false,
        content: '文件：' + name + '\n位置：\n' + path +
          '\n\n（开发者工具 / 旧版微信不支持“发送文件”；请在**手机上**点这个按钮，会弹出微信“发送给聊天”，选「文件传输助手」保存。）'
      });
      return;
    }

    wx.showModal({
      title: '导出为文件',
      content: '已生成：' + name + '\n\n点「发送」会打开微信联系人列表，请选「文件传输助手」或发给自己保存。',
      confirmText: '发送',
      success: r => {
        if (!r.confirm) return;
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          wx.showModal({ title: '已生成文件', showCancel: false, content: '未收到系统回调（可能被取消）。\n文件：' + name + '\n位置：\n' + path });
        }, 4000);
        wx.shareFileMessage({
          filePath: path,
          fileName: name,
          success: () => { done = true; clearTimeout(timer); wx.showToast({ title: '已发送，记得在聊天里保存' }); },
          fail: err => {
            done = true; clearTimeout(timer);
            wx.showModal({ title: '未能发送文件', showCancel: false,
              content: '原因：' + String((err && err.errMsg) || err) + '\n\n文件已生成在：\n' + path });
          }
        });
      }
    });
  },

  // 从微信聊天里选 .json 文件导入

  extras() {
    const recs = store.loadRecords();
    const byDay = {};
    recs.forEach(r => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    // a) 一天多条记录（可能跨方式重复）
    const multi = Object.keys(byDay).filter(d => byDay[d].length > 1).sort();
    const linesA = multi.slice(-12).map(d => {
      const parts = byDay[d].map(r => (MODES[r.mode] ? MODES[r.mode].name : r.mode) + '(' + (r.duration || 0) + '分' + (r.mode === 'lesson' ? '/' + (Number(r.units) || 1) + '节' : '') + ')' + (String(r.id).indexOf('imp-') === 0 ? '★导入' : ''));
      return d + '：' + parts.join(' ｜ ');
    });
    // b) 流水账结束后的新记录
    const late = recs.filter(r => r.date > '2026-07-02').sort((a, b) => a.date < b.date ? -1 : 1);
    const linesB = late.map(r => r.date + ' ' + (MODES[r.mode] ? MODES[r.mode].name : r.mode) + ' ' + (r.duration || 0) + '分'
      + (String(r.id).indexOf('imp-') === 0 ? ' ★导入' : '') + (r.content ? ' · ' + String(r.content).split('\n')[0].slice(0, 12) : ''));
    const txt = '【一天有多条记录的日期】共 ' + multi.length + ' 天' + (multi.length > 12 ? '（显示最近 12 天）' : '')
      + '\n' + (linesA.join('\n') || '（无）')
      + '\n\n【流水账结束(2026-07-02)之后的新记录】共 ' + late.length + ' 条\n'
      + (linesB.join('\n') || '（无）')
      + '\n\n★导入 = 来自导入文件（节数由你的编号反推，最准）';
    wx.showModal({ title: '多出的记录', content: txt, showCancel: false });
  },


  overview() {
    const recs = store.loadRecords();
    const by = {};
    recs.forEach(r => {
      const k = (TYPES[r.type] ? TYPES[r.type].name : r.type) + ' · ' + (MODES[r.mode] ? MODES[r.mode].name : r.mode);
      by[k] = (by[k] || 0) + 1;
    });
    const lines = Object.keys(by).sort().map(k => k + '：' + by[k] + ' 条');
    const lessonUnits = recs.filter(r => r.mode === 'lesson').reduce((n, r) => n + (Number(r.units) || 1), 0);
    const dates = recs.map(r => r.date).sort();
    const meta = store.load(store.KEYS.meta) || {};
    // 失效引用：记录里勾的动作如果已经被删掉，首页卡片就不显示这条动作（文字不受影响）
    let danglingTxt = '';
    try {
      const moves = store.ensureMoves();
      const has = {};
      moves.forEach(m => { has[m.id] = 1; });
      let n = 0, lastDate = '';
      recs.forEach(r => {
        if ((r.moves || []).some(id => !has[id])) { n++; if (r.date > lastDate) lastDate = r.date; }
      });
      if (n) danglingTxt = '\n失效动作引用：' + n + ' 条记录（动作已删，笔记文字仍在；最近 ' + lastDate + '）';
    } catch (e) { danglingTxt = ''; }
    // 云文档上限 1MB：顺手把真实上传体积算出来，上传/发布前能确认还剩多少余量
    let sizeTxt = '';
    try {
      const kb = JSON.stringify(util.buildPayload()).length / 1024;
      sizeTxt = '\n\n云端体积：' + (kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB')
        + ' / 1024 KB' + (kb > 900 ? '  ⚠️ 接近上限，建议先导出备份' : '');
    } catch (e) { sizeTxt = ''; }
    const txt = '总记录 ' + recs.length + ' 条（' + (dates[0] || '—') + ' ~ ' + (dates[dates.length - 1] || '—') + '）\n\n'
      + lines.join('\n')
      + '\n\n所有上课记录的节数合计 = ' + lessonUnits
      + '\n基线：上冰 ' + (Number(meta.iceBase) || 0) + ' · 上课 ' + (Number(meta.lessonBase) || 0)
      + danglingTxt
      + sizeTxt

    wx.showModal({ title: '数据概览', content: txt, showCancel: false });
  },

  dedupeRecords() {
    const recs = store.loadRecords();
    // 先按“同日期+同类型+同方式”分组
    const groups = {};
    recs.forEach(r => {
      const k = r.date + '|' + r.type + '|' + r.mode;
      (groups[k] = groups[k] || []).push(r);
    });
    // 再按“同日期+同类型”整体看（找出同日但方式不同的）
    const byDay = {};
    recs.forEach(r => { const k = r.date + '|' + r.type; (byDay[k] = byDay[k] || []).push(r); });

    const plan = [];
    Object.keys(groups).forEach(k => {
      const g = groups[k];
      if (g.length > 1) plan.push({ key: k, mode: 'same', group: g });
    });
    Object.keys(byDay).forEach(k => {
      const g = byDay[k];
      const modes = {};
      g.forEach(r => { modes[r.mode] = true; });
      if (Object.keys(modes).length > 1) {
        const hasImp = g.some(r => String(r.id).indexOf('imp-') === 0);
        if (hasImp) plan.push({ key: k + '(跨方式)', mode: 'cross', group: g });
      }
    });
    if (!plan.length) { wx.showToast({ title: '没有可合并的重复记录', icon: 'none' }); return; }
    const extra = plan.reduce((n, p) => n + p.group.length - 1, 0);
    const listTxt = plan.slice(0, 8).map(p => p.key).join('\n') + (plan.length > 8 ? '\n…' : '');
    wx.showModal({
      title: '合并重复记录',
      content: '发现 ' + plan.length + ' 组重复，可合并掉 ' + extra + ' 条：\n' + listTxt +
        '\n\n规则：优先保留「导入的」那条（节数最准），把旧记录的文字并进同一份笔记，再删掉多余条目。合并前会自动备份。确定？',
      success: r => {
        if (!r.confirm) return;
        try { store.save('figure_skating_planner_records_backup_v1', { at: Date.now(), records: recs }); } catch (e) {}
        const drop = {};
        let removed = 0;
        plan.forEach(p => {
          const g = p.group;
          let primary = g.filter(x => String(x.id).indexOf('imp-') === 0)[0];
          if (!primary && p.mode === 'cross') return;                     // 跨方式且没有导入记录 → 不动
          if (!primary) primary = g.slice().sort((a, b) => String(b.content || '').length - String(a.content || '').length)[0];
          const lines = [];
          g.forEach(x => String(x.content || '').split('\n').forEach(l => {
            const t = l.trim(); if (t && lines.indexOf(t) < 0) lines.push(t);
          }));
          primary.content = lines.join('\n');
          if (g.some(x => x.status === 'done')) primary.status = 'done';
          primary.units = Number(primary.units) || 1;
          g.forEach(x => { if (x.id !== primary.id) { drop[x.id] = true; removed++; } });
        });
        const out = store.loadRecords().filter(r => !drop[r.id]);
        store.saveRecords(out);
        this.refreshSync();
        wx.showModal({
          title: '已合并', showCancel: false,
          content: '合并了 ' + removed + ' 条，现有 ' + out.length + ' 条。\n如需回退：用「↩︎ 恢复导入前」。'
        });
      }
    });
  },

  restoreRecords() {
    const bak = store.load('figure_skating_planner_records_backup_v1');
    if (!bak || !Array.isArray(bak.records) || !bak.records.length) {
      wx.showToast({ title: '没有可恢复的备份', icon: 'none' }); return;
    }
    const t = new Date(bak.at || Date.now());
    wx.showModal({
      title: '恢复导入前的记录',
      content: '备份时间：' + t.toLocaleString() + '\n共 ' + bak.records.length + ' 条。\n\n将把备份里的记录合并回来（只补缺失、不删除现有）。确定？',
      success: r => {
        if (!r.confirm) return;
        store.saveRecords(util.mergeById(store.loadRecords(), bak.records.map(store.normalizeRecord)));
        this.refreshSync();
        wx.showToast({ title: '已恢复' });
      }
    });
  },

  chooseImportFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        wx.showLoading({ title: '读取中…' });
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: 'utf-8',
          success: r => {
            wx.hideLoading();
            try {
              const d = JSON.parse(r.data);
              util.applyPayload(d);
              this.refreshSync();
              wx.showToast({ title: '导入完成' });
            } catch (e) {
              wx.showToast({ title: '文件解析失败（不是有效 JSON）', icon: 'none' });
            }
          },
          fail: err => {
            wx.hideLoading();
            wx.showToast({ title: '读取失败：' + String((err && err.errMsg) || err), icon: 'none' });
          }
        });
      }
    });
  },

  toggleImport() { this.setData({ showImport: !this.data.showImport }); },
  toggleAdv() { this.setData({ advOn: !this.data.advOn }); },
  setImportText(e) { this.setData({ importText: e.detail.value }); },
  doImport() {
    try {
      const d = JSON.parse(this.data.importText);
      util.applyPayload(d);
      wx.showToast({ title: '导入完成' });
      this.setData({ showImport: false, importText: '' });
    } catch (e) {
      wx.showToast({ title: '导入失败：格式不正确', icon: 'none' });
    }
  },

  toggleAuto(e) {
    const on = !!e.detail.value;
    sync.setAuto(on);
    this.setData({ auto: on });
    if (on) {
      wx.showToast({ title: '已开启自动同步' });
      setTimeout(() => sync.pull(false), 600);
    } else {
      wx.showModal({
        title: '⚠️ 关闭自动同步的后果',
        content: '关闭后：本机改动不会再上传云端。\n\n一旦删除小程序或换手机，本机数据会被清空，而云端只有关闭之前的版本，之后记的内容会丢。\n\n建议保持开启；如果确实要关，请定期「导出为文件」备份。',
        confirmText: '仍要关闭',
        cancelText: '保持开启',
        success: r => {
          if (r.confirm) { wx.showToast({ title: '已关闭，记得定期导出备份', icon: 'none', duration: 3000 }); return; }
          sync.setAuto(true);
          this.setData({ auto: true });
          wx.showToast({ title: '已保持开启' });
        }
      });
    }
  },

  diagnose() {
    const meta = store.load(store.KEYS.meta) || {};
    const exams = store.ensureExams();
    const localItems = exams.reduce((n, e) => n + ((e.myItems || []).length), 0);
    const bak = store.load('figure_skating_planner_exams_backup_v1');
    const byKey = {};
    exams.forEach(e => (e.myItems || []).forEach(it => {
      const k = it.sectionKey || '(空)';
      byKey[k] = (byKey[k] || 0) + 1;
    }));
    const keyTxt = Object.keys(byKey).map(k => k + ':' + byKey[k]).join('、') || '无';
    let extraCnt = 0;
    exams.forEach(e => Object.keys(e.itemExtra || {}).forEach(k => {
      const v = e.itemExtra[k] || {};
      if ((v.points || []).length || (v.mistakes || []).length || v.note || v.moveId) extraCnt++;
    }));
    localTxt += '\n本机数据体积：' + Math.round(sync.localSize() / 1024) + 'KB';
    // 逐级试写：小文档 → 48KB → 整份，直接看出卡在哪一步
    wx.showLoading({ title: '正在逐级试写…', mask: true });
    sync.diagnose()
      .then(r => {
        wx.hideLoading();
        const body = localTxt + '\n' + ((r && r.lines) || []).join('\n');
        wx.showModal({
          title: '同步诊断',
          content: body,
          confirmText: '复制结果',
          cancelText: '好',
          success: res => {
            if (!res.confirm) return;
            wx.setClipboardData({
              data: '【花样滑冰训练 · 同步诊断】\n' + body + '\n云环境：cloud1-d3gxrubwgdf9f71c7',
              success: () => wx.showToast({ title: '已复制，把它发给我', icon: 'none', duration: 2500 })
            });
          }
        });
      })
      .catch(e => {
        wx.hideLoading();
        wx.showModal({ title: '同步诊断', content: localTxt + '\n诊断本身出错了：' + ((e && (e.errMsg || e.message)) || e), showCancel: false });
      });
    sync.listHistory(5).then(list => {
      if (!list.length) return;
      const t = new Date(list[0].at || 0);
      this.setData({ syncStatus: '✅ 云端有 ' + list.length + ' 个历史版本（最近 ' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + t.getHours() + ':' + t.getMinutes() + '）' });
    });
  },

  rollback() {
    const oid = app.globalData.openid;
    if (!oid) { wx.showToast({ title: '未获取身份', icon: 'none' }); return; }
    wx.showLoading({ title: '读取云端历史…' });
    sync.listHistory(5).then(list => {
      wx.hideLoading();
      if (!list.length) {
        wx.showModal({
          title: '云端历史版本', showCancel: false,
          content: '暂时没有历史版本。\n\n说明：需要先在「云开发控制台 → 数据库」新建集合 planner_history（权限：仅创建者可读写）；之后每次上传都会把被覆盖的旧版自动存一份。'
        });
        return;
      }
      const items = list.map((d, i) => {
        const s2 = sync.statsOf(d.payload);
        const t = new Date(d.at || 0);
        const pad = n => (n < 10 ? '0' + n : '' + n);
        return '版本' + (i + 1) + '（' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ' · 记录 ' + s2.records + '）';
      });
      wx.showActionSheet({
        itemList: items,
        success: r => {
          const d = list[r.tapIndex];
          wx.showModal({
            title: '回滚确认',
            content: '将把该历史版本的内容合并回来（只补缺失、不覆盖现有；回滚前会把当前状态再存一份历史，便于再次回滚）。确定？',
            success: m => {
              if (!m.confirm) return;
              sync.saveHistory(JSON.stringify(util.buildPayload()), Date.now()).then(() => {
                let parsed = null;
                try { parsed = JSON.parse(d.payload); } catch (e) { wx.showToast({ title: '历史数据解析失败', icon: 'none' }); return; }
                util.applyPayload(parsed);
                this.refreshSync();
                wx.showToast({ title: '已恢复该历史版本' });
              });
            }
          });
        }
      });
    });
  },

  copyExamsRaw() {
    const data = {
      exams: store.ensureExams(),
      meta: store.load(store.KEYS.meta) || {}
    };
    wx.setClipboardData({ data: JSON.stringify(data) });
    wx.showToast({ title: '已复制考级原始数据' });
  },

  isDevtools() {
    try { return String(wx.getSystemInfoSync().platform).toLowerCase() === 'devtools'; } catch (e) { return false; }
  },

  cloudUpload() {
    // 上传成功后刷新「数据在哪」
    if (this.isDevtools()) {
      wx.showModal({
        title: '⚠️ 开发者工具中上传',
        content: '你正在开发者工具里，数据可能是调试用的测试数据。\n\n上传会用这份数据【覆盖云端】，手机端下次拉取就会拿到它。\n\n确定要上传吗？',
        confirmText: '仍要上传',
        success: r => { if (r.confirm) this.doCloudUpload(); }
      });
      return;
    }
    this.doCloudUpload();
  },
  doCloudUpload() {
    this.setData({ syncStatus: '⏳ 上传中…' });
    sync.push(true).then(() => {
      const st = sync.stats ? sync.stats() : {};
      this.setData({
        syncStatus: st.error
          ? '⚠️ 上传失败，看下面红字'
          : '✅ 已上传 ' + store.loadRecords().length + ' 条到云（自动同步' + (this.data.auto ? '已开' : '未开') + '）'
      });
      this.refreshDataWhere();
    });
  },
  cloudPull() {
    if (this.isDevtools()) {
      wx.showModal({
        title: '⚠️ 开发者工具中拉取',
        content: '会把【云端（手机端）】的数据合并到开发者工具本地。\n这只是把云端数据拉到这边，不会影响手机。\n\n确定继续吗？',
        confirmText: '继续',
        success: r => { if (r.confirm) this.doCloudPull(); }
      });
      return;
    }
    this.doCloudPull();
  },
  doCloudPull() {
    this.setData({ syncStatus: '⏳ 拉取合并中…' });
    sync.pull(true).then(() => {
      const n = store.loadRecords().length;
      const st = sync.stats ? sync.stats() : {};
      this.setData({ syncStatus: (n ? '✅ 本机现在 ' + n + ' 条' : '⚠️ 云端没有可用数据') + (st.error ? '' : '') });
      this.refreshSync();
      this.refreshDataWhere();
    });
  },

  // 清空本机数据：两步确认 + 明确「云端那份还在」+ 清完给出恢复入口提示
  clearData() {
    const n = store.loadRecords().length;
    wx.showModal({
      title: '⚠️ 清空本机数据',
      content: '本机现有 ' + n + ' 条记录。\n\n这只清本机，云端那份不受影响——清完可以点「从云端恢复」拉回来。\n\n但云端只有你**上次成功上传**的版本，之后的改动会丢。建议先「导出为文件」。',
      confirmText: '继续',
      success: r => {
        if (!r.confirm) return;
        wx.showModal({
          title: '最后确认',
          content: '真的要清空本机所有数据吗？',
          confirmText: '确认清空',
          confirmColor: '#dc2626',
          success: r2 => {
            if (!r2.confirm) return;
            Object.keys(store.KEYS).forEach(k => wx.removeStorageSync(store.KEYS[k]));
            wx.showModal({
              title: '已清空本机数据',
              showCancel: false,
              content: '本机记录已清空。\n\n云端那份还在：到「云同步 → ☁️ 从云端恢复（合并）」可以拉回来。'
            });
            this.onShow();
          }
        });
      }
    });
  }
});
