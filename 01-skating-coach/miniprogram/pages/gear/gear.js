const store = require('../../utils/store');

// 时长不单独记：从已上冰的记录里按日期区间累加，所以这里只维护"哪双鞋、什么时候用、上次磨刀"
function fmtMin(min) {
  const m = Number(min) || 0;
  if (m <= 0) return '0 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.round(m / 60 * 10) / 10;
  return (h % 1 === 0 ? String(Math.round(h)) : h.toFixed(1)) + ' 小时';
}
function fmtMonths(days) {
  const d = Number(days) || 0;
  if (d < 31) return d + ' 天';
  const mo = Math.round(d / 30.4);
  return mo >= 12 ? (Math.round(mo / 12 * 10) / 10) + ' 年' : mo + ' 个月';
}

Page({
  data: {
    today: '',
    list: [],
    editOn: false,
    editId: '',
    name: '', startDate: '', endDate: '', sharpenDate: '',
    canClearEnd: false
  },

  onShow() { this.reload(); },

  reload() {
    const rows = store.skateStats().map(k => ({
      id: k.id,
      name: k.name,
      startDate: k.startDate,
      endDate: k.endDate,
      sharpenDate: k.sharpenDate,
      active: k.active,
      hoursText: fmtMin(k.minutes),
      sessions: k.sessions,
      useText: fmtMonths(k.useDays),
      perWeekText: k.perWeek > 0 ? (k.perWeek + ' 小时') : '',
      sharpenText: k.sharpenDays < 0 ? '' : (k.sharpenDays === 0 ? '今天磨的' : (k.sharpenDays + ' 天前')),
      note: k.note
    }));
    this.setData({ list: rows, today: store.todayKey() });
  },

  // ---------- 编辑弹层 ----------
  add() {
    this.setData({
      editOn: true, editId: '', name: '',
      startDate: store.todayKey(), endDate: '', sharpenDate: '',
      canClearEnd: false
    });
  },
  edit(e) {
    const id = e.currentTarget.dataset.id;
    const k = store.skateOf(id);
    if (!k) return;
    this.setData({
      editOn: true, editId: k.id, name: k.name,
      startDate: k.startDate || store.todayKey(), endDate: k.endDate, sharpenDate: k.sharpenDate,
      canClearEnd: !!k.endDate
    });
  },
  closeEdit() { this.setData({ editOn: false }); },
  noop() {},
  input(e) { this.setData({ name: e.detail.value }); },
  setStart(e) { this.setData({ startDate: e.detail.value }); },
  setEnd(e) { this.setData({ endDate: e.detail.value, canClearEnd: true }); },
  clearEnd() { this.setData({ endDate: '', canClearEnd: false }); },
  setSharpen(e) { this.setData({ sharpenDate: e.detail.value }); },
  clearSharpen() { this.setData({ sharpenDate: '' }); },

  save() {
    const name = String(this.data.name || '').trim();
    const startDate = this.data.startDate;
    if (!startDate) { wx.showToast({ title: '请选启用日期', icon: 'none' }); return; }
    const endDate = this.data.endDate;
    if (endDate && endDate < startDate) { wx.showToast({ title: '退役日期不能早于启用', icon: 'none' }); return; }
    const list = store.ensureSkates();
    if (this.data.editId) {
      const item = list.filter(x => x.id === this.data.editId)[0];
      if (!item) { wx.showToast({ title: '这双鞋已经不在了', icon: 'none' }); return; }
      item.name = name || item.name;
      item.startDate = startDate;
      item.endDate = endDate;
      item.sharpenDate = this.data.sharpenDate;
    } else {
      list.push({ id: store.uid(), name: name || '冰鞋', startDate: startDate, endDate: endDate, sharpenDate: this.data.sharpenDate });
    }
    store.saveSkates(list);
    this.setData({ editOn: false });
    this.reload();
    wx.showToast({ title: '已保存' });
  },

  del() {
    if (!this.data.editId) return;
    const id = this.data.editId;
    const k = store.skateOf(id);
    if (!k) return;
    wx.showModal({
      title: '删除装备',
      content: '删掉「' + k.name + '」？只是不统计它了，训练记录一条都不会动。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        store.saveSkates(store.ensureSkates().filter(x => x.id !== id));
        this.setData({ editOn: false });
        this.reload();
        wx.showToast({ title: '已删除' });
      }
    });
  },

  // ---------- 常用动作 ----------
  // 换新鞋：把"当前在用的"全部记到今天就退役，再建一双从今天开始的。
  //   允许同时有多双在用的（比如练习鞋 + 比赛鞋），所以这里关的是**全部**在用的，
  //   不能只关一双 —— 否则换完还剩一双"当前"，用户会莫名其妙。
  changeSkates() {
    const today = store.todayKey();
    const open = store.ensureSkates().filter(x => !x.endDate);
    const names = open.map(x => '「' + x.name + '」').join('');
    wx.showModal({
      title: '换新鞋',
      content: open.length
        ? '把' + names + '记到今天就退役，再新建一双从今天开始？'
        : '新建一双从今天开始的冰鞋？',
      confirmText: '换新',
      success: r => {
        if (!r.confirm) return;
        const list = store.ensureSkates();
        list.forEach(x => { if (!x.endDate) x.endDate = today; });
        const n = list.length + 1;
        list.push({ id: store.uid(), name: '第 ' + n + ' 双鞋', startDate: today, endDate: '', sharpenDate: '' });
        store.saveSkates(list);
        this.reload();
        wx.showToast({ title: '已换新鞋，记得改名字', icon: 'none' });
      }
    });
  },

  // 今天磨了刀（列表里一键）
  sharpenToday(e) {
    const id = e.currentTarget.dataset.id;
    const list = store.ensureSkates();
    const item = list.filter(x => x.id === id)[0];
    if (!item) return;
    item.sharpenDate = store.todayKey();
    store.saveSkates(list);
    this.reload();
    wx.showToast({ title: '记下了：今天磨的刀' });
  }
});
