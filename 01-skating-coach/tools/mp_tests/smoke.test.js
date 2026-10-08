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

// ---------- ④ 对外发布的闸门（别被误删） ----------
console.log('\n④ 对外发布闸门');
const readIf = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
const deepseek = readIf(MP + '/cloudfunctions/deepseek/index.js');
const login = readIf(MP + '/cloudfunctions/login/index.js');
ok(deepseek.indexOf('OWNER_OPENID') > -1 && deepseek.indexOf('getWXContext') > -1,
   'deepseek 云函数：校验调用者是不是开发者本人');
ok(/if \(!owner\) return/.test(deepseek) && /OPENID !== owner/.test(deepseek),
   'deepseek 云函数：非本人 / 未配置时直接拒绝（不会调用 DeepSeek，不产生费用）');
ok(login.indexOf('isOwner') > -1, 'login 云函数：把 isOwner 告诉客户端');
const idxWxml = readIf(MP + '/pages/index/index.wxml');
ok(idxWxml.indexOf('wx:if="{{aiOn}}"') > -1, '首页：AI 教练入口按身份显示');
const constSrc = readIf(MP + '/utils/const.js');
ok(constSrc.indexOf('POSE_ENABLED') > -1, 'const.js：姿态自查开关存在');
const appJson2 = JSON.parse(fs.readFileSync(MP + '/app.json', 'utf8'));
if (!require(MP + '/utils/const').POSE_ENABLED) {
  ok(appJson2.pages.indexOf('pages/pose/pose') < 0, '姿态自查关闭时，不注册页面（不进包、不触发相册隐私）');
} else {
  ok(appJson2.pages.indexOf('pages/pose/pose') > -1, '姿态自查开启时，页面已注册');
}
const syncSrc = readIf(MP + '/utils/sync.js');
ok(syncSrc.indexOf('_openid: oid') > -1, '历史快照查询按自己的 openid 限定（防跨用户读取）');
ok(idxWxml.indexOf('firstRun') > -1, '首页有新用户上手引导');
const setWxml = readIf(MP + '/pages/settings/settings.wxml');
ok(setWxml.indexOf('copyOpenid') > -1, '设置页：能一键复制 openid（配 OWNER_OPENID 用）');
ok(setWxml.indexOf('aiStatus') > -1, '设置页：显示 AI 教练对谁开放');

// ---------- ⑤ 云函数静态检查（本地跑不了真实运行时，但能抓"用了却没引入"这类错） ----------
console.log('\n⑤ 云函数');
const cfDir = MP + '/cloudfunctions';
fs.readdirSync(cfDir).forEach(name => {
  const f = cfDir + '/' + name + '/index.js';
  if (!fs.existsSync(f)) return;
  const src = fs.readFileSync(f, 'utf8');
  const problems = [];
  if (/\bcloud\./.test(src) && src.indexOf("require('wx-server-sdk')") < 0) {
    problems.push("用了 cloud.xxx 但没 require('wx-server-sdk')（运行时会 ReferenceError）");
  }
  if (src.indexOf("require('wx-server-sdk')") > -1 && src.indexOf('cloud.init(') < 0) {
    problems.push('require 了 wx-server-sdk 但没调 cloud.init()');
  }
  const pkgF = cfDir + '/' + name + '/package.json';
  if (src.indexOf("require('wx-server-sdk')") > -1 && fs.existsSync(pkgF)) {
    const deps = (JSON.parse(fs.readFileSync(pkgF, 'utf8')).dependencies) || {};
    if (!deps['wx-server-sdk']) problems.push("package.json 里没有 wx-server-sdk 依赖（云端安装会失败）");
  }
  try { new (require('vm').Script)(src); } catch (e) { problems.push('语法错误: ' + e.message); }
  ok(problems.length === 0, 'cloudfunctions/' + name + (problems.length ? ' → ' + problems.join('；') : ''));
});

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项 —— 先别发！') : '\n✓ 全部通过：页面、启动流程、对外闸门、云函数静态检查都正常');
process.exit(fail ? 1 : 0);
