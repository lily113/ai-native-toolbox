// 「同门」小队：一起练的人互相看本周汇总（只看数字，看不到笔记/教练/伤病）
const team = require('../../utils/team');
const store = require('../../utils/store');

// 这一行是"多久以前更新的" —— 能一眼看出榜上的数字是不是刚推上去的
// （同一个微信号在模拟器和手机上 openid 是一样的，所以两端会互相覆盖，看时间能判断）
function agoText(ts) {
  const t = Number(ts) || 0;
  if (!t) return '还没更新';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return '刚刚更新';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

function fmtMin(m) {
  const n = Number(m) || 0;
  if (n <= 0) return '0 分钟';
  if (n < 60) return n + ' 分钟';
  const h = Math.round(n / 60 * 10) / 10;
  return (h % 1 === 0 ? String(Math.round(h)) : h.toFixed(1)) + ' 小时';
}

Page({
  data: {
    loading: true,
    joined: false,
    code: '',
    isOwner: false,
    members: 0,
    rows: [],
    nick: '',
    joinCode: '',
    mode: 'join',          // join = 加入别人的队；create = 自己建一个
    err: '',
    busy: false,
    mineDays: 0, mineMinutesText: '0 分钟', mineLessons: 0
  },

  onLoad(q) {
    // 从分享卡片进来会带 ?code=XXXXXX，直接填好
    const code = String((q && q.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code) this.setData({ joinCode: code });
    this.setData({ nick: team.localTeam().nick });
  },

  onShow() { this.load(); },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, err: '' });
    return team.call('board', { week: team.weekKey() }).then(r => {
      if (!r.ok) {
        this.setData({ loading: false, err: r.msg || '读取失败' });
        return;
      }
      if (!r.joined) {
        team.setLocalTeam({ joined: false });
        this.setData({ loading: false, joined: false, rows: [], code: '' });
        return;
      }
      team.setLocalTeam({ joined: true, code: r.code || '' });
      // 本机记录算出来的数（就是"刷新我的"会推上去的那个）——
      // 榜上是各台设备最后一次推的数字，两者不一样时，这一行能立刻看出是哪边的问题
      const mineStat = team.myStat();
      this.setData({
        mineDays: mineStat.days,
        mineMinutesText: fmtMin(mineStat.minutes),
        mineLessons: mineStat.lessons
      });
      const rows = (r.rows || []).map(x => ({
        nick: x.nick,
        mine: !!x.mine,
        days: x.days,
        minutesText: fmtMin(x.minutes),
        lessons: x.lessons,
        timeText: agoText(x.updatedAt)
      }));
      this.setData({
        loading: false, joined: true, code: r.code || '',
        isOwner: !!r.isOwner, members: r.members || rows.length, rows: rows
      });
      // 顺手把自己的汇总推上去（这样别人看到的是最新的）
      team.pushStat().then(() => {});
    });
  },

  setMode(e) {
    const m = e.currentTarget.dataset.m === 'create' ? 'create' : 'join';
    this.setData({ mode: m, err: '' });
  },

  onNick(e) { this.setData({ nick: e.detail.value }); },
  onCode(e) { this.setData({ joinCode: String(e.detail.value || '').toUpperCase() }); },

  create() {
    if (this.data.busy) return;
    const nick = String(this.data.nick || '').trim();
    this.setData({ busy: true, err: '' });
    team.call('create', { nick: nick }).then(r => {
      this.setData({ busy: false });
      if (!r.ok) { this.setData({ err: r.msg || '创建失败' }); return; }
      team.setLocalTeam({ joined: true, nick: nick || '无名同门', code: r.code });
      if (r.already) wx.showToast({ title: '你已经在队里了', icon: 'none' });
      else wx.showToast({ title: '小队建好了' });
      this.load();
    });
  },

  join() {
    if (this.data.busy) return;
    const code = String(this.data.joinCode || '').trim().toUpperCase();
    if (code.length !== 6) { this.setData({ err: '邀请码是 6 位' }); return; }
    const nick = String(this.data.nick || '').trim();
    this.setData({ busy: true, err: '' });
    team.call('join', { code: code, nick: nick }).then(r => {
      this.setData({ busy: false });
      if (!r.ok) { this.setData({ err: r.msg || '加入失败' }); return; }
      team.setLocalTeam({ joined: true, nick: nick || '无名同门', code: r.code });
      wx.showToast({ title: r.already ? '你已经在这个队里' : '加入成功' });
      this.load();
    });
  },

  copyCode() {
    if (!this.data.code) return;
    wx.setClipboardData({ data: this.data.code, success: () => wx.showToast({ title: '邀请码已复制' }) });
  },

  leave() {
    wx.showModal({
      title: '退出小队',
      content: '退出后就看不到同门的数据了；你练了多少不会丢，只是从榜上撤掉。',
      confirmText: '退出',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        team.call('leave', {}).then(res => {
          if (!res.ok) { wx.showToast({ title: res.msg || '退出失败', icon: 'none' }); return; }
          team.setLocalTeam({ joined: false, code: '' });
          wx.showToast({ title: '已退出' });
          this.load();
        });
      }
    });
  },

  // 分享邀请卡片（带邀请码，同门点开就自动填好）
  onShareAppMessage() {
    const code = this.data.code;
    return {
      title: code ? ('来我的花滑小队，邀请码 ' + code) : '来一起练花滑',
      path: code ? ('/pages/team/team?code=' + code) : '/pages/team/team'
    };
  },

  refreshMine() {
    team.pushStat().then(() => {
      wx.showToast({ title: '已更新我的数据' });
      this.load();
    });
  }
});
