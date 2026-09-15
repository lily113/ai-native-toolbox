const store = require('../../utils/store');
const { CATS } = require('../../utils/const');

Page({
  data: {
    id: '',
    name: '',
    catName: '',
    drills: [],
    movePoints: [],
    ptsOn: false, editPts: [],
    // 编辑弹层
    editOn: false,
    editId: null,
    editName: '',
    editDate: '',
    editPoints: []
  },

  onLoad(q) {
    this.setData({ id: q.id || '' });
  },

  onShow() {
    this.reload();
  },

  reload() {
    const m = store.moveById(this.data.id);
    if (!m) { wx.showToast({ title: '动作不存在', icon: 'none' }); setTimeout(() => wx.navigateBack(), 400); return; }
    const raw = (m.drills || []).slice().sort((a, b) => (Number(b.c) || 0) - (Number(a.c) || 0));
    const drills = raw.map((d, i) => ({
      id: d.id,
      name: d.name,
      no: i + 1,
      dateText: (Number(d.c) || 0) > 100000000000 ? store.dateKey(new Date(d.c)) : '',
      points: (d.points && d.points.length) ? d.points : (d.detail ? [d.detail] : [])
    }));
    this.setData({
      name: m.name,
      catName: CATS[m.category] ? CATS[m.category].name : '其他',
      movePoints: (m.points || []).slice(),
      drills: drills
    });
  },

  // ---------- 共性要点（弹层） ----------
  openPts() {
    const m = store.moveById(this.data.id);
    if (!m) return;
    this.setData({ ptsOn: true, editPts: (m.points || []).slice() });
  },
  closePts() { this.setData({ ptsOn: false }); },
  onPt(e) { const i = e.currentTarget.dataset.i; this.setData({ ['editPts[' + i + ']']: e.detail.value }); },
  addPt() { this.setData({ editPts: this.data.editPts.concat(['']) }); },
  delPt(e) { const a = this.data.editPts.slice(); a.splice(e.currentTarget.dataset.i, 1); this.setData({ editPts: a }); },
  savePts() {
    const pts = this.data.editPts.map(p => (p || '').trim()).filter(p => p.length);
    const moves = store.ensureMoves();
    const m = moves.find(x => x.id === this.data.id);
    if (!m) return;
    m.points = pts;
    store.saveMoves(moves);
    this.reload();
    this.closePts();
    wx.showToast({ title: '已保存' });
  },

  // ---------- 添加 / 编辑组合（弹层） ----------
  addDrill() {
    this.openEdit(null);
  },

  openEdit(e) {
    const did = (typeof e === 'string') ? e : (e && e.currentTarget ? e.currentTarget.dataset.id : null);
    const moves = store.ensureMoves();
    const m = moves.find(x => x.id === this.data.id);
    if (!m) return;
    if (did) {
      const dr = (m.drills || []).find(d => d.id === did);
      if (!dr) return;
      this.setData({
        editOn: true, editId: did, editName: dr.name,
        editDate: (Number(dr.c) || 0) > 100000000000 ? store.dateKey(new Date(dr.c)) : '',
        editPoints: (dr.points && dr.points.length) ? dr.points.slice() : (dr.detail ? [dr.detail] : [])
      });
    } else {
      this.setData({ editOn: true, editId: null, editName: '', editDate: store.todayKey(), editPoints: [] });
    }
  },

  closeEdit() { this.setData({ editOn: false }); },
  noop() {},

  onName(e) { this.setData({ editName: e.detail.value }); },
  onDateChange(e) { this.setData({ editDate: e.detail.value }); },
  onPoint(e) {
    const i = e.currentTarget.dataset.i;
    const pts = this.data.editPoints.slice();
    pts[i] = e.detail.value;
    this.setData({ editPoints: pts });
  },
  addPoint() { this.setData({ editPoints: this.data.editPoints.concat(['']) }); },
  delPoint(e) {
    const i = e.currentTarget.dataset.i;
    const pts = this.data.editPoints.slice();
    pts.splice(i, 1);
    this.setData({ editPoints: pts });
  },

  saveEdit() {
    const name = (this.data.editName || '').trim();
    if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
    const points = this.data.editPoints.map(p => (p || '').trim()).filter(p => p.length);
    let ts = 0;
    if (this.data.editDate) {
      const p2 = String(this.data.editDate).split('-').map(Number);
      if (p2[0] && p2[1] && p2[2]) ts = new Date(p2[0], p2[1] - 1, p2[2], 12, 0, 0).getTime();
    }
    const moves = store.ensureMoves();
    const m = moves.find(x => x.id === this.data.id);
    if (!m) return;
    if (this.data.editId) {
      const dr = (m.drills || []).find(d => d.id === this.data.editId);
      if (dr) {
        dr.name = name; dr.points = points; dr.detail = points.join('；');
        if (ts) dr.c = ts; else if (!dr.c) dr.c = Date.now();
      }
    } else {
      m.drills.push({ id: store.uid(), name: name, points: points, detail: points.join('；'), c: ts || Date.now() });
    }
    store.saveMoves(moves);
    this.reload();
    this.closeEdit();
    wx.showToast({ title: '已保存' });
  },

  delDrill(e) {
    const did = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除组合',
      content: '确定删除这个练习组合？',
      success: r => {
        if (!r.confirm) return;
        const moves = store.ensureMoves();
        const m = moves.find(x => x.id === this.data.id);
        if (!m) return;
        m.drills = (m.drills || []).filter(d => d.id !== did);
        store.saveMoves(moves);
        this.reload();
        wx.showToast({ title: '已删除' });
      }
    });
  },

  delMove() {
    wx.showModal({
      title: '删除动作',
      content: '确定删除「' + this.data.name + '」？它的练习组合也会一起删除。',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        const all = store.ensureMoves();
        store.saveMoves(all.filter(x => x.id !== this.data.id));
        wx.showToast({ title: '已删除' });
        setTimeout(() => wx.navigateBack(), 300);
      }
    });
  }
});
