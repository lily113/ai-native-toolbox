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
    try { require('./utils/store').migrateMergeNotes(); } catch (e) { console.warn('merge notes migrate', e); }
    try { require('./utils/sync').init(); } catch (e) { console.warn('sync init', e); }
  },
  globalData: {
    openid: ''
  }
});
