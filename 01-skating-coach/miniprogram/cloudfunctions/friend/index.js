// 「同门」小队：一起练的人互相看到「本周上冰天数 / 时长 / 冰课次数」。
//
// 设计要点（都是刻意的）：
//   ① 只存**汇总数字**。笔记、教练的话、冰感、伤病一个字都不进这两个集合 ——
//      这是这个功能的底线，不是"以后再说"。
//   ② 客户端不直接读数据库：全部走这个云函数。集合权限设成「仅创建者可读写」也没关系，
//      因为服务端有全权限，而客户端拿到的只有本队成员的几个数字。
//   ③ 只有邀请码这一道门（用户选的）。码是 6 位、去掉了 0/O/1/I 这类容易抄错的字符。
//   ④ 一个人只属于一个小队（MVP）。想换队就先退出。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TEAM = 'planner_team';
const STAT = 'planner_team_stat';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉 0/O/1/I
const MAX_MEMBERS = 15;                                   // 和体验成员上限一致，别让人以为能开大群

// 集合不存在时自动建（省掉手动建集合这一步）
async function ensureCollections() {
  for (const name of [TEAM, STAT]) {
    try { await db.createCollection(name); } catch (e) { /* 已存在就忽略 */ }
  }
}
function newCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function cleanNick(v) {
  const s = String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').trim();
  return s.slice(0, 12) || '无名同门';
}
function num(v, max) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(max || 9999, n));
}

// 我在哪个队（找到就返回那个 doc）
async function myTeam(openid) {
  const res = await db.collection(TEAM).where({ memberIds: openid }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = String((event && event.action) || '');
  try {
    await ensureCollections();

    // ---------- 建队 ----------
    if (action === 'create') {
      const has = await myTeam(OPENID);
      if (has) return { ok: true, already: true, code: has.code, teamId: has._id };
      // 邀请码撞了重试几次
      let code = '';
      for (let i = 0; i < 5; i++) {
        code = newCode();
        const dup = await db.collection(TEAM).where({ code: code }).count();
        if (!dup.total) break;
      }
      const nick = cleanNick(event.nick);
      const doc = {
        code: code,
        ownerOpenid: OPENID,
        createdAt: Date.now(),
        memberIds: [OPENID],
        members: [{ openid: OPENID, nick: nick, joinedAt: Date.now() }]
      };
      const add = await db.collection(TEAM).add({ data: doc });
      return { ok: true, code: code, teamId: add._id, nick: nick };
    }

    // ---------- 加入 ----------
    if (action === 'join') {
      const code = String((event && event.code) || '').trim().toUpperCase();
      if (code.length !== 6) return { ok: false, msg: '邀请码是 6 位' };
      const has = await myTeam(OPENID);
      if (has) {
        if (has.code === code) return { ok: true, code: code, teamId: has._id, already: true };
        return { ok: false, msg: '你已经在一个小队里了，先退出才能加入新的' };
      }
      const found = await db.collection(TEAM).where({ code: code }).limit(1).get();
      const team = (found.data && found.data[0]) || null;
      if (!team) return { ok: false, msg: '没有这个邀请码，跟同门确认一下' };
      if ((team.memberIds || []).length >= MAX_MEMBERS) return { ok: false, msg: '这个小队满了（' + MAX_MEMBERS + ' 人）' };
      const nick = cleanNick(event.nick);
      await db.collection(TEAM).doc(team._id).update({
        data: {
          memberIds: _.addToSet(OPENID),
          members: _.push([{ openid: OPENID, nick: nick, joinedAt: Date.now() }])
        }
      });
      return { ok: true, code: code, teamId: team._id, nick: nick };
    }

    // ---------- 上报我自己的本周汇总 ----------
    // 注意：payload 只认这几个数字，别的一律忽略 —— 防止有人往共享集合里塞别的东西
    if (action === 'pushStat') {
      const team = await myTeam(OPENID);
      if (!team) return { ok: false, msg: '还没加入小队' };
      const week = String((event && event.week) || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return { ok: false, msg: 'week 格式不对' };
      const me = (team.members || []).filter(m => m.openid === OPENID)[0] || {};
      const data = {
        teamId: team._id,
        openid: OPENID,
        nick: cleanNick(event.nick || me.nick),
        week: week,
        days: num(event.days, 31),        // 本周上冰天数
        minutes: num(event.minutes, 10080), // 本周上冰分钟
        lessons: num(event.lessons, 31),  // 本周冰课次数
        updatedAt: Date.now()
      };
      const id = team._id + '_' + OPENID;
      const exists = await db.collection(STAT).where({ _id: id }).count();
      if (exists.total) await db.collection(STAT).doc(id).update({ data: data });
      else await db.collection(STAT).add({ data: Object.assign({ _id: id }, data) });
      // 昵称改过就同步到成员表
      if (data.nick !== me.nick) {
        const members = (team.members || []).map(m => (m.openid === OPENID ? Object.assign({}, m, { nick: data.nick }) : m));
        await db.collection(TEAM).doc(team._id).update({ data: { members: members } });
      }
      return { ok: true };
    }

    // ---------- 看榜 ----------
    if (action === 'board') {
      const team = await myTeam(OPENID);
      if (!team) return { ok: true, joined: false };
      const week = String((event && event.week) || '').slice(0, 10);
      const res = await db.collection(STAT).where({ teamId: team._id, week: week }).limit(MAX_MEMBERS).get();
      const rows = (res.data || []).map(r => ({
        nick: r.nick || '无名同门',
        days: Number(r.days) || 0,
        minutes: Number(r.minutes) || 0,
        lessons: Number(r.lessons) || 0,
        updatedAt: Number(r.updatedAt) || 0,
        mine: r.openid === OPENID
      }));
      // 还没上报的成员也列出来（天数为 0，标"还没更新"），别让人以为队友不存在
      const reported = {};
      (res.data || []).forEach(r => { reported[r.openid] = 1; });
      (team.members || []).forEach(m => {
        if (reported[m.openid]) return;
        rows.push({ nick: m.nick || '无名同门', days: 0, minutes: 0, lessons: 0, updatedAt: 0, mine: m.openid === OPENID });
      });
      rows.sort((a, b) => (b.days - a.days) || (b.minutes - a.minutes));
      return {
        ok: true, joined: true,
        code: team.code,
        isOwner: team.ownerOpenid === OPENID,
        members: (team.members || []).length,
        rows: rows
      };
    }

    // ---------- 退出 ----------
    if (action === 'leave') {
      const team = await myTeam(OPENID);
      if (!team) return { ok: true };
      const members = (team.members || []).filter(m => m.openid !== OPENID);
      if (!members.length) {
        // 最后一个人退出 → 整个队散掉（省得留下空队占着邀请码）
        await db.collection(TEAM).doc(team._id).remove();
        try { await db.collection(STAT).where({ teamId: team._id }).remove(); } catch (e) {}
      } else {
        await db.collection(TEAM).doc(team._id).update({
          data: { memberIds: _.pull(OPENID), members: members }
        });
        try { await db.collection(STAT).where({ teamId: team._id, openid: OPENID }).remove(); } catch (e) {}
      }
      return { ok: true };
    }

    return { ok: false, msg: '未知操作' };
  } catch (e) {
    console.error('[friend] ' + action + ' 失败', e);
    return { ok: false, msg: '服务出错：' + ((e && e.message) || e) };
  }
};
