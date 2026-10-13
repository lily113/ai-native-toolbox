const store = require('../../utils/store');
const { TYPES, MODES } = require('../../utils/const');

// 搜历史记录：动作名 / 组合名 / 考级级别 / 陆地内容 / 教练 / 笔记正文
//   record 多了以后（500+ 条）光靠翻日历找不到"上次练这个是什么时候"
Page({
  data: { kw: '', results: [], summary: null, searched: false, total: 0 },

  onInput(e) {
    this.setData({ kw: e.detail.value }, () => this.doSearch());
  },

  clear() {
    this.setData({ kw: '', results: [], summary: null, searched: false, total: 0 });
  },

  doSearch() {
    const kw = String(this.data.kw || '').trim();
    if (!kw) { this.setData({ results: [], summary: null, searched: false, total: 0 }); return; }
    const q = kw.toLowerCase();

    const hits = store.searchRecords(kw).map(r => {
      const t = TYPES[r.type] || {}, m = MODES[r.mode] || {};
      return {
        id: r.id, date: r.date,
        typeName: t.name || '', typeEmoji: t.emoji || '',
        modeName: String(m.name || '').replace(/^[^\u4e00-\u9fa5A-Za-z]+/, ''),
        duration: r.duration,
        hitText: r.hits.join('　·　')
      };
    });

    // 关键词命中动作名时，先给一句"练过几次 / 上次什么时候"——这才是最想知道的
    const moves = store.ensureMoves().filter(m => String(m.name).toLowerCase().indexOf(q) > -1);
    let summary = null;
    if (moves.length === 1) {
      const u = store.moveUsage()[moves[0].id] || {};
      summary = {
        name: moves[0].name,
        n: Number(u.n) || 0,
        last: u.last || '',
        days: (u.last && Number.isFinite(Number(u.days))) ? Number(u.days) : -1
      };
    } else if (moves.length > 1) {
      summary = { name: '匹配到 ' + moves.length + ' 个动作', n: 0, last: '', days: -1, multi: true };
    }

    this.setData({ results: hits, summary: summary, searched: true, total: hits.length });
  },

  open(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/record/record?id=' + encodeURIComponent(id) });
  }
});
