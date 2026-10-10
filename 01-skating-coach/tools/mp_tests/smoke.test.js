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
    // 考级列表：级别要齐、id 必须全是 ASCII（中文 id 拼进 navigateTo 的 URL → 详情页报「考级不存在」）
    if (p === 'packageExam/exams/exams') {
      const rows = (page.data.mine || []).concat(...(page.data.groups || []).map(g => g.list));
      ok(rows.length >= 40, '考级列表：内置级别齐全（' + rows.length + ' 条）');
      const bad = rows.filter(x => !/^[\x20-\x7e]+$/.test(x.id));
      ok(bad.length === 0, '考级 id 全是 ASCII' + (bad.length ? '（有问题：' + bad.map(b => b.id).join(',') + '）' : ''));
      ok((page.data.groups || []).length === 5, '考级按 5 个项目分组（自由滑/步法/冰上舞蹈/成人/双人滑）');
    }
    // 首页：空数据（= 新用户）必须显示上手引导卡
    if (p === 'pages/index/index') {
      ok(page.data.firstRun === true, '新用户（0 条记录）首页显示上手引导卡');
      ok(page.data.poseOn === false, '姿态自查入口关闭时首页不显示它');
    }
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
ok(/if \(!owner\)/.test(deepseek) && /OPENID !== owner/.test(deepseek),
   'deepseek 云函数：非本人 / 未配置时直接拒绝（不会调用 DeepSeek，不产生费用）');
ok(login.indexOf('isOwner') > -1, 'login 云函数：把 isOwner 告诉客户端');
const idxWxml = readIf(MP + '/pages/index/index.wxml');
ok(idxWxml.indexOf('wx:if="{{aiOn}}"') > -1, '首页：AI 教练入口按身份显示');
const SYL = require(MP + '/utils/const').SYLLABUS;
ok(SYL.every(x => /^[\x20-\x7e]+$/.test(x.key)), '考纲所有 key 都是 ASCII（防止"考级不存在"复发）');
ok(new Set(SYL.map(x => x.key)).size === SYL.length, '考纲 key 无重复');
ok(SYL.every(x => x.kind && x.level && Array.isArray(x.sections) && x.sections.length >= 2),
   '每条考纲都有 项目/级别/至少两个分节（含「我的要点」）');
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
ok(setWxml.indexOf('dataWhere') > -1, '设置页：显示「本机 N 条 · 云端 M 条」（同步状态可见）');
const syncSrc2 = readIf(MP + '/utils/sync.js');
ok(syncSrc2.indexOf('markErr') > -1 && syncSrc2.indexOf('notifyRestored') > -1,
   '同步失败会留痕、首次从云端恢复会提示（不再静默）');
ok(syncSrc2.indexOf('scheduleRetry') > -1 && syncSrc2.indexOf('pendingPush') > -1,
   '上传失败会指数退避重试；启动/切回前台会补推未同步的改动');
ok(readIf(MP + '/pages/settings/settings.js').indexOf('lastExportAt') > -1,
   '导出会记录时间（用于"多久没备份"提醒）');
// 危险动作只应出现在「高级」折叠区里，且必须有警示/二次确认
const setWxml2 = readIf(MP + '/pages/settings/settings.wxml');
ok(setWxml2.indexOf('adv-toggle') < setWxml2.indexOf('bindtap="cloudUpload"'),
   '「用本机覆盖云端」被收进高级区（不在日常区裸露）');
ok(setWxml2.indexOf('adv-toggle') < setWxml2.indexOf('bindtap="clearData"'),
   '「清空本机数据」被收进高级区');
const setJs2 = readIf(MP + '/pages/settings/settings.js');
ok(setJs2.indexOf('关闭自动同步的后果') > -1, '关闭自动同步会弹后果警示');
ok(setJs2.indexOf('最后确认') > -1 && setJs2.indexOf('从云端恢复') > -1,
   '清空数据：两步确认 + 明确告诉用户云端还能恢复');
ok(readIf(MP + '/pages/index/index.js').indexOf('syncTipShown') > -1,
   '新用户：有第一条记录后只提示一次「数据会自动存到云端」');
ok(readIf(MP + '/pages/index/index.js').indexOf('onDataRestored') > -1,
   '首页有 onDataRestored：云端恢复后立刻刷新界面');

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
  if (name !== 'login' && name !== 'deepseek') { /* 其它函数不检查 owner 兜底 */ }
  try { new (require('vm').Script)(src); } catch (e) { problems.push('语法错误: ' + e.message); }
  if (name === 'deepseek' || name === 'login') {
    if (src.indexOf('OWNER_OPENID_FALLBACK') < 0) problems.push('缺少 OWNER_OPENID_FALLBACK 兜底常量（环境变量读不到时就没法开放给自己）');
  }
  ok(problems.length === 0, 'cloudfunctions/' + name + (problems.length ? ' → ' + problems.join('；') : ''));
});

console.log('分享 / 首页概览 / 动作统计 / AI 行隐藏');
ok(/onShareAppMessage\s*\(/.test(readIf(MP + '/pages/index/index.js')) && /onShareTimeline\s*\(/.test(readIf(MP + '/pages/index/index.js')),
   '首页支持转发和朋友圈分享');
ok(/onShareAppMessage\s*\(/.test(readIf(MP + '/packageExam/exam/exam.js')) && /onShareTimeline\s*\(/.test(readIf(MP + '/packageExam/exam/exam.js')),
   '考级详情支持分享（路径带 key，别人点开是自己的同一级别）');
ok(/buildOverview\s*\(/.test(readIf(MP + '/pages/index/index.js')) && /ov-stale/.test(readIf(MP + '/pages/index/index.wxml')),
   '首页有本月/周目标/久未练习的概览卡');
ok(/moveUsage\s*\(/.test(readIf(MP + '/utils/store.js')) && /sortByStale/.test(readIf(MP + '/pages/moves/moves.js'))
   && /usageText/.test(readIf(MP + '/pages/moves/moves.wxml')),
   '动作库显示练习次数/上次日期，并支持「最久没练」排序');
ok(/copyRecordText\s*\(/.test(readIf(MP + '/pages/record/record.js')), '训练记录可一键复制文字');
ok(/aiVisible/.test(readIf(MP + '/pages/settings/settings.js')) && /wx:if="\{\{aiVisible\}\}"/.test(readIf(MP + '/pages/settings/settings.wxml')),
   '普通用户看不到「AI 教练」那一行（只有本人可见）');
ok(/copyAllPoints\s*\(/.test(readIf(MP + '/packageExam/exam/exam.js')), '考级详情可复制「本级全部要点」（考前清单）');
ok(/examMoveLinks\s*\(/.test(readIf(MP + '/utils/store.js')) && /examLinkedCount/.test(readIf(MP + '/packageExam/exam/exam.js')),
   '动作↔考级互相关联（动作详情显示挂到哪些级别；考级显示已挂动作数）');

console.log('考级列表：别把内置内容算成"我记的"');
const examsWxml = readIf(MP + '/packageExam/exams/exams.wxml');
const examsJs = readIf(MP + '/packageExam/exams/exams.js');
ok(examsWxml.indexOf('内置考纲') < 0, '列表里不再有「内置考纲」标签');
ok(/myNoteCount/.test(examsJs) && /myItems \|\| \[\]\)\.length/.test(examsJs),
   '条数只统计用户自己记的（自建条目 + 给内置条目补的要点/易错/备注）');
ok(examsWxml.indexOf('自己记了') > -1, '列表用「📝 自己记了 N 条」这个说法');
ok(readIf(MP + '/packageExam/exam/exam.wxml').indexOf('内置考纲') < 0, '详情页也不再有这个标签');

console.log('上传失败可自救');
const retryWxml = fs.readFileSync(path.join(MP, 'pages/settings/settings.wxml'), 'utf8');
const retryJs = fs.readFileSync(path.join(MP, 'pages/settings/settings.js'), 'utf8');
const syncJs = fs.readFileSync(path.join(MP, 'utils/sync.js'), 'utf8');
ok(/bindtap="retryUpload"/.test(retryWxml) && /retryUpload\s*\(/.test(retryJs),
   '错误提示旁边有「立即重试上传」按钮（上传超时不用干等自动退避）');
ok(/splitChunks|writeChunks/.test(syncJs) && /CHUNK_COL = 'planner_data'/.test(syncJs),
   '大数据走分块上传，且分块就放在已有的 planner_data 集合（不需要你手动新建集合）');
ok(/function diagnose\(\)/.test(syncJs), '有逐级试写诊断：能看出卡在"写小文档/写48KB/整份"哪一步');
ok(/onNetworkStatusChange/.test(syncJs), '网络恢复后自动补传');

console.log('"还有东西没传"不能只看时间戳');
ok(/function fingerprint\(\)/.test(syncJs) && /pushedRecords/.test(syncJs),
   'pending 改成比内容（本机条数 + payload 大小），不再只比 lastEdit/seenTs');
ok(/cloudBehind/.test(setJs2) && /doRetryUpload/.test(setJs2),
   '上传按钮：本机与云端条数对不上时仍然允许上传（带确认），不会再回"没有未上传的改动"');

console.log('设置页版本号');
const verWxml = fs.readFileSync(path.join(MP, 'pages/settings/settings.wxml'), 'utf8');
const verJs = fs.readFileSync(path.join(MP, 'pages/settings/settings.js'), 'utf8');
ok(/ver-line/.test(verWxml) && /ver:\s*require/.test(verJs.replace(/\s+/g,' ')),
   '设置页底部显示 APP_VERSION（上传体验版后能核对手机上跑的是哪一版）');

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项 —— 先别发！') : '\n✓ 全部通过：页面、启动流程、对外闸门、云函数静态检查都正常');
process.exit(fail ? 1 : 0);
