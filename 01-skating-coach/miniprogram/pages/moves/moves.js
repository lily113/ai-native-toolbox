const store = require('../../utils/store');
const { CATS, CAT_ORDER } = require('../../utils/const');

const ROW_H = 64; // 拖动行高（固定，方便算序号）

Page({
  data: {
    tabs: [{ k: 'all', name: '全部' }].concat(CAT_ORDER.map(c => ({ k: c, name: CATS[c].name }))),
    tab: 'all',
    list: [],
    sortOn: false,
    sortList: [],
    areaH: 0,
    ROW_H: ROW_H
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const moves = store.dedupeMoves(store.ensureMoves());
    const tab = this.data.tab;

    // 各类别数量，用于标签角标
    const counts = { all: moves.length };
    CAT_ORDER.forEach(c => { counts[c] = 0; });
    moves.forEach(m => { if (counts[m.category] !== undefined) counts[m.category]++; });
    const tabs = [{ k: 'all', name: '全部', n: counts.all }]
      .concat(CAT_ORDER.map(c => ({ k: c, name: CATS[c].name, n: counts[c] })));

    let shown;
    if (tab === 'all') {
      // “全部”：最新加入的优先
      shown = moves.slice().sort((a, b) => (b.c || 0) - (a.c || 0));
    } else {
      shown = moves
        .filter(m => m.category === tab)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }

    const list = shown.map(m => ({
      id: m.id,
      name: m.name,
      catName: CATS[m.category] ? CATS[m.category].name : '其他',
      drillCount: Array.isArray(m.drills) ? m.drills.length : 0,
      dateText: (Number(m.c) || 0) > 100000000000 ? store.dateKey(new Date(m.c)) : ''
    }));
    const sortList = shown.map((m, i) => ({
      id: m.id,
      name: m.name,
      catName: CATS[m.category] ? CATS[m.category].name : '其他',
      drillCount: Array.isArray(m.drills) ? m.drills.length : 0,
      y: i * ROW_H
    }));

    this.setData({
      tabs: tabs,
      list: list,
      sortList: sortList,
      areaH: Math.max(1, shown.length) * ROW_H
    });
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
    this.setData({ sortOn: !this.data.sortOn });
    this.refresh();
  },

  openMove(e) {
    wx.navigateTo({ url: '/pages/move/move?id=' + e.currentTarget.dataset.id });
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
    wx.showModal({
      title: '新动作',
      editable: true,
      placeholderText: '名称，如：后外点冰跳 / 燕式旋转…',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        wx.showActionSheet({
          itemList: CAT_ORDER.map(c => CATS[c].name),
          success: res => {
            const cat = CAT_ORDER[res.tapIndex];
            const moves = store.ensureMoves();
            let max = -1;
            moves.forEach(m => { if (m.category === cat && typeof m.sort === 'number' && m.sort > max) max = m.sort; });
            moves.push({ id: store.uid(), name: name, category: cat, drills: [], sort: max + 1, c: Date.now() });
            store.saveMoves(moves);
            this.refresh();
            wx.showToast({ title: '已添加' });
          }
        });
      }
    });
  }
});
