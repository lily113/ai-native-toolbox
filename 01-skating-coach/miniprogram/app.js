// 云开发环境 ID：到 微信开发者工具 → 云开发控制台 创建环境后，把环境 ID 填到这里（例如 "figure-skating-1a2b3c"）
const ENV = 'cloud1-d3gxrubwgdf9f71c7';

App({
  onLaunch() {
    if (!wx.cloud) {
      console.warn('当前基础库不支持云开发，请在开发者工具里选用较新基础库');
      return;
    }
    // 环境已配置才初始化
    if (ENV && ENV !== 'YOUR_ENV_ID') {
      wx.cloud.init({ env: ENV, traceUser: true });
    } else {
      wx.cloud.init({ traceUser: true });
    }
    try {
      const st = require('./utils/store');
      // ① 换版本时：先把现有数据整份快照到本机，并记下"每一行文字"的指纹
      const prev = st.upgradeGuard();
      // ② 跑迁移（都必须只加不删）
      st.migrateMergeNotes(); st.migrateLessonForm(); st.cats();
      // ③ 校验：记录条数不能变少、原来写下的字一个都不能找不到；不通过就记下来（首页会提示）
      const chk = st.upgradeVerify(prev);
      if (chk && !chk.ok) console.warn('升级自检未通过', chk);
    } catch (e) { console.warn('migrate', e); }
    try { require('./utils/sync').init(); } catch (e) { console.warn('sync init', e); }
    // 问一次「我是不是开发者本人」：决定首页显不显示 AI 教练入口（真正的兜底在云函数里）
    try {
      const app = this;
      wx.cloud.callFunction({ name: 'login' }).then(r => {
        const res = (r && r.result) || {};
        if (res.openid) app.globalData.openid = res.openid;
        app.globalData.isOwner = !!res.isOwner;
        app.globalData.ownerConfigured = !!res.ownerConfigured;
        if (!res.ownerConfigured) console.warn('未配置 OWNER_OPENID：AI 教练对所有人关闭');
      }).catch(() => {});
    } catch (e) {}
  },
  globalData: {
    openid: '',
    isOwner: false,           // 默认不显示（等 login 云函数确认后才打开）
    ownerConfigured: null     // null=还没问到；false=云函数没配 OWNER_OPENID
  }
});
