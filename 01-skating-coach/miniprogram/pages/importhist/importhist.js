// 导入历史笔记：粘贴几年的笔记 → 按日期切分 → 预览 → 存成「笔记型记录」
// 这些记录 noteOnly: true —— **不进入任何上冰统计**（天数/时长/周目标/趋势/冰感都跳过），
// 只出现在搜索、日历当天列表、以及回顾的"笔记"里。
const store = require('../../utils/store');
const histnote = require('../../utils/histnote');

Page({
  data: {
    raw: '',
    parsed: false,     // 是否已经识别过
    items: [],         // [{date, text, ambiguous, pick, preview}]
    total: 0, pickN: 0, dupN: 0, ambiguous: 0, noDate: '',
    importing: false
  },

  onLoad() {
    // 记录一下"现有多少条"，导入后好算新增了几条
    this.setData({ beforeN: (store.loadRecords() || []).length });
  },

  onInput(e) {
    // 改了文本就不再显示旧的识别结果，避免"看到的是上一次的"
    this.setData({ raw: e.detail.value, parsed: false, items: [] });
  },

  parse() {
    const raw = String(this.data.raw || '');
    if (!raw.trim()) { wx.showToast({ title: '先粘贴点内容', icon: 'none' }); return; }
    const recs = store.loadRecords() || [];
    const pv = histnote.preview(raw, recs);
    if (!pv.items.length) {
      this.setData({ parsed: true, items: [], total: 0, pickN: 0, dupN: 0, ambiguous: 0, noDate: pv.noDate });
      return;
    }
    const items = pv.items.map(it => {
      const dup = pv.dup.some(d => d.date === it.date && d.text === it.text);
      return {
        date: it.date,
        text: it.text,
        ambiguous: !!it.ambiguous,
        dup: dup,
        pick: !dup,     // 重复的默认不勾（但可以手动勾上）
        preview: it.text.replace(/\n+/g, ' ／ ').slice(0, 60)
      };
    });
    this.setData({
      parsed: true, items: items,
      total: items.length, dupN: pv.dup.length, ambiguous: pv.ambiguous,
      noDate: pv.noDate,
      pickN: items.filter(x => x.pick).length
    });
  },

  toggle(e) {
    const i = Number(e.currentTarget.dataset.i);
    const items = this.data.items.slice();
    if (!items[i]) return;
    items[i] = Object.assign({}, items[i], { pick: !items[i].pick });
    this.setData({ items: items, pickN: items.filter(x => x.pick).length });
  },

  allOn() {
    const items = this.data.items.map(x => Object.assign({}, x, { pick: true }));
    this.setData({ items: items, pickN: items.length });
  },
  allOff() {
    const items = this.data.items.map(x => Object.assign({}, x, { pick: false }));
    this.setData({ items: items, pickN: 0 });
  },

  confirm() {
    if (this.data.importing) return;
    const picked = this.data.items.filter(x => x.pick);
    if (!picked.length) { wx.showToast({ title: '没有勾选任何一条', icon: 'none' }); return; }
    const recs = store.loadRecords() || [];
    const have = {};
    recs.forEach(r => { if (r && r.id) have[r.id] = 1; });
    const add = [];
    picked.forEach(it => {
      const rec = histnote.toRecord(it);
      if (have[rec.id]) return;      // 幂等：同日期 + 同文字不会重复进来
      have[rec.id] = 1;
      add.push(rec);
    });
    if (!add.length) { wx.showToast({ title: '这些都导过了', icon: 'none' }); return; }
    this.setData({ importing: true });
    store.saveRecords(add.concat(recs));
    const n = add.length;
    this.setData({ importing: false, raw: '', parsed: false, items: [], total: 0, pickN: 0 });
    wx.showModal({
      title: '导入完成',
      content: '新增了 ' + n + ' 条历史笔记。\n\n它们不计入上冰天数/时长/周目标，只会在搜索和日历当天里出现。',
      showCancel: false,
      confirmText: '好'
    });
  }
});
