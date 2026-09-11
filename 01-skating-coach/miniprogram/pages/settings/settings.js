const store = require('../../utils/store');
const util = require('../../utils/util');
const sync = require('../../utils/sync');
const app = getApp();

Page({
  data: {
    goal: 0,
    iceBase: 0,
    lessonBase: 0,
    openid: '',
    syncStatus: '未配置',
    auto: false,
    showImport: false,
    importText: ''
  },

  onShow() {
    const meta = store.load(store.KEYS.meta) || {};
    this.setData({
      goal: meta.weeklyIceGoal || 0,
      iceBase: Number(meta.iceBase) || 0,
      lessonBase: Number(meta.lessonBase) || 0,
      openid: app.globalData.openid,
      auto: sync.getAuto()
    });
    if (app.globalData.openid) this.refreshSync();
    else this.fetchOpenid();
  },

  onReady() {
    this.fetchOpenid();
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
      wx.showToast({ title: '已关闭自动同步' });
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
    let localTxt = '【本机】记录 ' + store.loadRecords().length + ' 条 · 考级自建条目 ' + localItems + ' 条 · 基线 ' + (meta.iceBase || 0) + '/' + (meta.lessonBase || 0);
    localTxt += '\n条目归属：' + keyTxt + ' · 逐条个性化 ' + extraCnt + ' 条';
    localTxt += bak ? ('\n备份：有（' + new Date(bak.at).toLocaleString() + '）') : '\n备份：无';
    const oid = app.globalData.openid;
    if (!oid) { wx.showModal({ title: '同步诊断', content: localTxt + '\n【云端】未获取身份，无法读取', showCancel: false }); return; }
    wx.cloud.database().collection('planner_data').doc(oid).get()
      .then(res => {
        let d = {};
        try { d = JSON.parse(res.data.payload); } catch (e) {}
        const rExams = Array.isArray(d.exams) ? d.exams : [];
        const rItems = rExams.reduce((n, e) => n + ((e.myItems || []).length), 0);
        const rMeta = d.meta || {};
        const cloudTxt = '【云端】记录 ' + ((d.records || []).length) + ' 条 · 考级自建条目 ' + rItems + ' 条 · 基线 ' + (rMeta.iceBase || 0) + '/' + (rMeta.lessonBase || 0)
          + '\n更新于 ' + (res.data.ts ? new Date(res.data.ts).toLocaleString() : '—');
        wx.showModal({ title: '同步诊断', content: localTxt + '\n' + cloudTxt, showCancel: false });
      })
      .catch(() => wx.showModal({ title: '同步诊断', content: localTxt + '\n【云端】读取失败（可能还没上传过）', showCancel: false }));
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
      this.setData({ syncStatus: '✅ 已上传到云（自动同步' + (this.data.auto ? '已开' : '未开') + '）' });
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
      this.setData({ syncStatus: '✅ 已与云端同步' });
      this.refreshSync();
    });
  },

  clearData() {
    wx.showModal({
      title: '清空',
      content: '确定清空本机所有训练数据？',
      success: r => {
        if (!r.confirm) return;
        Object.keys(store.KEYS).forEach(k => wx.removeStorageSync(store.KEYS[k]));
        wx.showToast({ title: '已清空' });
        this.onShow();
      }
    });
  }
});
