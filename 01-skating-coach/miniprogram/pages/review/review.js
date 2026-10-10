const store = require('../../utils/store');
const sharecard = require('../../utils/sharecard');
const { LESSON_FORMS } = require('../../utils/const');

// 大数字的字号档位：<=3 字用 lg，4-5 字用 md，再长用 sm（永远不用"缩一半"那种）
function numCls(txt) {
  const n = String(txt || '').replace(/\s/g, '').length;
  if (n <= 3) return 'num-lg';     // 3 / 4小时
  if (n <= 6) return 'num-md';     // 4小时30分
  if (n <= 8) return 'num-sm';     // 12小时45分
  return 'num-xs';
}

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  if (!h) return min + ' 分钟';
  return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
}

Page({
  data: {
    year: 0,
    month: 0,
    ymValue: '',
    stats: null
  },

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() });
    this.calc();
  },
  onShow() { this.calc(); },

  // ---------- 生成月度报告图（A 卡）----------
  // 主角是"这个月练了什么" + 一句能被引用的话；不放累计次数/占比通栏/隐私声明。
  // 绘制走共享底座 utils/sharecard.js（和单次训练卡同一套）。
  makeReport() {
    const st = this.data.stats || {};
    if (!st.count) { wx.showToast({ title: '这个月还没有记录', icon: 'none' }); return; }
    const ym = this.data.year + '-' + ('0' + (this.data.month + 1)).slice(-2);
    const cfg = (store.load(store.KEYS.meta) || {}).shareCard || {};
    const data = sharecard.monthCardData(ym, { withDuration: !!cfg.duration });
    const draw = (hook) => {
      const d = Object.assign({}, data, { hook: hook || data.hook });
      sharecard.exportImage({ selector: '#reportCanvas' }, (ctx) => sharecard.drawMonthCard(ctx, d));
    };
    const hooks = (data.hooks || []).filter(Boolean);
    if (hooks.length > 1) {
      // 让用户挑一句今天想发的话（比纯自动更贴）
      wx.showActionSheet({
        itemList: hooks.slice(0, 3),
        success: r => draw(hooks[r.tapIndex]),
        fail: () => {}
      });
      return;
    }
    draw(hooks[0]);
  },


  prev() {
    const d = new Date(this.data.year, this.data.month - 1, 1);
    this.setData({ year: d.getFullYear(), month: d.getMonth() });
    this.calc();
  },
  next() {
    const d = new Date(this.data.year, this.data.month + 1, 1);
    this.setData({ year: d.getFullYear(), month: d.getMonth() });
    this.calc();
  },
  onDate(e) {
    const v = String(e.detail.value || '');
    const p = v.split('-');
    const y = Number(p[0]), m = Number(p[1]) - 1;
    if (!isNaN(y) && !isNaN(m)) { this.setData({ year: y, month: m }); this.calc(); }
  },

  calc() {
    const y = this.data.year, m = this.data.month;
    const all = store.loadRecords();
    const recs = all.filter(r => { const d = store.keyToDate(r.date); return d.getFullYear() === y && d.getMonth() === m; });

    let minutes = 0, ice = 0, land = 0, rehab = 0, lesson = 0, selfC = 0, monthUnits = 0;
    const formCount = {};
    recs.forEach(r => {
      minutes += Number(r.duration) || 0;
      if (r.type === 'ice') ice++; else if (r.type === 'land') land++; else rehab++;
      if (r.mode === 'lesson' && r.type === 'ice') {
        lesson++; monthUnits += Number(r.units) || 1;
        if (r.lessonForm && LESSON_FORMS[r.lessonForm]) formCount[r.lessonForm] = (formCount[r.lessonForm] || 0) + 1;
      }
      else if (r.mode === 'self') selfC++;
    });

    const goal = (store.load(store.KEYS.meta) || {}).weeklyIceGoal || 0;
    const weeklyAvg = Math.round(minutes / 4.33);
    const goalPct = goal ? Math.min(100, Math.round(weeklyAvg / goal * 100)) : 0;

    // 累计上冰/上课 = 截至“当前年月”的次数 + 基线（补偿早期未录的）
    const endDateKey = store.dateKey(new Date(y, m + 1, 0)); // 当前月最后一天
    const meta = store.load(store.KEYS.meta) || {};
    const iceBase = Number(meta.iceBase) || 0;
    const lessonBase = Number(meta.lessonBase) || 0;
    // 累计上冰：冰上记录（不限上课/自己），截至当前月
    const allIce = all.filter(r => r.type === 'ice' && r.date <= endDateKey).length + iceBase;
    // 累计上课：冰上 + 陆地 的上课记录（不含康复），截至当前月
    // 只统计“上冰课”（陆地课不计入累计，避免与笔记编号错位）
    const lessonRecs = all.filter(r => r.type === 'ice' && r.mode === 'lesson' && r.date <= endDateKey);
    const allLesson = lessonRecs.length + lessonBase;
    // 累计节数：基线（那时 1 节=1 次）+ 各次课的节数
    const allUnits = lessonRecs.reduce((n, r) => n + (Number(r.units) || 1), 0) + lessonBase;

    // 近 12 个月趋势（次数）
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - i, 1);
      const yy = d.getFullYear(), mm = d.getMonth();
      const cnt = all.filter(r => { const dd = store.keyToDate(r.date); return dd.getFullYear() === yy && dd.getMonth() === mm; }).length;
      trend.push({ label: (mm + 1) + '月', count: cnt, current: i === 0 });
    }
    const trendMax = Math.max(1, ...trend.map(t => t.count));
    trend.forEach(t => { t.h = Math.max(t.count ? 6 : 0, Math.round(t.count / trendMax * 100)); });
    // 本月类型占比
    const totalTypes = (ice + land + rehab) || 1;
    const typeBar = [
      { name: '上冰', n: ice, pct: Math.round(ice / totalTypes * 100), cls: 'ice' },
      { name: '陆地', n: land, pct: Math.round(land / totalTypes * 100), cls: 'land' },
      { name: '康复', n: rehab, pct: Math.round(rehab / totalTypes * 100), cls: 'rehab' }
    ].filter(x => x.n > 0);

    this.setData({
      ymValue: y + '-' + (m + 1 < 10 ? '0' + (m + 1) : (m + 1)),
      stats: {
        label: y + ' 年 ' + (m + 1) + ' 月',
        count: recs.length,
        minutesText: fmtMin(minutes),
        // 字号档位：两张卡的数字都按长度取档，避免"3"很大、"4 小时"很小
        minutesCls: numCls(fmtMin(minutes)),
        countCls: numCls(String(recs.length)),
        ice: ice,
        land: land,
        rehab: rehab,
        showRehab: rehab > 0,
        lesson: lesson,
        monthUnits: monthUnits,
        formText: Object.keys(LESSON_FORMS).filter(k => formCount[k]).map(k => LESSON_FORMS[k].name + ' ' + formCount[k]).join(' · '),
        selfC: selfC,
        goal: goal,
        weeklyAvg: weeklyAvg,
        goalPct: goalPct,
        allIce: allIce,
        allLesson: allLesson,
        allUnits: allUnits,
        trend: trend,
        trendMax: trendMax,
        typeBar: typeBar
      }
    });
  }
});
