const store = require('../../utils/store');

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
    recs.forEach(r => {
      minutes += Number(r.duration) || 0;
      if (r.type === 'ice') ice++; else if (r.type === 'land') land++; else rehab++;
      if (r.mode === 'lesson' && r.type === 'ice') { lesson++; monthUnits += Number(r.units) || 1; }
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
        ice: ice,
        land: land,
        rehab: rehab,
        showRehab: rehab > 0,
        lesson: lesson,
        monthUnits: monthUnits,
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
