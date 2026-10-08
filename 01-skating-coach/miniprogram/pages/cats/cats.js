const store = require('../../utils/store');

Page({
  data: { list: [], total: 0 },

  onShow() { this.reload(); },

  reload() {
    const moves = store.ensureMoves();
    const cnt = {};
    moves.forEach(m => {
      const c = store.validCat(m.category);
      cnt[c] = (cnt[c] || 0) + 1;
    });
    const cats = store.cats();
    const list = cats.map((c, i) => ({
      id: c.id,
      name: c.name,
      n: cnt[c.id] || 0,
      fixed: c.id === store.CAT_FALLBACK,
      first: i === 0,
      last: i === cats.length - 1
    }));
    this.setData({ list: list, total: moves.length });
  },

  // 改名（分类 id 不变，历史记录不受影响）
  rename(e) {
    const id = e.currentTarget.dataset.id;
    const cats = store.cats();
    const c = cats.filter(x => x.id === id)[0];
    if (!c) return;
    wx.showModal({
      title: '重命名分类',
      editable: true,
      content: c.name,
      placeholderText: '分类名称',
      success: r => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (name.length > 8) { wx.showToast({ title: '名称请控制在 8 字内', icon: 'none' }); return; }
        if (cats.some(x => x.id !== id && x.name === name)) { wx.showToast({ title: '已有同名分类', icon: 'none' }); return; }
        cats.forEach(x => { if (x.id === id) x.name = name; });
        store.saveCats(cats);
        this.reload();
        wx.showToast({ title: '已保存' });
      }
    });
  },

  add() {
    wx.showModal({
      title: '新建分类',
      editable: true,
      placeholderText: '如：体能 / 柔韧 / 冰舞',
      success: r => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (name.length > 8) { wx.showToast({ title: '名称请控制在 8 字内', icon: 'none' }); return; }
        const cats = store.cats();
        if (cats.some(x => x.name === name)) { wx.showToast({ title: '已有同名分类', icon: 'none' }); return; }
        const item = { id: 'c' + store.uid().slice(0, 7), name: name };
        const at = cats.findIndex(x => x.id === store.CAT_FALLBACK);
        if (at >= 0) cats.splice(at, 0, item); else cats.push(item);
        store.saveCats(cats);
        this.reload();
        wx.showToast({ title: '已添加' });
      }
    });
  },

  // 「其他」是兜底分类：固定存在、固定排最后，不可移动/删除
  up(e) { this.move(e.currentTarget.dataset.id, -1); },
  down(e) { this.move(e.currentTarget.dataset.id, 1); },
  move(id, dir) {
    if (id === store.CAT_FALLBACK) { wx.showToast({ title: '「其他」固定排在最后', icon: 'none' }); return; }
    const cats = store.cats();
    const i = cats.findIndex(x => x.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    if (cats[j].id === store.CAT_FALLBACK) { wx.showToast({ title: '「其他」固定排在最后', icon: 'none' }); return; }
    const t = cats[i]; cats[i] = cats[j]; cats[j] = t;
    store.saveCats(cats);
    this.reload();
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    if (id === store.CAT_FALLBACK) { wx.showToast({ title: '「其他」不能删除', icon: 'none' }); return; }
    const cats = store.cats();
    const c = cats.filter(x => x.id === id)[0];
    if (!c) return;
    const all = store.ensureMoves();
    const n = all.filter(m => store.validCat(m.category) === id).length;

    if (!n) {
      wx.showModal({
        title: '删除分类',
        content: '确定删除「' + c.name + '」？该分类下没有动作。',
        confirmColor: '#dc2626',
        success: r => { if (r.confirm) this.drop(id, c.name, cats); }
      });
      return;
    }
    // 分类下还有动作：先让用户选一个去处，避免动作被静默丢进「其他」
    const others = cats.filter(x => x.id !== id);
    wx.showActionSheet({
      itemList: others.map(x => '「' + c.name + '」下 ' + n + ' 个动作移到「' + x.name + '」'),
      success: res => {
        const target = others[res.tapIndex];
        if (!target) return;
        this.drop(id, c.name, cats, target.id);
      }
    });
  },

  drop(id, name, cats, targetId) {
    if (targetId) {
      const all = store.ensureMoves();
      let n = 0;
      all.forEach(m => { if (store.validCat(m.category) === id) { m.category = targetId; n++; } });
      store.saveMoves(all);
      store.saveCats(cats.filter(x => x.id !== id));
      this.reload();
      wx.showToast({ title: '已删除，' + n + ' 个动作已移动', icon: 'none' });
      return;
    }
    store.saveCats(cats.filter(x => x.id !== id));
    this.reload();
    wx.showToast({ title: '已删除「' + name + '」' });
  }
});
