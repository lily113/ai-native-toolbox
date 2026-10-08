// 运行：node tools/mp_tests/smoke.test.js
// 冒烟测试：把每个页面 / 每个工具模块在假的小程序环境里真实加载一遍，
// 抓静态检查抓不到的加载期错误（require 路径写错、顶层代码抛异常等）。
const path = require('path');
const fs = require('fs');
const MP = [path.join(__dirname, '..', '..', 'figure-skating-mp'),
            path.join(__dirname, '..', '..', 'miniprogram')].filter(p => fs.existsSync(p))[0];

let fail = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

const mem = {};
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {}, redirectTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {}, chooseMedia: () => {}, getVideoInfo: () => {},
  createVideoDecoder: () => ({}), createVKSession: () => ({}), createSelectorQuery: () => ({}),
  nextTick: fn => fn && fn(), getFileSystemManager: () => ({ readFile: () => {}, writeFile: () => {} }),
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'oSMOKE' } }),
    database: () => ({ collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('x')), set: () => Promise.resolve({}), remove: () => Promise.resolve({}) }),
      add: () => Promise.resolve({}), orderBy: () => Promise.resolve({ data: [] }), where: () => Promise.resolve({ data: [] }) }) }) }
};
let captured = null;
global.Page = o => { captured = o; };
global.Component = o => { captured = o; };
global.getApp = () => ({ globalData: { openid: '' } , onLaunch() {} });
global.getCurrentPages = () => [];

// ---------- ① 工具模块 ----------
console.log('① 工具模块能否加载');
['const', 'store', 'util', 'sync', 'pose'].forEach(n => {
  try {
    delete require.cache[require.resolve(MP + '/utils/' + n + '.js')];
    require(MP + '/utils/' + n + '.js');
    ok(true, 'utils/' + n + '.js');
  } catch (e) { ok(false, 'utils/' + n + '.js → ' + e.message); }
});

// ---------- ② 页面：加载 + 生命周期跑一遍 ----------
console.log('\n② 页面加载 + onLoad/onShow 不报错');
const appJson = JSON.parse(fs.readFileSync(MP + '/app.json', 'utf8'));
const pages = []
  .concat(appJson.pages || [])
  .concat((appJson.subPackages || []).reduce((a, p) => a.concat((p.pages || []).map(x => p.root + '/' + x)), []));
pages.forEach(p => {
  const jsf = MP + '/' + p + '.js';
  if (!fs.existsSync(jsf)) { ok(false, p + ' → 文件不存在'); return; }
  captured = null;
  try {
    delete require.cache[require.resolve(jsf)];
    require(jsf);
    if (!captured) { ok(false, p + ' → 没有调用 Page()'); return; }
  } catch (e) { ok(false, p + ' → 加载失败: ' + e.message); return; }
  // 生命周期：跑一遍，页面自己该做的初始化要能完成
  const page = Object.assign(Object.create(null), captured);
  page.data = JSON.parse(JSON.stringify(captured.data || {}));
  page.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
  page.selectComponent = () => null;
  page.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }), exec: () => {} });
  try {
    if (typeof page.onLoad === 'function') page.onLoad({});
    if (typeof page.onShow === 'function') page.onShow();
    if (typeof page.onReady === 'function') page.onReady();
    ok(true, p + '（' + Object.keys(captured).filter(k => typeof captured[k] === 'function' && k !== 'setData').length + ' 个方法）');
  } catch (e) { ok(false, p + ' → onLoad/onShow 抛错: ' + e.message); }
});

// ---------- ③ 启动流程 + 首次安装写入量 ----------
console.log('\n③ app.js 启动流程');
Object.keys(mem).forEach(k => { delete mem[k]; });
delete require.cache[require.resolve(MP + '/utils/store.js')];
const store = require(MP + '/utils/store.js');
try {
  const prev = store.upgradeGuard();
  store.migrateMergeNotes(); store.migrateLessonForm(); store.cats();
  const chk = store.upgradeVerify(prev);
  ok(true, '启动流程跑通（guard → 迁移 → 校验）');
  ok(chk === null || chk.ok === true, '全新安装的空数据自检也没报错');
  ok(store.ensureMoves().length === 30, '全新安装动作 30 个');
  ok(store.cats().length === 6, '分类 6 个');
  const keys = Object.keys(mem);
  const size = keys.reduce((s, k) => s + JSON.stringify(mem[k]).length, 0);
  console.log('    写入的存储键：' + keys.map(k => k.replace('figure_skating_planner_', '')).join(', '));
  console.log('    合计 ' + (size / 1024).toFixed(1) + ' KB（微信单键上限 1MB / 总量 10MB）');
} catch (e) { ok(false, '启动流程抛错: ' + e.message); }

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项 —— 先别发！') : '\n✓ 全部通过：每一页都能加载，启动流程正常');
process.exit(fail ? 1 : 0);
