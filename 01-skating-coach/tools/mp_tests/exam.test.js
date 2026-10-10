// 运行：node tools/mp_tests/exam.test.js
// 考级数据自测：内置考纲每个级别都得有"起码能用的信息"（时长 + 要求动作 + 评判口径），
// 不能出现"点进去全是 0 条"的空壳——用户截图反馈过这个问题（自由滑·四级）。
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
  getSystemInfoSync: () => ({ platform: 'ios' }),
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {}, navigateBack: () => {}, navigateTo: () => {},
  showActionSheet: () => {}, setClipboardData: () => {},
  cloud: { init: () => {}, callFunction: () => Promise.resolve({ result: { openid: 'OME' } }), database: () => ({ collection: () => ({}) }) }
};
global.getApp = () => ({ globalData: { openid: 'OME' } });

const C = require(MP + '/utils/const');
const S = C.SYLLABUS;
const byKey = {};
S.forEach(x => { byKey[x.key] = x; });
const itemsOf = (lv, secKey) => {
  const sec = lv.sections.filter(s => s.key === secKey)[0];
  return sec ? sec.items : [];
};
const pointCount = lv => lv.sections.reduce((a, s) => a + s.items.reduce((b, i) => b + (i.points || []).length, 0), 0);
const itemCount = lv => lv.sections.reduce((a, s) => a + s.items.length, 0);

console.log('① 级别数量与 key');
ok(S.length === 42, '一共 42 个级别（实际 ' + S.length + '）');
ok(new Set(S.map(x => x.key)).size === 42, 'key 全部唯一');
ok(Object.keys(byKey).filter(k => k.indexOf('adult-s') === 0).length === 6, '成人步法 1–6 级都在');
ok(Object.keys(byKey).filter(k => k.indexOf('adult-f') === 0).length === 6, '成人自由滑 1–6 级都在');

console.log('② 单人自由滑 1–10：只剩「测试内容」，但内容齐全');
const FREE_TIME = {
  'free-1': '不超过 1 分钟', 'free-2': '不超过 1 分钟', 'free-3': '1 分 30 秒',
  'free-4': '1 分 50 秒', 'free-5': '2 分 15 秒', 'free-6': '2 分 30 秒',
  'free-7': '2 分 30 秒', 'free-8': '2 分 40 秒', 'free-9': '2 分 40 秒', 'free-10': '2 分 40 秒'
};
Object.keys(FREE_TIME).forEach(k => {
  const lv = byKey[k];
  const content = itemsOf(lv, 'content');
  const titles = content.map(i => i.title);
  const timeItem = content.filter(i => i.title === '时间')[0];
  ok(!!lv && content.length === 5 && ['时间', '跳跃', '旋转', '接续步', '自由滑动作'].every(t => titles.indexOf(t) > -1),
     lv.level + ' 测试内容五项齐全（' + titles.join('/') + '）');
  ok(!!timeItem && timeItem.points[0].indexOf(FREE_TIME[k]) > -1, lv.level + ' 时长写对了：' + (timeItem ? timeItem.points[0] : '—'));
  ok(content.every(i => (i.points || []).length > 0), lv.level + ' 每一项都有内容，没有空的');
  ok(lv.sections.filter(sec => sec.key !== 'my-points').length === 1,
     lv.level + ' 只保留「测试内容」一个官方分节（精简过）');
});
ok(pointCount(byKey['free-4']) >= 10, '自由滑四级要点足够看（' + pointCount(byKey['free-4']) + ' 条）');
ok(itemsOf(byKey['free-2'], 'content').filter(i => i.title === '跳跃')[0].points[0].indexOf('1S') > -1,
   '二级跳跃是 1S（不是把四级的 1Lz 抄过来）');
ok(itemsOf(byKey['free-10'], 'content').filter(i => i.title === '接续步')[0].points[0].indexOf('ChSq') > -1,
   '十级接续步是 1 个 ChSq');
ok(itemsOf(byKey['free-7'], 'content').filter(i => i.title === '自由滑动作')[0].points[0].indexOf('伊娜鲍尔') > -1,
   '七级自由滑动作是难度滑行动作（伊娜鲍尔步等）');
ok(itemsOf(byKey['free-8'], 'content').filter(i => i.title === '旋转')[0].points.join('').indexOf('旋转 2 级') > -1,
   '八级旋转要求达到国际滑联旋转 2 级');
ok(byKey['free-9'].sections.every(sec => ['content', 'my-points'].indexOf(sec.key) > -1),
   '自由滑不再挂通过/未通过标准分节');
ok(byKey['free-9'].sections.filter(sec => sec.key === 'pass').length === 0, '确认没有残留的 pass 分节');

console.log('③ 步法 11 个级别（基础级 + 1–10）时长都在');
ok(C.SYLLABUS.filter(x => x.kind === 'steps').length === 11, '步法 11 个级别');
const stepLv = C.SYLLABUS.filter(x => x.kind === 'steps');
ok(stepLv.every(lv => itemsOf(lv, 'test').length > 0 && itemsOf(lv, 'test')[0].points.length > 0),
   '每个步法级别都有"时间与节奏"（含时长）');
ok(stepLv.every(lv => !lv.sections.some(sec => sec.key === 'intro' || sec.key === 'detail')),
   '步法不再有「步法简介」「本级步法明细」这两个空盒子');
ok(stepLv.every(lv => itemsOf(lv, 'key-steps').length > 0), '步法的「重点步法说明」都还在');
ok(itemsOf(byKey['steps-0'], 'test')[0].points[0].indexOf('约 1 分钟') > -1, '基础级只有步法滑行时长（约 1 分钟）');
ok(itemsOf(byKey['steps-0'], 'key-steps').length === 3, '基础级有三个重点步法要素');
ok(itemsOf(byKey['steps-3'], 'test').map(i => i.points.join('')).join('').indexOf('1 分 55 秒') > -1,
   '三级有"整套节目时长 1 分 55 秒"（两个时长都在）');

console.log('④ 成人：自由滑 1–6 + 步法 1–6');
ok([1, 2, 3, 4, 5, 6].every(n => itemsOf(byKey['adult-f' + n], 'content').length === 5), '成人自由滑每级都有五项要求');
ok(itemsOf(byKey['adult-f1'], 'content').filter(i => i.title === '时间')[0].points[0].indexOf('1 分 ± 10 秒') > -1,
   '成人一级时长「1 分 ± 10 秒」写对了');
ok(byKey['adult-f6'].sections.filter(sec => sec.key !== 'my-points').length === 1,
   '成人自由滑同样只保留「测试内容」');
const refNote = itemsOf(byKey['adult-s3'], 'adult-ref')[0].points[0];
ok(refNote.indexOf('单人滑步法表演节目') > -1 && refNote.indexOf('三级') > -1, '成人步法写明了出处：' + refNote.slice(0, 40) + '…');
ok(itemsOf(byKey['adult-s6'], 'test').length > 0, '成人步法六级也有时长/节奏（沿用单人六级）');
ok(itemsOf(byKey['adult-s6'], 'key-steps').length > 0, '成人步法六级有重点步法要素');

console.log('⑤ 结构完整性（渲染/编辑不会出问题）');
let dupKey = 0, emptyTitle = 0, noMyPoints = 0;
S.forEach(lv => {
  lv.sections.forEach(sec => {
    const seen = {};
    sec.items.forEach(it => {
      if (!it.title) emptyTitle++;
      if (seen[it.key]) dupKey++; else seen[it.key] = 1;
    });
  });
  if (!lv.sections.some(sec => sec.key === 'my-points')) noMyPoints++;
});
ok(dupKey === 0, '同一个分节内条目 key 不重复（否则列表会串行）');
ok(emptyTitle === 0, '没有标题为空的条目');
ok(noMyPoints === 0, '每个级别都留着「我的要点」可编辑分节（用户能记自己的东西）');
ok(S.every(lv => lv.source && lv.source.indexOf('国家花样滑冰等级测试大纲') > -1), '每个级别都带来源标注（免责/版权说明）');

console.log('⑥ 还没填内容的类别（心里有数，不要以为坏了）');
['dance', 'pair'].forEach(k => {
  const empty = C.SYLLABUS.filter(x => x.kind === k && itemCount(x) <= 1);
  console.log('  · ' + k + '：' + (empty.length ? empty.map(x => x.level).join('、') + ' 还是空壳（待补）' : '都有内容'));
});

console.log(fail ? ('\n✗ 失败 ' + fail + ' 项') : '\n✓ 全部通过：内置考纲有实际内容，不是空壳');
process.exit(fail ? 1 : 0);
