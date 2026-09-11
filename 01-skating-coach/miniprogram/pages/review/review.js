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

    let minutes = 0, ice = 0, land = 0, rehab = 0, lesson = 0, selfC = 0;
    recs.forEach(r => {
      minutes += Number(r.duration) || 0;
      if (r.type === 'ice') ice++; else if (r.type === 'land') land++; else rehab++;
      if (r.mode === 'lesson') lesson++; else if (r.mode === 'self') selfC++;
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
    const allLesson = all.filter(r => (r.type === 'ice' || r.type === 'land') && r.mode === 'lesson' && r.date <= endDateKey).length + lessonBase;

    this.setData({
      ymValue: y + '-' + (m + 1 < 10 ? '0' + (m + 1) : (m + 1)),
      stats: {
        label: y + ' 年 ' + (m + 1) + ' 月',
        count: recs.length,
        minutesText: fmtMin(minutes),
        ice: ice,
        land: land,
        rehab: rehab,
        lesson: lesson,
        selfC: selfC,
        goal: goal,
        weeklyAvg: weeklyAvg,
        goalPct: goalPct,
        allIce: allIce,
        allLesson: allLesson
      }
    });
  }
});
