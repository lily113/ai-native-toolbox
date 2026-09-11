const store = require('../../utils/store');
const { TYPES, MODES, WEEK, EXAM_KINDS } = require('../../utils/const');

Page({
  data: {
    week: WEEK,
    year: 0,
    month: 0,
    cells: [],
    today: '',
    selectedDate: '',
    dayStats: [],
    dayMinutes: 0,
    dayLesson: 0,
    monthCount: 0,
    monthMin: 0,
    monthLesson: 0,
    ymValue: ''
  },

  onLoad() {
    const now = new Date();
    this.setData({
      today: store.todayKey(),
      selectedDate: store.todayKey()
    });
    this.buildMonth(now.getFullYear(), now.getMonth());
    this.refreshDay();
  },

  onShow() {
    this.refreshDay();
    this.refreshMonth();
    this.refreshDayMarks();
  },

  switchMonth(e) {
    const dir = e.currentTarget.dataset.dir;
    const d = new Date(this.data.year, this.data.month + (dir === 'prev' ? -1 : 1), 1);
    this.buildMonth(d.getFullYear(), d.getMonth());
  },

  buildMonth(y, m) {
    const selected = this.data.selectedDate;
    const today = this.data.today;
    // 本月第一天是周几（周一为 0）
    const startW = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();

    const cells = [];
    // 补上月末尾
    for (let i = startW - 1; i >= 0; i--) {
      cells.push({ other: true, day: prevDays - i, wd: (startW - 1 - i + 7) % 7, sel: false, today: false });
    }
    // 本月
    for (let d = 1; d <= days; d++) {
      const k = store.dateKey(new Date(y, m, d));
      cells.push({
        key: k, day: d, wd: (startW + d - 1) % 7,
        today: k === today, sel: k === selected, other: false
      });
    }
    // 补下月初，凑满最后一行
    let ti = 1;
    while ((cells.length % 7) !== 0) {
      cells.push({ other: true, day: ti, wd: (startW + days + ti - 1) % 7, sel: false, today: false });
      ti++;
    }

    this.setData({ year: y, month: m, cells: cells, ymValue: y + '-' + (m + 1 < 10 ? '0' + (m + 1) : (m + 1)) });
    this.refreshMonth();
    this.refreshDayMarks();
  },

  onDate(e) {
    const v = String(e.detail.value || '');
    const p = v.split('-');
    const y = Number(p[0]), m = Number(p[1]) - 1;
    if (!isNaN(y) && !isNaN(m)) this.buildMonth(y, m);
  },

  // 给本月每一天标记“是否有训练”（小圆点）
  refreshDayMarks() {
    const byDate = {};
    store.loadRecords().forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + 1; });
    const cells = this.data.cells.map(c =>
      c.other ? c : Object.assign({}, c, { has: !!byDate[c.key], cnt: byDate[c.key] || 0 })
    );
    this.setData({ cells });
  },

  refreshMonth() {
    const y = this.data.year, m = this.data.month;
    if (!y) return;
    let mc = 0, mm = 0, ml = 0;
    store.loadRecords().forEach(r => {
      const dd = store.keyToDate(r.date);
      if (dd.getFullYear() === y && dd.getMonth() === m) {
        mc++;
        mm += Number(r.duration) || 0;
        if (r.mode === 'lesson') ml++;
      }
    });
    this.setData({ monthCount: mc, monthMin: mm, monthLesson: ml });
  },

  selectDay(e) {
    const k = e.currentTarget.dataset.key;
    if (!k) return;
    this.setData({ selectedDate: k });
    const cells = this.data.cells.map(c => (c.other ? c : Object.assign({}, c, { sel: c.key === k })));
    this.setData({ cells });
    this.refreshDay();
  },

  refreshDay() {
    const recs = store.recordsOf(this.data.selectedDate);
    let mins = 0, lesson = 0;
    const today = this.data.today;
    // 考级 id -> 标签
    const examLabel = {}, examById = {};
    store.ensureExams().forEach(ex => {
      examLabel[ex.id] = ((EXAM_KINDS[ex.kind] || {}).name || '') + ' · ' + ex.level;
      examById[ex.id] = ex;
    });
    const dayStats = recs.map(r => {
      mins += Number(r.duration) || 0;
      if (r.mode === 'lesson') lesson++;
      const status = store.statusOf(r);
      let statusText = '已安排';
      if (status === 'done') statusText = '已完成';
      else if (r.date === today) statusText = '今天';
      const moveNames = {};
      (r.moves || []).forEach(id => { const m = store.moveById(id); if (m) moveNames[m.id] = m.name; });
      const drillsByMove = {};
      (r.drills || []).forEach(did => {
        const f = store.drillById(did);
        if (f) { drillsByMove[f.move.id] = drillsByMove[f.move.id] || []; drillsByMove[f.move.id].push(f.drill.name); }
      });
      const entries = [];
      Object.keys(moveNames).forEach(mid => {
        const ds = drillsByMove[mid] || [];
        entries.push({ key: 'm:' + mid, text: ds.length ? (moveNames[mid] + '：' + ds.join('、')) : moveNames[mid] });
      });
      (r.examPicks || []).forEach(eid => {
        if (examLabel[eid]) entries.push({ key: 'e:' + eid, text: '【' + examLabel[eid] + '】' });
      });
      // 按记录里保存的显示顺序排列（没记录的排在后面）
      const order = Array.isArray(r.itemOrder) ? r.itemOrder : [];
      entries.sort((a, b) => {
        const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
        if (ia < 0 && ib < 0) return 0;
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      });
      const lineObjs = entries.map(x => ({ text: x.text }));
      if (!entries.length) {
        // 兜底：老记录（没选动作）仍显示训练内容里的条目
        String(r.content || '').split(/[\n；;]/)
          .map(x => x.trim().replace(/^[·•\-–—\s]+/, ''))
          .filter(x => x.length)
          .forEach(x => lineObjs.push({ text: x }));
      }
      return {
        id: r.id,
        content: r.content,
        contentLines: lineObjs.slice(0, 6),
        moreCount: Math.max(0, lineObjs.length - 6),
        duration: r.duration,
        time: r.time,
        typeName: TYPES[r.type] ? TYPES[r.type].name : '',
        typeEmoji: TYPES[r.type] ? TYPES[r.type].emoji : '',
        typeClass: 'band-' + (TYPES[r.type] ? r.type : 'other'),
        modeName: MODES[r.mode] ? MODES[r.mode].name : '',
        isLesson: r.mode === 'lesson',
        statusText: statusText,
        done: status === 'done'
      };
    });
    this.setData({ dayStats: dayStats, dayMinutes: mins, dayLesson: lesson });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/record/record?date=' + this.data.selectedDate });
  },
  editRecord(e) {
    wx.navigateTo({ url: '/pages/record/record?id=' + e.currentTarget.dataset.id });
  },
  goCoach() {
    wx.navigateTo({ url: '/pages/coach/coach' });
  },
  goMoves() {
    wx.navigateTo({ url: '/pages/moves/moves' });
  },
  goMilestone() {
    wx.navigateTo({ url: '/pages/milestone/milestone' });
  },
  goExams() {
    wx.navigateTo({ url: '/packageExam/exams/exams' });
  },
  goReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },
  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});
