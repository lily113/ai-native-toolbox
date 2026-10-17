const store = require('../../utils/store');
const { EXAM_KINDS, SYLLABUS, TYPES } = require('../../utils/const');

// 本周的周一（做"同一周只生成一次"的键，也用来算本周上冰）
function mondayKey() {
  const d = new Date();
  const wd = (d.getDay() + 6) % 7;          // 周一=0
  d.setDate(d.getDate() - wd);
  return store.dateKey(d);
}
function sumMin(recs) { return (recs || []).reduce((n, r) => n + (Number(r.duration) || 0), 0); }

Page({
  data: {
    plan: '', at: '', week: '', loading: false, err: '', prompt: ''
  },

  onLoad() { this.reload(); },
  onShow() { this.reload(); },

  reload() {
    const meta = store.load(store.KEYS.meta) || {};
    const saved = meta.aiPlan || {};
    const wk = mondayKey();
    this.setData({
      week: wk,
      plan: (saved.week === wk && saved.text) ? saved.text : '',
      at: saved.at || '',
      // 上周生成的还留着，但不算"这周" —— 提示一下可以重新生成
      stale: !!(saved.text && saved.week !== wk)
    });
  },

  // 把"我的真实数据"压成一段给 AI 的输入。只放训练事实，不放笔记原文（隐私 + token 都省）
  buildPrompt() {
    const today = store.todayKey();
    const wk = mondayKey();
    const recs = store.loadRecords();
    const meta = store.load(store.KEYS.meta) || {};
    // 导入的历史笔记不算"上冰次数/时长"（它们没有时长，也不是这次训练的强度）
    const ice = recs.filter(r => r.type === 'ice' && !r.noteOnly && r.date);
    const L = [];

    // 频率
    const thisWeek = ice.filter(r => r.date >= wk && r.date <= today);
    L.push('· 本周（' + wk + ' 起）已上冰 ' + thisWeek.length + ' 次，共 ' + sumMin(thisWeek) + ' 分钟');
    const lastWeekFrom = (function () { const d = store.keyToDate(wk); d.setDate(d.getDate() - 7); return store.dateKey(d); })();
    const lastWeek = ice.filter(r => r.date >= lastWeekFrom && r.date < wk);
    L.push('· 上周上冰 ' + lastWeek.length + ' 次，共 ' + sumMin(lastWeek) + ' 分钟');
    if (meta.weeklyIceGoal) L.push('· 每周上冰目标 ' + meta.weeklyIceGoal + ' 分钟');
    const recent14 = (function () { const d = new Date(); d.setDate(d.getDate() - 13); return store.dateKey(d); })();
    const cat = store.iceCatStats(recs.filter(r => r.date >= recent14));
    if (cat.list.length) {
      L.push('· 最近 14 天上冰练过的板块：' + cat.list.map(x => x.name + ' ' + x.n + ' 次').join('、'));
    } else {
      L.push('· 最近 14 天没有勾过动作的记录');
    }

    // 荒了的
    const stale = store.staleMoves(30).slice(0, 8);
    if (stale.length) {
      L.push('· 超过 30 天没练：' + stale.map(x => x.label.replace('（整个动作）', '') + '（' + x.days + ' 天' + (x.never ? '，从没练过' : '') + '）').join('、'));
    } else {
      L.push('· 没有超过 30 天没练的项目');
    }

    // 已掌握（不用再排）
    const usage = store.moveUsage();
    const mastered = store.ensureMoves().filter(m => usage[m.id] && usage[m.id].allMastered).map(m => m.name).slice(0, 10);
    if (mastered.length) L.push('· 已掌握（不用再排）：' + mastered.join('、'));

    // 考级
    const up = store.ensureExams().filter(e => e && e.star && e.date && String(e.date) >= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (up.length) {
      const e = up[0];
      const kind = (EXAM_KINDS[e.kind] || {}).name || '';
      const d = Math.round((store.keyToDate(e.date) - store.keyToDate(today)) / 86400000);
      L.push('· 考级：距 ' + kind + ' · ' + e.level + ' 还有 ' + d + ' 天');
      const sy = SYLLABUS.filter(x => x.key === e.key)[0];
      if (sy) {
        const titles = [];
        (sy.sections || []).forEach(sec => (sec.items || []).forEach(it => {
          const t = typeof it === 'string' ? it : (it.title || '');
          if (t) titles.push(t);
        }));
        if (titles.length) L.push('  （本级要点：' + titles.slice(0, 6).join('、') + '）');
      }
    }

    // 冰感
    const feel = store.feelStats(recs);
    if (feel.n >= 3) {
      let s = '· 冰感：最近记了 ' + feel.n + ' 次，平均 ' + feel.avg + ' 分';
      if (feel.goodGap >= 0 && feel.lowGap >= 0) s += '；冰感≥4 的日子平均距上次上冰 ' + feel.goodGap + ' 天，≤2 分的平均 ' + feel.lowGap + ' 天';
      L.push(s);
    }
    return L.join('\n');
  },

  generate() {
    if (this.data.loading) return;
    const ctx = this.buildPrompt();
    const q = '你是我的花滑教练。请根据下面这些**真实训练数据**，给我排下周练什么。\n'
      + '要求：不要写"多练基础""注意体能"这种空话，每条都要指到具体动作或板块；\n'
      + '输出就三段，每段最多 4 行：\n'
      + '【下周上冰】练什么 —— 为什么（结合数据）\n'
      + '【陆地补强】练什么 —— 为什么\n'
      + '【提醒】1 条（考级临近、间隔太久之类；没有就写"无"）\n'
      + '总字数 400 字以内，不要客套话。\n\n'
      + '【我的数据】\n' + ctx;
    this.setData({ loading: true, err: '', prompt: ctx });
    wx.cloud.callFunction({ name: 'deepseek', data: { question: q } })
      .then(res => {
        const r = (res && res.result) || {};
        const text = String(r.answer || '').trim();
        if (!text) throw new Error('空回复');
        const meta = store.load(store.KEYS.meta) || {};
        meta.aiPlan = { week: mondayKey(), text: text, at: store.todayKey() };
        store.save(store.KEYS.meta, meta);
        this.setData({ plan: text, at: meta.aiPlan.at, stale: false });
        wx.showToast({ title: '排好了' });
      })
      .catch(err => {
        const msg = (err && (err.errMsg || err.message)) || '未知错误';
        this.setData({
          err: /OWNER_OPENID|暂未开放/.test(msg)
            ? 'AI 还没开放：需要在云函数里配好 OWNER_OPENID。'
            : ('调用失败：' + msg + '\n检查：deepseek 云函数是否已部署、有没有配 DEEPSEEK_KEY、超时是否 ≥60s。')
        });
      })
      .then(() => this.setData({ loading: false }));
  },

  copy() {
    if (!this.data.plan) return;
    wx.setClipboardData({
      data: this.data.plan,
      success: () => wx.showToast({ title: '已复制，可粘给教练', icon: 'none' })
    });
  },

  // 把传给 AI 的原始数据也露出来（用户有权知道自己的什么数据被发出去了）
  togglePrompt() { this.setData({ showPrompt: !this.data.showPrompt }); }
});
