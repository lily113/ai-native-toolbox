// 「同门」小队（客户端）：只负责三件事
//   ① 算出我自己的本周汇总（只从本地记录里算，不读云端）
//   ② 调云函数 friend（建队 / 加入 / 上报 / 看榜 / 退出）
//   ③ 本地记一下"我在队里 + 我的昵称"，用于决定要不要上报
//
// 隐私：上报的 payload **只有 week/days/minutes/lessons/nick 五个字段**，
// 笔记、教练、冰感、伤病一个字都不进去。这条在云函数里也有对应的守门（只取这几个字段）。
const store = require('./store');

function pad(n) { return String(n).padStart(2, '0'); }

// 本周一（做"本周汇总"的键，也和后端对齐）
function weekKey() {
  const d = new Date();
  const wd = (d.getDay() + 6) % 7;        // 周一 = 0
  d.setDate(d.getDate() - wd);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 我自己的本周汇总：只算上冰（陆地不进这个榜，和首页口径一致）
function myStat(recs) {
  const list = Array.isArray(recs) ? recs : store.loadRecords();
  const week = weekKey();
  const days = {};
  let minutes = 0, lessons = 0;
  list.forEach(r => {
    if (!r || r.type !== 'ice' || !r.date) return;
    if (String(r.date) < week) return;
    days[r.date] = 1;
    minutes += Number(r.duration) || 0;
    if (r.mode === 'lesson') lessons++;
  });
  return { week: week, days: Object.keys(days).length, minutes: minutes, lessons: lessons };
}

function meta() { return store.load(store.KEYS.meta) || {}; }
function localTeam() {
  const t = meta().team || {};
  return { joined: !!t.joined, nick: String(t.nick || ''), code: String(t.code || '') };
}
function setLocalTeam(patch) {
  const m = meta();
  m.team = Object.assign({ joined: false, nick: '', code: '' }, m.team || {}, patch || {});
  store.save(store.KEYS.meta, m);
  return m.team;
}
function setNick(nick) { return setLocalTeam({ nick: String(nick || '').slice(0, 12) }); }

function call(action, data) {
  return new Promise((resolve) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      resolve({ ok: false, msg: '当前环境调不了云函数（真机 / 已开通云开发才可用）' });
      return;
    }
    wx.cloud.callFunction({ name: 'friend', data: Object.assign({ action: action }, data || {}) })
      .then(res => resolve((res && res.result) || { ok: false, msg: '空回复' }))
      .catch(err => resolve({ ok: false, msg: '调用失败：' + ((err && (err.errMsg || err.message)) || '未知错误') }));
  });
}

// 上报我的本周汇总（没入队就什么都不做，不发请求）
function pushStat() {
  const t = localTeam();
  if (!t.joined) return Promise.resolve({ ok: false, skipped: true });
  const s = myStat();
  return call('pushStat', {
    week: s.week, days: s.days, minutes: s.minutes, lessons: s.lessons, nick: t.nick
  });
}

module.exports = { weekKey, myStat, localTeam, setLocalTeam, setNick, call, pushStat };
