// 考级提醒：每天定时跑一次，给"考级日期还有 N 天"的用户发一条订阅消息。
//
// ⚠️ 用之前需要三步（缺一步它就不会发任何东西，也不会报错）：
//   1. 公众平台 → 订阅消息 → 申请一个模板（考试/日程提醒类），把模板 ID 配成云函数环境变量 EXAM_TMPL_ID
//   2. 本目录 config.json 已写好每天 09:00 的定时触发器；在开发者工具里右键这个云函数 → 上传触发器
//   3. 用户要在「设置 → 🔔 考级提醒」点一下授权（wx.requestSubscribeMessage）
//
// ⚠️ 下面 data 里的字段名（thing1 / date2 / thing3）必须和你申请到的模板一一对应，
//    否则云调用会报 47003。申请模板时看清楚它要哪几个字段，再改这三行。
//
// 说明：一次性订阅消息 = 用户授权一次，你只能发一条。想让"每个考级都提醒"，
//      需要在用户每次打开小程序时按需再次请求授权（当前实现是设置页点一次发一次）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const TMPL = process.env.EXAM_TMPL_ID || '';
const DAYS_AHEAD = 7;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const p = String(dateStr).split('-').map(Number);
  if (!p[0] || !p[1] || !p[2]) return null;
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const target = new Date(p[0], p[1] - 1, p[2]);
  return Math.round((target - today) / 86400000);
}

exports.main = async () => {
  if (!TMPL) return { ok: false, reason: '未配置 EXAM_TMPL_ID（见云函数注释前三步）' };
  const out = { ok: true, scanned: 0, sent: 0, failed: 0 };
  const MAX = 100;
  for (let skip = 0; skip < 2000; skip += MAX) {
    const page = await db.collection('planner_data').skip(skip).limit(MAX).get().catch(() => ({ data: [] }));
    const list = page.data || [];
    if (!list.length) break;
    for (const doc of list) {
      out.scanned++;
      let payload;
      try { payload = JSON.parse(doc.payload || '{}'); } catch (e) { continue; }
      const exams = Array.isArray(payload.exams) ? payload.exams : [];
      // 找"关注着、填了日期、正好还有 7 天"的级别
      const hit = exams.filter(e => e && e.star && e.date && daysUntil(e.date) === DAYS_AHEAD)[0];
      if (!hit) continue;
      const label = (hit.kind || '') + ' · ' + (hit.level || '');
      const r = await cloud.openapi.subscribeMessage.send({
        touser: doc._id,                       // planner_data 的 _id 就是 openid
        templateId: TMPL,
        page: 'packageExam/exam/exam?key=' + encodeURIComponent(hit.key || ''),
        miniprogramState: 'formal',
        lang: 'zh_CN',
        data: {
          thing1: { value: (label || '考级').slice(0, 20) },
          date2: { value: hit.date },
          thing3: { value: ('还有 ' + DAYS_AHEAD + ' 天，记得过一遍「我的要点」').slice(0, 20) }
        }
      }).then(() => { out.sent++; return true; }).catch(() => { out.failed++; return false; });
      void r;
    }
    if (list.length < MAX) break;
  }
  return out;
};
