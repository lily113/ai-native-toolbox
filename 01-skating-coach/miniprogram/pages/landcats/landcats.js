const store = require('../../utils/store');

Page({
  data: { list: [], total: 0, used: 0, isPreset: true },

  onShow() { this.reload(); },

  reload() {
    const st = store.landStats(store.loadRecords());
    const cnt = {};
    st.list.forEach(x => { cnt[x.id] = x.n; });
    const cats = store.landCats();
    const presetIds = store.LAND_CATS.map(c => c.id).join(',');
    const list = cats.map((c, i) => ({
      id: c.id,
      name: c.name,
      n: cnt[c.id] || 0,
      first: i === 0,
      last: i === cats.length - 1
    }));
    // 判"还是不是原样"：条数一样 + 每项 id 和名字都对得上
    const isPreset = cats.length === store.LAND_CATS.length && cats.every((c, i) =>
      c.id === store.LAND_CATS[i].id && c.name === store.LAND_CATS[i].name);
    this.setData({
      list: list,
      total: st.total,
      used: st.total - st.uncategorized,
      isPreset: isPreset,
      presetIds: presetIds
    });
  },

  // 改名（id 不变，历史记录一条都不动）
  rename(e) {
    const id = e.currentTarget.dataset.id;
    const cats = store.landCats();
    const c = cats.filter(x => x.id === id)[0];
    if (!c) return;
    wx.showModal({
      title: '重命名',
      editable: true,
      content: c.name,
      placeholderText: '内容名称',
      success: r => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (name.length > 8) { wx.showToast({ title: '名称请控制在 8 字内', icon: 'none' }); return; }
        if (cats.some(x => x.id !== id && x.name === name)) { wx.showToast({ title: '已有同名', icon: 'none' }); return; }
        cats.forEach(x => { if (x.id === id) x.name = name; });
        store.saveLandCats(cats);
        this.reload();
        wx.showToast({ title: '已保存' });
      }
    });
  },

  add() {
    const cats = store.landCats();
    if (cats.length >= 16) { wx.showToast({ title: '最多 16 项，先删几个', icon: 'none' }); return; }
    wx.showModal({
      title: '新增内容',
      editable: true,
      placeholderText: '如：现代舞 / 体能 / 冰上形体',
      success: r => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (name.length > 8) { wx.showToast({ title: '名称请控制在 8 字内', icon: 'none' }); return; }
        if (cats.some(x => x.name === name)) { wx.showToast({ title: '已有同名', icon: 'none' }); return; }
        const id = 'l' + store.uid().slice(0, 7);
        cats.push({ id: id, name: name });
        store.saveLandCats(cats);
        // 万一这个 id 以前被删过、名字还留着，清掉旧的墓碑
        store.forgetLandCatsGone([id]);
        this.reload();
        wx.showToast({ title: '已添加' });
      }
    });
  },

  up(e) { this.move(e.currentTarget.dataset.id, -1); },
  down(e) { this.move(e.currentTarget.dataset.id, 1); },
  move(id, dir) {
    const cats = store.landCats();
    const i = cats.findIndex(x => x.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    const t = cats[i]; cats[i] = cats[j]; cats[j] = t;
    store.saveLandCats(cats);
    this.reload();
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    const cats = store.landCats();
    const c = cats.filter(x => x.id === id)[0];
    if (!c) return;
    const n = store.landCatUsage(id);
    if (!n) {
      wx.showModal({
        title: '删除内容',
        content: '确定删除「' + c.name + '」？还没有记录用过它。',
        confirmText: '删除',
        confirmColor: '#dc2626',
        success: r => { if (r.confirm) this.drop(c, cats); }
      });
      return;
    }
    // 有记录用过：说清"记录不会少东西"，再确认
    wx.showModal({
      title: '删除内容',
      content: '有 ' + n + ' 条记录用过「' + c.name + '」。删除后它不再出现在选择列表里，'
        + '但那 ' + n + ' 条记录里的这一项会保留、仍然显示名字（记录不会丢内容）。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: r => { if (r.confirm) this.drop(c, cats); }
    });
  },

  drop(c, cats) {
    store.saveLandCats(cats.filter(x => x.id !== c.id));
    store.rememberLandCatGone(c);   // 名字留一份，老记录里还能显示中文
    this.reload();
    wx.showToast({ title: '已删除「' + c.name + '」', icon: 'none' });
  },

  // 改乱了能一键回到预置 8 项（记录里的旧分类不改，只是不再列出来）
  reset() {
    wx.showModal({
      title: '恢复预置',
      content: '把列表恢复成预置的 8 项（芭蕾 / 基训 / 身韵 / 剧目 / 软开 / 跳转翻/毯功 / 陆地模拟 / 力量/康复）？'
        + '已记训练记录一条都不会变，只是列表回到初始样子。',
      confirmText: '恢复',
      success: r => {
        if (!r.confirm) return;
        store.saveLandCats(store.LAND_CATS);
        this.reload();
        wx.showToast({ title: '已恢复预置' });
      }
    });
  }
});
