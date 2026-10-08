const store = require('../../utils/store');
const { POSE_ENABLED, TYPES, MODES, WEEK, EXAM_KINDS, LESSON_FORMS } = require('../../utils/const');

Page({
  data: {
    week: WEEK,
    year: 0,
    month: 0,
    cells: [],
    today: '',
    selectedDate: '',
    dayStats: [],
    cardOpen: {},
    dayMinutes: 0,
    dayLesson: 0,
    monthCount: 0,
    monthMin: 0,
    monthLesson: 0,
    ymValue: '',
    aiOn: false,          // AI 教练入口：仅开发者本人可见（由 login 云函数确认）
    poseOn: POSE_ENABLED, // 姿态自查：见 const.js 的开关
    firstRun: false       // 一条记录都没有时，显示上手引导
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

    // 升级自检没过（少记录 / 少文字）→ 提示一次，并告诉用户到哪恢复
    try {
      const warn = store.takeUpgradeWarning();
      if (warn) {
        wx.showModal({
          title: '⚠️ 升级自检提醒',
          content: '这次升级后发现：记录 ' + warn.before + ' → ' + warn.after + ' 条'
            + (warn.lost ? '，有 ' + warn.lost + ' 行笔记没找到' : '') + '。\n\n'
            + (warn.snap ? '升级前的数据已在本机备份，可到「设置 → 高级 → 恢复升级前数据」一键恢复。' : '本机未留存快照，可到「设置 → 数据备份」或云端历史快照恢复。'),
          showCancel: false
        });
      }
    } catch (e) {}
    this.refreshDay();
    this.refreshMonth();
    this.refreshDayMarks();
    this.refreshEntries();
  },

  // 云端刚把数据恢复回来时被调用（sync.js 通知）→ 立刻重画日历，别让用户以为数据没了
  onDataRestored() {
    try {
      this.refreshDay();
      this.refreshMonth();
      this.refreshDayMarks();
      this.refreshEntries();
    } catch (e) {}
  },

  // 入口可见性 + 新用户引导（每次进首页都刷新一次）
  refreshEntries() {
    const app = getApp();
    const apply = () => this.setData({ aiOn: !!(app && app.globalData && app.globalData.isOwner) });
    apply();
    // 启动时那次 login 可能还没回来（或失败），这里补问一次
    if (!app || !app.globalData || app.globalData.isOwner === undefined || !app.globalData.openid) {
      try {
        wx.cloud.callFunction({ name: 'login' }).then(r => {
          const res = (r && r.result) || {};
          if (app && app.globalData) {
            if (res.openid) app.globalData.openid = res.openid;
            app.globalData.isOwner = !!res.isOwner;
          }
          apply();
        }).catch(() => {});
      } catch (e) {}
    }
    try { this.setData({ firstRun: store.loadRecords().length === 0 }); } catch (e) {}
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
    // 按天统计：条数 + 是否含「上课」「自己训练」（日历小点区分用）
    const byDate = {};
    store.loadRecords().forEach(r => {
      const d = byDate[r.date] || (byDate[r.date] = { cnt: 0, lesson: false, self: false });
      d.cnt++;
      if (r.mode === 'lesson') d.lesson = true; else d.self = true;
    });
    const cells = this.data.cells.map(c => {
      if (c.other) return c;
      const d = byDate[c.key];
      return Object.assign({}, c, {
        has: !!d, cnt: d ? d.cnt : 0,
        lesson: !!(d && d.lesson), self: !!(d && d.self)
      });
    });
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
    // 同一天多条记录：按时间段先后排（有时间段的在前、按下段时间升序；没时间段的排后面，保持原顺序）
    const startMin = t => {
      const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? (Number(m[1]) * 60 + Number(m[2])) : -1;
    };
    const recs = store.recordsOf(this.data.selectedDate).slice().sort((a, b) => {
      const ta = startMin(a.time), tb = startMin(b.time);
      if (ta >= 0 && tb >= 0) return ta - tb;
      if (ta >= 0) return -1;
      if (tb >= 0) return 1;
      return 0;
    });
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
      // 条目与顺序统一用 store.recordLines（与训练笔记一致；A 方案：扁平行 + 序号）
      let lines = store.recordLines(r, id => examLabel[id]);
      if (!lines.length) {
        // 兜底：老记录（没选动作）仍显示训练内容里的条目
        lines = String(r.content || '').split(/[\n；;]/)
          .map(x => x.trim().replace(/^[·•\-–—\s]+/, ''))
          .filter(x => x.length)
          .map(t => ({ kind: 'one', name: '', text: t, idx: 0 }));
      }
      const open = !!(this.data.cardOpen || {})[r.id];
      const ITEM_LIMIT = 6;                                     // 收起时最多展示 6 个「练习项」
      const totalItems = lines.filter(l => l.kind !== 'head').length;
      let shown = lines, shownItems = totalItems;
      if (!open && totalItems > ITEM_LIMIT) {
        // 按“项”折叠：标题行不占预算；没有项的标题（如考级标签）照常显示
        shown = []; shownItems = 0;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (l.kind === 'head') {
            const next = lines[i + 1];
            if (shownItems < ITEM_LIMIT || !next || next.kind === 'head') shown.push(l);
            continue;
          }
          if (shownItems >= ITEM_LIMIT) continue;
          shown.push(l); shownItems++;
        }
      }
      return {
        id: r.id,
        content: r.content,
        contentLines: shown,
        totalItems: totalItems,
        moreCount: open ? 0 : Math.max(0, totalItems - shownItems),
        open: open,
        duration: r.duration,
        time: r.time,
        typeName: TYPES[r.type] ? TYPES[r.type].name : '',
        typeEmoji: TYPES[r.type] ? TYPES[r.type].emoji : '',
        typeClass: 'band-' + (TYPES[r.type] ? r.type : 'other'),
        modeName: MODES[r.mode] ? MODES[r.mode].name : '',
        unitsText: (r.mode === 'lesson' && (Number(r.units) || 1) > 1) ? (' · ' + (Number(r.units) || 1) + ' 节') : '',
        timeText: r.time ? String(r.time).replace('-', '–') : '',
        formText: (r.mode === 'lesson' && r.lessonForm && LESSON_FORMS[r.lessonForm]) ? (' · ' + LESSON_FORMS[r.lessonForm].name) : '',
        isLesson: r.mode === 'lesson',
        statusText: statusText,
        done: status === 'done'
      };
    });
    // 清理已不存在记录的展开状态（避免 map 无限增长）
    const ids = {}; dayStats.forEach(d => { ids[d.id] = true; });
    const map = this.data.cardOpen || {};
    const kept = {};
    Object.keys(map).forEach(k => { if (ids[k]) kept[k] = map[k]; });
    this.setData({ dayStats: dayStats, dayMinutes: mins, dayLesson: lesson, cardOpen: kept });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/record/record?date=' + this.data.selectedDate });
  },
  // 卡片「展开 / 收起」训练计划（catchtap，避免触发进入编辑）
  toggleCard(e) {
    const id = e.currentTarget.dataset.id;
    const map = Object.assign({}, this.data.cardOpen || {});
    map[id] = !map[id];
    this.setData({ cardOpen: map }, () => this.refreshDay());
  },
  editRecord(e) {
    wx.navigateTo({ url: '/pages/record/record?id=' + e.currentTarget.dataset.id });
  },
  goPose() {
    if (!POSE_ENABLED) { wx.showToast({ title: '姿态自查暂未开放', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/pose/pose' });
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
