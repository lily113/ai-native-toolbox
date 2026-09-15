const store = require('../../utils/store');
const { EXAM_KINDS } = require('../../utils/const');
const util = require('../../utils/util');

Page({
  data: {
    id: '',
    key: '',
    level: '',
    kindName: '',
    date: '',
    cdText: '',
    note: '',
    sections: [],

    itemOn: false,
    itemMode: 'user',       // 'user' = 可完全编辑；'builtin' = 只读考纲 + 只编辑“我的”
    itemId: '',
    itemSecKey: '',
    item: { title: '', points: [], mistakes: [], note: '', moveId: '', moveName: '', moveIndex: 0, myPoints: [], myMistakes: [], myNote: '' },
    builtinTitle: '',
    builtinPoints: [],
    builtinMistakes: [],

    moveNames: [], moveIds: [],
    imgErrMsg: '',
    batchOn: false, batchSecKey: '', batchText: ''
  },

  onLoad(q) { this.setData({ id: q.id || '' }); },
  onShow() { this.reload(); },

  overlay() { return store.ensureExams().filter(e => e && e.id === this.data.id)[0] || null; },
  saveOverlay(mut) {
    const arr = store.ensureExams();
    const i = arr.findIndex(e => e && e.id === this.data.id);
    if (i < 0) return;
    arr[i] = mut(arr[i]);
    store.saveExams(arr);
  },

  reload() {
    const ov = this.overlay();
    if (!ov) { wx.showToast({ title: '考级不存在', icon: 'none' }); setTimeout(() => wx.navigateBack(), 400); return; }
    const sy = ov.key ? store.syllabusByKey(ov.key) : null;
    const used = {};
    const sections = [];

    // 用户条目按 sectionKey 归组
    (ov.myItems || []).forEach(it => {
      const k = it.sectionKey || '';
      used[k] = used[k] || [];
      const mv = it.moveId ? store.moveById(it.moveId) : null;
      used[k].push({
        id: it.id, builtin: false, title: it.title || '',
        points: it.points || [], mistakes: it.mistakes || [],
        note: it.note || '', moveName: mv ? mv.name : '',
        myPoints: [], myMistakes: [], myNote: ''
      });
    });

    // 内置考纲分节（只读）
    if (sy) {
      sy.sections.forEach(s => {
        const items = (s.items || []).map(it => {
          const my = (ov.itemExtra || {})[it.key] || {};
          const myMv = my.moveId ? store.moveById(my.moveId) : null;
          return {
            id: it.key, builtin: true, title: it.title,
            points: it.points || [], mistakes: it.mistakes || [],
            myPoints: my.points || [], myMistakes: my.mistakes || [], myNote: my.note || '',
            moveId: my.moveId || '', moveName: myMv ? myMv.name : ''
          };
        });
        (used[s.key] || []).forEach(x => items.push(x));
        const imgs = s.images || [];
        const defOpen = (s.key === 'pattern' || s.key === 'my-points');
        sections.push({
          id: s.key, name: s.name, builtin: true, images: imgs, userAdd: s.userAdd === true, items: items,
          open: (this._openMap && this._openMap[s.key] !== undefined) ? this._openMap[s.key] : defOpen
        });
      });
    }
    // 用户自建分节
    (ov.mySections || []).forEach(s => {
      sections.push({
        id: s.id, name: s.name, builtin: false, userAdd: true, items: used[s.id] || [],
        open: (this._openMap && this._openMap[s.id] !== undefined) ? this._openMap[s.id] : true
      });
    });

    // 兜底：sectionKey 找不到对应分节的条目（孤儿），放进一个可编辑分节，避免“看不见”
    const consumed = {};
    sections.forEach(s => { consumed[s.id] = true; });
    const orphans = [];
    Object.keys(used).forEach(k => {
      if (k === '' || !consumed[k]) used[k].forEach(x => orphans.push(x));
    });
    if (orphans.length) {
      let host = sections.filter(s => s.userAdd)[0];
      if (!host) {
        host = { id: '__orphan__', name: '未归类（原分节已不存在）', builtin: false, userAdd: true, items: [] };
        sections.push(host);
      }
      orphans.forEach(x => host.items.push(x));
    }

    const moves = store.ensureMoves();
    this.setData({
      key: ov.key || '',
      level: ov.level,
      kindName: EXAM_KINDS[ov.kind] ? EXAM_KINDS[ov.kind].name : '',
      date: ov.date || '',
      cdText: util.countdownText(ov.date),
      note: ov.note || '',
      sections: sections,
      moveNames: ['（不关联）'].concat(moves.map(m => m.name)),
      moveIds: [''].concat(moves.map(m => m.id))
    });
  },

  // ---------- 内置图案图片 ----------
  previewBuiltin(e) {
    const src = e.currentTarget.dataset.src;
    wx.getImageInfo({
      src: src,
      success: r => wx.previewImage({ urls: [r.path] }),
      fail: () => wx.showToast({ title: '内置图未放置（见 packageExam/images/）', icon: 'none' })
    });
  },
  imgErr() {
    this.setData({ imgErrMsg: '内置步法图未放置：请把该级别的图案保存到 packageExam/images/ 并在考纲里引用' });
  },
  imgOk() { if (this.data.imgErrMsg) this.setData({ imgErrMsg: '' }); },

  // ---------- 分节（仅用户自建的可改名/移动/删除） ----------
  addSection() {
    wx.showModal({
      title: '新分节', editable: true, placeholderText: '如：我的重点 / 易错汇总…',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        this.saveOverlay(e => { e.mySections = (e.mySections || []).concat([{ id: store.uid(), name: name }]); return e; });
        this.reload();
      }
    });
  },
  toggleSec(e) {
    const id = e.currentTarget.dataset.id;
    this._openMap = this._openMap || {};
    const cur = this.data.sections.filter(x => x.id === id)[0];
    const nextOpen = cur ? !cur.open : true;
    this._openMap[id] = nextOpen;
    const sections = this.data.sections.map(x => x.id === id ? Object.assign({}, x, { open: nextOpen }) : x);
    this.setData({ sections: sections });
  },

  secMenu(e) {
    const sid = e.currentTarget.dataset.id;
    const ov = this.overlay();
    const sec = (ov.mySections || []).filter(s => s.id === sid)[0];
    if (!sec) return;
    wx.showActionSheet({
      itemList: ['重命名', '上移', '下移', '删除分节'],
      success: r => {
        if (r.tapIndex === 0) {
          wx.showModal({
            title: '重命名', editable: true, content: sec.name,
            success: m => {
              if (!m.confirm) return;
              const name = (m.content || '').trim(); if (!name) return;
              this.saveOverlay(ex => { (ex.mySections || []).forEach(s => { if (s.id === sid) s.name = name; }); return ex; });
              this.reload();
            }
          });
        } else if (r.tapIndex === 1 || r.tapIndex === 2) {
          const dir = r.tapIndex === 1 ? -1 : 1;
          this.saveOverlay(ex => {
            const list = ex.mySections || [];
            const i = list.findIndex(s => s.id === sid), j = i + dir;
            if (i < 0 || j < 0 || j >= list.length) return ex;
            const t = list[i]; list[i] = list[j]; list[j] = t;
            return ex;
          });
          this.reload();
        } else {
          wx.showModal({
            title: '删除分节', content: '会同时删除该分节下你添加的条目，确定？', confirmColor: '#dc2626',
            success: m => {
              if (!m.confirm) return;
              this.saveOverlay(ex => {
                ex.mySections = (ex.mySections || []).filter(s => s.id !== sid);
                ex.myItems = (ex.myItems || []).filter(it => it.sectionKey !== sid);
                return ex;
              });
              this.reload();
            }
          });
        }
      }
    });
  },

  // ---------- 条目 ----------
  addItem(e) {
    const sk = e.currentTarget.dataset.sid;
    this.setData({
      itemOn: true, itemMode: 'user', itemId: '', itemSecKey: sk,
      item: { title: '', points: [], mistakes: [], note: '', moveId: '', moveName: '', moveIndex: 0, myPoints: [], myMistakes: [], myNote: '' },
      builtinTitle: '', builtinPoints: [], builtinMistakes: []
    });
  },
  openItem(e) {
    const sid = e.currentTarget.dataset.sid, iid = e.currentTarget.dataset.iid;
    const ov = this.overlay();
    if (e.currentTarget.dataset.builtin) {
      const sy = store.syllabusByKey(ov.key);
      let found = null;
      if (sy) sy.sections.forEach(s => (s.items || []).forEach(it => { if (it.key === iid) found = it; }));
      if (!found) return;
      const my = (ov.itemExtra || {})[iid] || {};
      this.setData({
        itemOn: true, itemMode: 'builtin', itemId: iid, itemSecKey: sid,
        builtinTitle: found.title, builtinPoints: found.points || [], builtinMistakes: found.mistakes || [],
        item: {
          title: found.title, points: [], mistakes: [], note: '',
          moveId: my.moveId || '',
          moveName: (my.moveId && store.moveById(my.moveId)) ? store.moveById(my.moveId).name : '',
          moveIndex: Math.max(0, this.data.moveIds.indexOf(my.moveId || '')),
          myPoints: (my.points || []).slice(), myMistakes: (my.mistakes || []).slice(), myNote: my.note || ''
        }
      });
      return;
    }
    const it = (ov.myItems || []).filter(x => x.id === iid)[0];
    if (!it) return;
    const mvName = it.moveId && store.moveById(it.moveId) ? store.moveById(it.moveId).name : '';
    this.setData({
      itemOn: true, itemMode: 'user', itemId: iid, itemSecKey: it.sectionKey || sid,
      builtinTitle: '', builtinPoints: [], builtinMistakes: [],
      item: {
        title: it.title || '', points: (it.points || []).slice(), mistakes: (it.mistakes || []).slice(),
        note: it.note || '', moveId: it.moveId || '', moveName: mvName,
        moveIndex: Math.max(0, this.data.moveIds.indexOf(it.moveId || '')),
        myPoints: [], myMistakes: [], myNote: ''
      }
    });
  },
  closeItem() { this.setData({ itemOn: false }); },

  // ---------- 批量粘贴要点 ----------
  openBatch(e) {
    this.setData({ batchOn: true, batchSecKey: e.currentTarget.dataset.sid, batchText: '' });
  },
  onBatchInput(e) { this.setData({ batchText: e.detail.value }); },
  closeBatch() { this.setData({ batchOn: false }); },
  saveBatch() {
    const raw = String(this.data.batchText || '').replace(/\r/g, '');
    const lines = raw.split('\n').map(x => x.trim()).filter(x => x.length);
    if (!lines.length) { wx.showToast({ title: '还没有内容', icon: 'none' }); return; }
    const items = [];
    let cur = null;
    lines.forEach(l => {
      const isPoint = /^([-·•*]|·|－)/.test(l);
      const text = isPoint ? l.replace(/^([-·•*－]+)\s*/, '') : l;
      if (isPoint && cur) { cur.points.push(text); }
      else {
        cur = { id: store.uid(), sectionKey: this.data.batchSecKey, title: text, points: [], mistakes: [], note: '', moveId: '' };
        items.push(cur);
      }
    });
    if (!items.length) { wx.showToast({ title: '没有解析到条目', icon: 'none' }); return; }
    this.saveOverlay(e => { e.myItems = (e.myItems || []).concat(items); return e; });
    this.reload();
    this.setData({ batchOn: false, batchText: '' });
    wx.showToast({ title: '已添加 ' + items.length + ' 条' });
  },
  noop() {},

  onTitle(e) { this.setData({ 'item.title': e.detail.value }); },
  onNote(e) { this.setData({ 'item.note': e.detail.value }); },
  onMyNote(e) { this.setData({ 'item.myNote': e.detail.value }); },
  onPoint(e) { this.setData({ ['item.points[' + e.currentTarget.dataset.i + ']']: e.detail.value }); },
  addPoint() { this.setData({ 'item.points': this.data.item.points.concat(['']) }); },
  delPoint(e) { const a = this.data.item.points.slice(); a.splice(e.currentTarget.dataset.i, 1); this.setData({ 'item.points': a }); },
  onMistake(e) { this.setData({ ['item.mistakes[' + e.currentTarget.dataset.i + ']']: e.detail.value }); },
  addMistake() { this.setData({ 'item.mistakes': this.data.item.mistakes.concat(['']) }); },
  delMistake(e) { const a = this.data.item.mistakes.slice(); a.splice(e.currentTarget.dataset.i, 1); this.setData({ 'item.mistakes': a }); },
  onMyPoint(e) { this.setData({ ['item.myPoints[' + e.currentTarget.dataset.i + ']']: e.detail.value }); },
  addMyPoint() { this.setData({ 'item.myPoints': this.data.item.myPoints.concat(['']) }); },
  delMyPoint(e) { const a = this.data.item.myPoints.slice(); a.splice(e.currentTarget.dataset.i, 1); this.setData({ 'item.myPoints': a }); },
  onMyMistake(e) { this.setData({ ['item.myMistakes[' + e.currentTarget.dataset.i + ']']: e.detail.value }); },
  addMyMistake() { this.setData({ 'item.myMistakes': this.data.item.myMistakes.concat(['']) }); },
  delMyMistake(e) { const a = this.data.item.myMistakes.slice(); a.splice(e.currentTarget.dataset.i, 1); this.setData({ 'item.myMistakes': a }); },

  onMoveChange(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({
      'item.moveIndex': i,
      'item.moveId': this.data.moveIds[i] || '',
      'item.moveName': i === 0 ? '' : (this.data.moveNames[i] || '')
    });
  },

  saveItem() {
    const it = this.data.item;
    const clean = a => (a || []).map(x => (x || '').trim()).filter(x => x);
    if (this.data.itemMode === 'builtin') {
      this.saveOverlay(e => {
        e.itemExtra = e.itemExtra || {};
        e.itemExtra[this.data.itemId] = {
          points: clean(it.myPoints),
          mistakes: clean(it.myMistakes),
          note: (it.myNote || '').trim(),
          moveId: it.moveId || ''
        };
        return e;
      });
    } else {
      const title = (it.title || '').trim();
      if (!title) { wx.showToast({ title: '标题不能为空', icon: 'none' }); return; }
      const data = {
        title: title, points: clean(it.points), mistakes: clean(it.mistakes),
        note: (it.note || '').trim(), moveId: it.moveId || ''
      };
      this.saveOverlay(e => {
        e.myItems = e.myItems || [];
        if (this.data.itemId) {
          const i = e.myItems.findIndex(x => x.id === this.data.itemId);
          if (i > -1) e.myItems[i] = Object.assign({}, e.myItems[i], data);
        } else {
          e.myItems.push(Object.assign({ id: store.uid(), sectionKey: this.data.itemSecKey }, data));
        }
        return e;
      });
    }
    this.reload();
    this.setData({ itemOn: false });
    wx.showToast({ title: '已保存' });
  },
  delItem() {
    if (this.data.itemMode !== 'user' || !this.data.itemId) return;
    wx.showModal({
      title: '删除条目', content: '确定删除这条笔记？', confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        this.saveOverlay(e => { e.myItems = (e.myItems || []).filter(x => x.id !== this.data.itemId); return e; });
        this.reload();
        this.setData({ itemOn: false });
      }
    });
  },

  // ---------- 顶部 ----------
  setDate(e) {
    const d = e.detail.value;
    this.saveOverlay(ex => { ex.date = d; return ex; });
    this.setData({ date: d, cdText: util.countdownText(d) });
    const cd = util.countdownText(d);
    wx.showModal({
      title: '考级日期已设置',
      content: cd + '\n是否记入纪念日（方便提醒）？',
      confirmText: '记入纪念日',
      cancelText: '暂不',
      success: r => { if (r.confirm) this.toMilestone(true); }
    });
  },
  toMilestone(silent) {
    const ov = this.overlay();
    if (!ov) return;
    if (!ov.date) { wx.showToast({ title: '请先设置考级日期', icon: 'none' }); return; }
    const key = 'exam:' + ov.id;
    const ms = store.ensureMilestones();
    const idx = ms.findIndex(m => m && m.key === key);
    const data = {
      key: key, type: 'exam', date: ov.date,
      title: this.data.kindName + ' · ' + ov.level,
      note: util.countdownText(ov.date)
    };
    if (idx > -1) {
      ms[idx] = Object.assign({}, ms[idx], data);
      store.saveMilestones(ms);
      wx.showToast({ title: '纪念日已更新' });
    } else {
      ms.push(Object.assign({ id: store.uid() }, data));
      store.saveMilestones(ms);
      wx.showToast({ title: '已记入纪念日' });
    }
  },
  copyMyMistakes() {
    const lines = [this.data.kindName + ' · ' + this.data.level + '（我的要点 / 易错）'];
    let n = 0;
    this.data.sections.forEach(sec => {
      const body = [];
      (sec.items || []).forEach(it => {
        const myPts = (it.myPoints || []).slice();
        const myMks = (it.myMistakes || []).slice();
        const myNote = it.myNote || '';
        // 自建条目：全部内容都属于“我的”
        const ownPts = it.builtin ? [] : (it.points || []);
        const ownMks = it.builtin ? [] : (it.mistakes || []);
        const ownNote = it.builtin ? '' : (it.note || '');
        const pts = myPts.concat(ownPts);
        const mks = myMks.concat(ownMks);
        const note = myNote || ownNote;
        if (!pts.length && !mks.length && !note) return;
        n++;
        body.push(it.title);
        pts.forEach(p => body.push('  · ' + p));
        mks.forEach(m => body.push('  ✗ ' + m));
        if (note) body.push('  📝 ' + note);
      });
      if (body.length) { lines.push('\n【' + sec.name + '】'); body.forEach(x => lines.push(x)); }
    });
    if (!n) { wx.showToast({ title: '还没有「我的要点 / 易错」', icon: 'none' }); return; }
    wx.setClipboardData({ data: lines.join('\n') });
    wx.showToast({ title: '已复制我的要点 / 易错' });
  }
});
