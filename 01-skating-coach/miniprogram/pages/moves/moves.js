const store = require('../../utils/store');

// 「最久没练」那一行显示什么：优先显示这个动作下最荒的组合
function staleLine(u) {
  if (!u || !u.staleDrill) return '';
  const d = u.staleDrill;
  return d.never
    ? ('最久没练：' + d.name + ' · 加了 ' + d.days + ' 天还没练过')
    : ('最久没练：' + d.name + ' · ' + d.days + ' 天');
}

const ROW_H = 64; // 拖动行高（固定，方便算序号）

Page({
  data: {
    tabs: [],
    tab: 'all',
    list: [],
    sortOn: false,
    sortList: [],
    areaH: 0,
    ROW_H: ROW_H,
    bulkOn: false,
    selIds: [],
    selCount: 0,
    allSel: false,
    sortByStale: false,     // 「最久没练」优先
    onlyActive: false,      // 只看在练（收起"组合全部已掌握"的动作）
    activeN: 0,
    drillAll: 0,
    masteredN: 0            // 已掌握的**组合**数
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const cats = store.cats();
    const moves = store.dedupeMoves(store.ensureMoves());
    // 练习统计（练过几次 / 上次哪天）——数据来自训练记录
    const usage = store.moveUsage();
    let tab = this.data.tab;
    if (tab !== 'all' && !cats.some(c => c.id === tab)) tab = 'all';   // 分类被删掉后回到「全部」

    // 各类别数量，用于标签角标
    const counts = { all: moves.length };
    cats.forEach(c => { counts[c.id] = 0; });
    moves.forEach(m => { const c = store.validCat(m.category); counts[c] = (counts[c] || 0) + 1; });
    const tabs = [{ k: 'all', name: '全部', n: counts.all }]
      .concat(cats.map(c => ({ k: c.id, name: c.name, n: counts[c.id] || 0 })));
    const nameOf = {};
    cats.forEach(c => { nameOf[c.id] = c.name; });

    let shown;
    if (tab === 'all') {
      // “全部”：最新加入的优先
      shown = moves.slice().sort((a, b) => (b.c || 0) - (a.c || 0));
    } else {
      shown = moves
        .filter(m => store.validCat(m.category) === tab)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }
    if (this.data.sortByStale) {
      // 「最久没练」按**组合**排（用户口径）：
      //   排序键 = 这个动作下最荒的练习组合的天数；没有组合的动作用动作自身。
      //   沉底不变：整个动作从没练过 / 已掌握 → 排到最后。
      const gap = m => {
        const u = usage[m.id];
        if (!u || !u.last) return -1;               // 这个动作根本没练过
        if (u.allMastered) return -1;               // 组合都标了已掌握 → 不再提醒
        const d = Number(u.staleDays);
        return isNaN(d) ? -1 : d;
      };
      shown = shown.slice().sort((a, b) => gap(b) - gap(a));
    }
    if (this.data.onlyActive) {
      // 只看在练：收起"组合全部标了已掌握"的动作（部分掌握仍算在练）
      shown = shown.filter(m => !(usage[m.id] && usage[m.id].allMastered));
    }

    // 批量整理：选中项跨分类保留，但清掉已经不存在的动作
    const alive = {};
    moves.forEach(m => { alive[m.id] = 1; });
    const sel = (this.data.selIds || []).filter(id => alive[id]);

    const list = shown.map(m => ({
      id: m.id,
      name: m.name,
      catName: nameOf[store.validCat(m.category)] || '其他',
      drillCount: Array.isArray(m.drills) ? m.drills.length : 0,
      dateText: (Number(m.c) || 0) > 100000000000 ? store.dateKey(new Date(m.c)) : '',
      usageText: store.moveUsageText(usage[m.id]),
      staleText: staleLine(usage[m.id]),
      mastered: !!(usage[m.id] && usage[m.id].allMastered),
      masteredN: usage[m.id] ? usage[m.id].masteredN : 0,
      drillN: usage[m.id] ? usage[m.id].drillN : 0,
      stale: !!(usage[m.id] && usage[m.id].last && Number(usage[m.id].staleDays) > 30),
      picked: sel.indexOf(m.id) > -1
    }));
    const sortList = shown.map((m, i) => ({
      id: m.id,
      name: m.name,
      catName: nameOf[store.validCat(m.category)] || '其他',
      drillCount: Array.isArray(m.drills) ? m.drills.length : 0,
      y: i * ROW_H
    }));
    const shownIds = list.map(x => x.id);

    // 顶部计数：动作数 + 已掌握的**组合**数
    let drillAll = 0, drillMastered = 0;
    moves.forEach(m => {
      const u = usage[m.id];
      if (!u) return;
      drillAll += u.drillN || 0;
      drillMastered += u.masteredN || 0;
    });
    this.setData({
      activeN: moves.length,
      drillAll: drillAll,
      masteredN: drillMastered,
      tab: tab,
      tabs: tabs,
      list: list,
      sortList: sortList,
      areaH: Math.max(1, shown.length) * ROW_H,
      selIds: sel,
      selCount: sel.length,
      allSel: shownIds.length > 0 && shownIds.every(id => sel.indexOf(id) > -1)
    });
  },

  toggleActive() {
    this.setData({ onlyActive: !this.data.onlyActive }, () => this.refresh());
  },
  toggleStale() {
    this.setData({ sortByStale: !this.data.sortByStale }, () => this.refresh());
  },
  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.k, sortOn: false });
    this.refresh();
  },

  toggleSort() {
    if (this.data.tab === 'all') {
      wx.showToast({ title: '请在具体分类里拖动排序', icon: 'none' });
      return;
    }
    this.setData({ sortOn: !this.data.sortOn, bulkOn: false, selIds: [] });
    this.refresh();
  },

  // ---------- 批量整理 ----------
  toggleBulk() {
    const on = !this.data.bulkOn;
    this.setData({ bulkOn: on, sortOn: false, selIds: [] });
    this.refresh();
    if (on) wx.showToast({ title: '点动作多选，可批量改分类', icon: 'none' });
  },

  tapRow(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.bulkOn) { wx.navigateTo({ url: '/pages/move/move?id=' + id }); return; }
    const sel = (this.data.selIds || []).slice();
    const i = sel.indexOf(id);
    if (i > -1) sel.splice(i, 1); else sel.push(id);
    this.setData({ selIds: sel });
    this.refresh();
  },

  bulkAll() {
    const ids = this.data.list.map(x => x.id);
    const sel = (this.data.selIds || []).slice();
    let next;
    if (ids.length && ids.every(id => sel.indexOf(id) > -1)) {
      next = sel.filter(id => ids.indexOf(id) < 0);
    } else {
      next = sel.slice();
      ids.forEach(id => { if (next.indexOf(id) < 0) next.push(id); });
    }
    this.setData({ selIds: next });
    this.refresh();
  },

  bulkMove() {
    const sel = this.data.selIds || [];
    if (!sel.length) { wx.showToast({ title: '先点选要整理的动作', icon: 'none' }); return; }
    const cats = store.cats();
    wx.showActionSheet({
      itemList: cats.map(c => '移到「' + c.name + '」'),
      success: res => {
        const t = cats[res.tapIndex];
        if (!t) return;
        const all = store.ensureMoves();
        let n = 0;
        all.forEach(m => {
          if (sel.indexOf(m.id) < 0) return;
          if (store.validCat(m.category) === t.id) return;
          m.category = t.id;
          let max = -1;
          all.forEach(x => { if (x.id !== m.id && x.category === t.id && typeof x.sort === 'number' && x.sort > max) max = x.sort; });
          m.sort = max + 1;
          n++;
        });
        store.saveMoves(all);
        this.setData({ selIds: [] });
        this.refresh();
        wx.showToast({ title: n ? ('已移动 ' + n + ' 个') : '都已经在这个分类里', icon: 'none' });
      }
    });
  },

  bulkDel() {
    const sel = this.data.selIds || [];
    if (!sel.length) { wx.showToast({ title: '先点选要删除的动作', icon: 'none' }); return; }
    wx.showModal({
      title: '批量删除动作',
      content: '确定删除选中的 ' + sel.length + ' 个动作？它们的练习组合也会一起删除。已经写进训练笔记的文字不会被改动。',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        store.saveMoves(store.ensureMoves().filter(m => sel.indexOf(m.id) < 0));
        this.setData({ selIds: [] });
        this.refresh();
        wx.showToast({ title: '已删除 ' + sel.length + ' 个' });
      }
    });
  },

  openCats() {
    wx.navigateTo({ url: '/pages/cats/cats' });
  },

  onDragSort(e) {
    const id = e.currentTarget.dataset.id;
    const y = e.detail.y;
    const target = Math.max(0, Math.min(this.data.sortList.length - 1, Math.round(y / ROW_H)));
    const list = this.data.sortList.slice();
    const cur = list.findIndex(x => x.id === id);
    if (cur < 0 || target === cur) return;
    const item = list[cur];
    list.splice(cur, 1);
    list.splice(target, 0, item);
    list.forEach((it, i) => { it.y = i * ROW_H; });
    this.setData({ sortList: list });
    // 持久化：把该分类里的 sort 值重排
    const moves = store.dedupeMoves(store.ensureMoves());
    const map = {}; moves.forEach(m => { map[m.id] = m; });
    list.forEach((it, i) => { if (map[it.id]) map[it.id].sort = i; });
    store.saveMoves(moves);
  },

  add() {
    const cats = store.cats();
    const create = (name, cat) => {
      const moves = store.ensureMoves();
      let max = -1;
      moves.forEach(m => { if (m.category === cat && typeof m.sort === 'number' && m.sort > max) max = m.sort; });
      moves.push({ id: store.uid(), name: name, category: cat, drills: [], sort: max + 1, c: Date.now() });
      store.saveMoves(moves);
      this.refresh();
      wx.showToast({ title: '已添加' });
    };
    wx.showModal({
      title: '新动作',
      editable: true,
      placeholderText: '名称，如：后外点冰跳 / 变刃步伐串…',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        // 已经停在某个分类里：直接放进该分类，不再问一次
        if (this.data.tab !== 'all' && cats.some(c => c.id === this.data.tab)) { create(name, this.data.tab); return; }
        wx.showActionSheet({
          itemList: cats.map(c => c.name),
          success: res => {
            const t = cats[res.tapIndex];
            if (t) create(name, t.id);
          }
        });
      }
    });
  }
});
