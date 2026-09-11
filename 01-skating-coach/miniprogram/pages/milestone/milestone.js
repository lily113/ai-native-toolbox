const store = require('../../utils/store');
const { MS_TYPES } = require('../../utils/const');

Page({
  data: {
    list: [],
    editOn: false,
    editId: null,
    type: 'skates',
    date: '',
    title: '',
    note: '',
    types: MS_TYPES
  },

  onLoad() {
    this.setData({ date: store.todayKey() });
  },
  onShow() { this.reload(); },

  emo(k) { const t = MS_TYPES.find(x => x.k === k); return t ? t.emoji : '📅'; },
  typeName(k) { const t = MS_TYPES.find(x => x.k === k); return t ? t.name : '纪念'; },

  reload() {
    const arr = store.ensureMilestones();
    const list = arr
      .map(m => ({
        id: m.id,
        date: m.date,
        title: m.title || '',
        note: m.note || '',
        emo: this.emo(m.type),
        typeName: this.typeName(m.type)
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    this.setData({ list });
  },

  add() {
    this.setData({ editOn: true, editId: null, type: 'skates', date: store.todayKey(), title: '', note: '' });
  },
  openEdit(e) {
    const arr = store.ensureMilestones();
    const m = arr.find(x => x.id === e.currentTarget.dataset.id);
    if (!m) return;
    this.setData({ editOn: true, editId: m.id, type: m.type, date: m.date, title: m.title || '', note: m.note || '' });
  },
  closeEdit() { this.setData({ editOn: false }); },
  noop() {},

  setType(e) { this.setData({ type: e.currentTarget.dataset.k }); },
  setDate(e) { this.setData({ date: e.detail.value }); },
  input(e) { const k = e.currentTarget.dataset.k; this.setData({ [k]: e.detail.value }); },

  save() {
    const { editId, type, date, title, note } = this.data;
    if (!date) { wx.showToast({ title: '请选择日期', icon: 'none' }); return; }
    let arr = store.ensureMilestones();
    if (editId) {
      const i = arr.findIndex(x => x.id === editId);
      if (i > -1) arr[i] = Object.assign({}, arr[i], { type, date, title, note });
    } else {
      arr.push({ id: store.uid(), key: '', type, date, title, note });
    }
    store.saveMilestones(arr);
    this.reload();
    this.closeEdit();
    wx.showToast({ title: '已保存' });
  },

  delInEdit() {
    const id = this.data.editId;
    if (!id) return;
    wx.showModal({
      title: '删除',
      content: '确定删除这个纪念日？',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        store.saveMilestones(store.ensureMilestones().filter(x => x.id !== id));
        this.closeEdit();
        this.reload();
        wx.showToast({ title: '已删除' });
      }
    });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除',
      content: '确定删除这个纪念日？',
      success: r => {
        if (!r.confirm) return;
        store.saveMilestones(store.ensureMilestones().filter(x => x.id !== id));
        this.reload();
        wx.showToast({ title: '已删除' });
      }
    });
  }
});
