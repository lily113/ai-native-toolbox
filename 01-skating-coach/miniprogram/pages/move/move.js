const store = require('../../utils/store');

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
    editPoints: [],
    // 「移动组合到别的动作」选择模式
    examLinks: [],
    status: 'active',
    drillSelOn: false,
    drillPickN: 0,
    pickOn: false,
    pickQuery: '',
    pickList: []
  },

  onLoad(q) {
    this.setData({ id: q.id || '' });
  },

  onShow() {
    this.reload();
  },

  onShareAppMessage() {
    // ⚠️ 动作 id 是每台设备随机生成的，分享这一页给别人只会"动作不存在"。
    // 所以分享的是首页（别人打开就是他自己的空库/自己的数据），标题说清这是什么。
    const n = (this.data.drills || []).length;
    return {
      title: '我把花滑动作和教练说的要点都记在这儿了' + (n ? ('（像「' + this.data.name + '」这种，一个动作下挂 ' + n + ' 个组合）') : ''),
      path: '/pages/index/index'
    };
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
    const sel = this.data.drillSel || {};
    drills.forEach(d => { d.picked = !!sel[d.id]; });
    // 练习统计：这个动作练过几次、最近一次；每个组合各练过几次
    let usage = {}, usageText = '还没练过';
    try {
      usage = store.moveUsage();
      usageText = store.moveUsageText(usage[m.id]);
      drills.forEach(d => {
        const du = (usage[m.id] && usage[m.id].drills) ? usage[m.id].drills[d.id] : null;
        d.usageText = du && du.n ? ('练过 ' + du.n + ' 次 · ' + (du.last ? du.last.slice(5).replace('-', '/') : '')) : '';
      });
    } catch (e) {}
    // 这个动作被挂到哪些考级要求上（在考级页里「挂到动作」建立的关系）
    let links = [];
    try { links = store.examMoveLinks(m.id).map(x => ({ label: x.kindName + ' · ' + x.level, title: x.title || x.secName })); } catch (e) {}
    this.setData({
      status: (m.status === 'mastered') ? 'mastered' : 'active',
      usageText: usageText,
      examLinks: links,
      name: m.name,
      catName: store.catName(store.validCat(m.category)),
      movePoints: (m.points || []).slice(),
      drills: drills,
      drillPickN: drills.filter(d => d.picked).length
    });
  },

  // ---------- 标记「已掌握 / 在练」 ----------
  // 不建议为了"太简单了"而删除：删掉会让历史记录里的引用断链（我们修过的"失效条目行"）。
  // 标记只是状态变了，账本、组合、教练要点都还在。
  toggleStatus() {
    const cur = this.data.status === 'mastered';
    const next = cur ? 'active' : 'mastered';
    const run = () => {
      const out = store.setMoveStatus(this.data.id, next);
      if (!out.ok) { wx.showToast({ title: out.reason || '操作失败', icon: 'none' }); return; }
      this.reload();
      wx.showToast({ title: next === 'mastered' ? '已标记为「已掌握」' : '已退回「在练」', icon: 'none' });
    };
    if (next === 'mastered') {
      wx.showModal({
        title: '标记为已掌握',
        content: '「' + this.data.name + '」会标成已掌握：\n\n· 动作、练习组合、教练要点全部保留，历史记录照旧能翻到\n· 不再出现在"最久没练"提醒里\n· 动作列表可以用「只看在练」把它收起来\n\n以后想复习，随时可以退回「在练」。',
        confirmText: '标记已掌握',
        success: r => { if (r.confirm) run(); }
      });
      return;
    }
    run();
  },

  // ---------- 改动作名称 ----------
  renameMove() {
    const cur = this.data.name;
    wx.showModal({
      title: '改动作名称',
      editable: true,
      placeholderText: '动作名，如：膝关节韵律练习',
      content: cur,
      confirmText: '保存',
      success: r => {
        if (!r.confirm) return;
        const nm = String(r.content || '').trim();
        if (!nm) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (nm === cur) return;
        const out = store.renameMove(this.data.id, nm);
        if (!out.ok) { wx.showToast({ title: out.reason || '改名失败', icon: 'none' }); return; }
        this.reload();
        wx.showToast({ title: out.merged ? ('已改名为「' + nm + '」并合并了同名动作') : '已改名', icon: 'none', duration: out.merged ? 2500 : 1500 });
      }
    });
  },

  // ---------- 把练习组合移到别的动作下 ----------
  toggleDrillSel() {
    const on = !this.data.drillSelOn;
    this.setData({ drillSelOn: on, drillSel: on ? (this.data.drillSel || {}) : {} }, () => this.reload());
  },
  tapDrill(e) {
    const did = e.currentTarget.dataset.id;
    if (!this.data.drillSelOn) { this.openEdit(e); return; }
    const sel = Object.assign({}, this.data.drillSel || {});
    if (sel[did]) delete sel[did]; else sel[did] = 1;
    this.setData({ drillSel: sel }, () => this.reload());
  },
  openPick() {
    const n = Object.keys(this.data.drillSel || {}).length;
    if (!n) { wx.showToast({ title: '先点选要移动的组合', icon: 'none' }); return; }
    const catMap = store.catMap();
    this.setData({ pickOn: true, pickQuery: '' }, () => this.refreshPick());
  },
  closePick() { this.setData({ pickOn: false }); },
  onPickQuery(e) { this.setData({ pickQuery: e.detail.value }, () => this.refreshPick()); },
  refreshPick() {
    const q = String(this.data.pickQuery || '').trim().toLowerCase();
    const list = store.ensureMoves()
      .filter(m => m.id !== this.data.id)
      .filter(m => !q || String(m.name).toLowerCase().indexOf(q) > -1
        || (m.drills || []).some(d => String(d.name).toLowerCase().indexOf(q) > -1))
      .map(m => ({
        id: m.id, name: m.name,
        catName: store.catName(store.validCat(m.category)),
        n: (m.drills || []).length
      }));
    this.setData({ pickList: list });
  },
  doMoveDrill(e) {
    const toId = e.currentTarget.dataset.id;
    const ids = Object.keys(this.data.drillSel || {});
    const dst = store.moveById(toId);
    if (!dst || !ids.length) return;
    wx.showModal({
      title: '移动组合',
      content: '把 ' + ids.length + ' 个练习组合移到「' + dst.name + '」下面？\n\n（历史训练记录里用过的这个组合也会跟着显示在新动作下，记录内容不会变）',
      confirmText: '移动',
      success: r => {
        if (!r.confirm) return;
        const out = store.moveDrillsTo(ids, toId);
        if (!out.ok) { wx.showToast({ title: out.reason || '移动失败', icon: 'none' }); return; }
        this.setData({ drillSelOn: false, drillSel: {}, pickOn: false });
        this.reload();
        wx.showModal({
          title: '已移动 ' + out.moved + ' 个组合',
          content: '「' + out.from.join('、') + '」 → 「' + out.to + '」\n'
            + (out.records ? '同时更新了 ' + out.records + ' 条历史记录里的归属（卡片上会显示在新动作下面）。' : '没有历史记录引用这些组合，无需改动记录。'),
          showCancel: false
        });
      }
    });
  },

  // 改所属分类（分类 id 变，动作 id 不变，历史记录照旧能对上）
  pickCat() {
    const cats = store.cats();
    const m = store.moveById(this.data.id);
    if (!m) return;
    const cur = store.validCat(m.category);
    const itemList = cats.map(c => (c.id === cur ? '✓ ' : '') + c.name);
    wx.showActionSheet({
      itemList: itemList,
      success: res => {
        const t = cats[res.tapIndex];
        if (!t || t.id === cur) return;
        const moves = store.ensureMoves();
        const it = moves.filter(x => x.id === this.data.id)[0];
        if (!it) return;
        it.category = t.id;
        let max = -1;
        moves.forEach(x => { if (x.id !== it.id && x.category === t.id && typeof x.sort === 'number' && x.sort > max) max = x.sort; });
        it.sort = max + 1;
        store.saveMoves(moves);
        this.reload();
        wx.showToast({ title: '已移到「' + t.name + '」' });
      }
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
    // 有多少条历史训练记录引用了这个动作？（删掉后那些记录里的条目行就没法通过取消勾选删除了）
    let used = 0;
    try {
      const all0 = store.ensureMoves();
      const cur = all0.filter(x => x.id === this.data.id)[0] || {};
      const dIds = (cur.drills || []).map(d => d.id);
      (store.loadRecords() || []).forEach(rec => {
        const hitM = (rec.moves || []).indexOf(this.data.id) > -1;
        const hitD = (rec.drills || []).some(d => dIds.indexOf(d) > -1);
        if (hitM || hitD) used++;
      });
    } catch (e) {}
    const extra = used
      ? '\n\n注意：有 ' + used + ' 条历史训练记录用到它，删除后那些记录里对应的条目行需要手动清理。\n\n如果只是"现在水平用不上了"，更推荐点上面的「标记为已掌握」——账本和组合都留着，以后复习还能翻。'
      : '\n\n（如果只是暂时不练了，也可以点上面的「标记为已掌握」，比删除温和。）';
    wx.showModal({
      title: '删除动作',
      content: '确定删除「' + this.data.name + '」？它的练习组合也会一起删除。' + extra,
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
