const store = require('../../utils/store');
const { CATS, EXAM_KINDS, LESSON_FORMS } = require('../../utils/const');

Page({
  data: {
    id: '',
    date: '',
    type: 'ice',
    mode: 'self',
    duration: '90',
    durOptions: [60, 90, 120, 150],
    content: '',
    units: 2,
    unitOptions: [1, 2, 3, 4],
    lessonForm: 'one',
    formOptions: [{ k: 'one', n: '一对一' }, { k: 'two', n: '一对二' }, { k: 'multi', n: '一对多' }],
    types: [
      { k: 'ice', e: '⛸️ 上冰' },
      { k: 'land', e: '🏋️ 陆地' }
    ],
    modes: [
      { k: 'self', e: '🤸 自己训练' },
      { k: 'lesson', e: '📖 上课' }
    ],
    movesList: [],
    viewMoves: [],
    moveQuery: '',
    recentOnly: false,
    selMoveIds: [],
    selDrillIds: [],
    examList: [],
    selExamIds: [],
    selOrder: [],
    orderRows: [],
    orderAreaH: 0,
    ORDER_ROW_H: 46
  },

  onLoad(q) {
    const id = q.id || '';
    let rec = null;
    if (id) rec = store.loadRecords().find(r => r.id === id);
    this.setData({
      id: id,
      date: rec ? rec.date : (q.date || store.todayKey()),
      type: rec ? rec.type : 'ice',
      mode: rec ? rec.mode : 'self',
      duration: String(rec ? rec.duration : 90),
      durOptions: (function (dv) { const base = [60, 90, 120, 150]; if (dv && base.indexOf(Number(dv)) < 0) base.push(Number(dv)); return base.sort(function (a, b) { return a - b; }); })(rec ? rec.duration : 90),
      content: rec ? rec.content : '',
      units: rec ? (Number(rec.units) || 2) : 2,
      lessonForm: rec ? (rec.lessonForm || 'one') : ((store.load(store.KEYS.meta) || {}).lastLessonForm || 'one')
    });
    if (rec && rec.type === 'rehab') {
      const t = this.data.types.slice();
      if (!t.some(x => x.k === 'rehab')) t.push({ k: 'rehab', e: '💪 康复（旧）' });
      this.setData({ types: t });
    }
    if (this.data.mode === 'lesson') this.syncLessonDuration();
    this.initMoves(rec);
    this.initExams(rec);
    if (id) wx.setNavigationBarTitle({ title: '编辑训练' });
  },

  initMoves(rec) {
    const lib = store.ensureMoves();
    const selMoves = (rec && Array.isArray(rec.moves)) ? rec.moves : [];
    const selDrills = (rec && Array.isArray(rec.drills)) ? rec.drills : [];
    const movesList = lib.map(m => ({
      id: m.id,
      name: m.name,
      catName: CATS[m.category] ? CATS[m.category].name : '其他',
      checked: selMoves.indexOf(m.id) > -1,
      drills: (m.drills || []).slice()
        .sort((a, b) => (Number(b.c) || 0) - (Number(a.c) || 0))
        .map(d => ({
          id: d.id, name: d.name, detail: d.detail || '',
          checked: selDrills.indexOf(d.id) > -1
        }))
    }));
    // 统计最近使用（按历史记录里每次用到的日期）
    const lastUse = {}, lastUseDrill = {};
    const cut = store.dateKey(new Date(Date.now() - 60 * 86400000));
    store.loadRecords().forEach(r => {
      (r.moves || []).forEach(id => { if (!lastUse[id] || r.date > lastUse[id]) lastUse[id] = r.date; });
      (r.drills || []).forEach(id => { if (!lastUseDrill[id] || r.date > lastUseDrill[id]) lastUseDrill[id] = r.date; });
    });
    movesList.forEach(m => {
      m.lastUse = lastUse[m.id] || '';
      m.recent = !!m.lastUse && m.lastUse >= cut;
    });
    this.setData({ movesList: movesList, selMoveIds: selMoves, selDrillIds: selDrills }, () => this.refreshMoves());
  },
  // 搜索 / 最近使用 → 生成展示用列表
  refreshMoves() {
    const q = String(this.data.moveQuery || '').trim().toLowerCase();
    const recent = !!this.data.recentOnly;
    let list = this.data.movesList.filter(m => {
      if (recent && !m.recent) return false;
      if (!q) return true;
      if (String(m.name).toLowerCase().indexOf(q) > -1) return true;
      return (m.drills || []).some(d => String(d.name).toLowerCase().indexOf(q) > -1);
    });
    if (recent || q) {
      list = list.slice().sort((a, b) => String(b.lastUse || '').localeCompare(String(a.lastUse || '')));
    }
    this.setData({ viewMoves: list });
  },
  onMoveQuery(e) { this.setData({ moveQuery: e.detail.value }, () => this.refreshMoves()); },
  clearMoveQuery() { this.setData({ moveQuery: '' }, () => this.refreshMoves()); },
  toggleRecent() { this.setData({ recentOnly: !this.data.recentOnly }, () => this.refreshMoves()); },

  toggleMove(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.movesList.map(m =>
      m.id === id ? Object.assign({}, m, { checked: !m.checked }) : m
    );
    const selMoveIds = list.filter(m => m.checked).map(m => m.id);
    // 未被勾选动作下的组合也一并清除
    const selDrillIds = this.data.selDrillIds.filter(did =>
      list.some(m => m.checked && m.drills.some(d => d.id === did))
    );
    this.setData({ movesList: list, selMoveIds: selMoveIds, selDrillIds: selDrillIds }, () => { this.refreshMoves(); this.syncContent(); });
  },

  toggleDrill(e) {
    const mid = e.currentTarget.dataset.mid;
    const did = e.currentTarget.dataset.did;
    const list = this.data.movesList.map(m => {
      if (m.id !== mid) return m;
      return Object.assign({}, m, {
        drills: m.drills.map(d => d.id === did ? Object.assign({}, d, { checked: !d.checked }) : d)
      });
    });
    const selDrillIds = [];
    list.forEach(m => { if (m.checked) m.drills.forEach(d => { if (d.checked) selDrillIds.push(d.id); }); });
    this.setData({ movesList: list, selDrillIds: selDrillIds }, () => { this.refreshMoves(); this.syncContent(); });
  },

  // 初始化「考级备考」勾选（只到「级别 + 类型」粒度）
  initExams(rec) {
    const exams = store.ensureExams();
    const picked = (rec && Array.isArray(rec.examPicks)) ? rec.examPicks : [];
    // 按「类型 + 级别」去重：优先内置考纲那条，其次内容更多的
    const best = {};
    exams.forEach(ex => {
      const label = ((EXAM_KINDS[ex.kind] || {}).name || '') + ' · ' + ex.level;
      const score = (ex.key ? 1000 : 0) + (ex.myItems || []).length + Object.keys(ex.itemExtra || {}).length;
      if (!best[label] || score > best[label].score) best[label] = { label: label, ex: ex, score: score };
    });
    const chosen = Object.keys(best).map(k => best[k]);
    const examList = chosen.map(b => ({
      id: b.ex.id,
      label: b.label,
      // 若之前勾选的是同类同级的另一条，也视为已勾选
      checked: exams.some(x => (x.kind === b.ex.kind && x.level === b.ex.level) && picked.indexOf(x.id) > -1)
    }));
    const ids = examList.filter(x => x.checked).map(x => x.id);
    this.setData({ examList: examList, selExamIds: ids, selOrder: (rec && Array.isArray(rec.itemOrder)) ? rec.itemOrder.slice() : [] }, () => { if (rec) this.seedGenLines(); else this.syncContent(); });
  },

  toggleExam(e) {
    const id = e.currentTarget.dataset.id;
    const examList = this.data.examList.map(x => x.id === id ? Object.assign({}, x, { checked: !x.checked }) : x);
    const ids = examList.filter(x => x.checked).map(x => x.id);
    this.setData({ examList: examList, selExamIds: ids }, () => { this.refreshMoves(); this.syncContent(); });
  },

  // 由当前勾选生成的行（按你调整的顺序）
  buildGenLines() {
    const items = this.buildLineItems();
    const order = this.data.selOrder || [];
    const map = {}; items.forEach(i => { map[i.key] = i; });
    const out = [];
    order.forEach(k => { if (map[k]) out.push('· ' + map[k].label); });
    items.forEach(i => { if (order.indexOf(i.key) < 0) out.push('· ' + i.label); });
    return out;
  },
  // 打开旧记录：识别文本里已有的“生成行”，便于以后取消勾选时删除
  seedGenLines() {
    this.reorderSelection();
    const gen = this.buildGenLines();
    const content = String(this.data.content || '');
    this._genLines = gen.filter(l => content.indexOf(l) > -1);
  },
  // 增量更新训练笔记：只增删“生成行”，保留你手写的所有文字
  syncContent() {
    this.reorderSelection();
    const newGen = this.buildGenLines();
    const raw = String(this.data.content || '');
    const old = raw.length ? raw.split('\n') : [];   // 空内容不要产生 [''] 这个假行
    const oldSet = {};
    (this._genLines || []).forEach(l => { oldSet[l] = true; });
    const kept = [];
    let insertAt = -1;
    old.forEach(l => {
      if (oldSet[l]) { if (insertAt < 0) insertAt = kept.length; return; }
      kept.push(l);
    });
    if (insertAt < 0) insertAt = kept.length;
    const out = kept.slice(0, insertAt).concat(newGen).concat(kept.slice(insertAt));
    this._genLines = newGen;
    // 去掉开头的空行（历史遗留），内部空行保留
    const text = out.join('\n').replace(/^(\s*\n)+/, '');
    this.setData({ content: text });
  },

  // 当前勾选项 → [{key, label}]（key: m:<动作id> / e:<考级id>）
  buildLineItems() {
    const items = [];
    this.data.movesList.forEach(m => {
      if (!m.checked) return;
      const dnames = m.drills.filter(d => d.checked).map(d => d.name);
      items.push({ key: 'm:' + m.id, label: dnames.length ? (m.name + '：' + dnames.join('、')) : m.name });
    });
    this.data.examList.forEach(ex => { if (ex.checked) items.push({ key: 'e:' + ex.id, label: '【' + ex.label + '】' }); });
    return items;
  },
  // 维护显示顺序：已在顺序里的保持位置，新勾选的追加到末尾
  reorderSelection() {
    const items = this.buildLineItems();
    const keys = items.map(i => i.key);
    const order = (this.data.selOrder || []).filter(k => keys.indexOf(k) > -1);
    keys.forEach(k => { if (order.indexOf(k) < 0) order.push(k); });
    const map = {}; items.forEach(i => { map[i.key] = i; });
    const H = this.data.ORDER_ROW_H;
    const orderRows = order.map((k, i) => ({ key: k, label: map[k] ? map[k].label : '', y: i * H }));
    this._order = order;
    this.setData({ selOrder: order, orderRows: orderRows, orderAreaH: Math.max(1, order.length) * H });
  },
  // 打开旧记录：把原先自动生成的条目行从文本里去掉（它们现在显示为可拖动行）



  onDragOrder(e) {
    const key = e.currentTarget.dataset.key;
    const H = this.data.ORDER_ROW_H;
    const list = (this.data.selOrder || []).slice();
    const cur = list.indexOf(key);
    if (cur < 0) return;
    const target = Math.max(0, Math.min(list.length - 1, Math.round(e.detail.y / H)));
    if (target === cur) return;
    list.splice(cur, 1);
    list.splice(target, 0, key);
    this._order = list;
    this.setData({ selOrder: list }, () => { this.refreshMoves(); this.syncContent(); });
  },
  // 初始化时：把内容里“看起来是勾选生成”的行认出来，便于以后取消勾选时删除
  // 增量更新：只增删生成行，保留用户手写的要点/备注

  setType(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ type: k, mode: k === 'ice' ? this.data.mode : 'lesson' });
  },
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.k });
  },
  setLessonForm(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ lessonForm: k });
    // 记住这次选择，下次新建默认用它
    const meta = store.load(store.KEYS.meta) || {};
    meta.lastLessonForm = k;
    store.save(store.KEYS.meta, meta);
  },

  setDuration(e) { this.setData({ duration: String(Number(e.currentTarget.dataset.v) || 90) }); },
  setUnits(e) {
    const u = Number(e.currentTarget.dataset.v) || 1;
    this.setData({ units: u });
    this.syncLessonDuration();
  },
  // 上课：时长 = 节数 × 30 分钟
  syncLessonDuration() {
    if (this.data.mode !== 'lesson') return;
    const u = Number(this.data.units) || 1;
    this.setData({ duration: String(u * 30) });
  },

  setDate(e) {
    this.setData({ date: e.detail.value });
  },
  input(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  save() {
    const { id, date, type, mode, duration, content, units, lessonForm } = this.data;
    if (!date) { wx.showToast({ title: '请选择日期', icon: 'none' }); return; }
    const rec = {
      id: id || store.uid(),
      date, type, mode,
      duration: Number(duration) || 0,
      units: mode === 'lesson' ? (Number(units) || 2) : 1,
      lessonForm: mode === 'lesson' ? (lessonForm || 'one') : '',
      content,
      notes: '',
      lessonSummary: '',
      status: store.statusOf({ date }),
      moves: this.data.selMoveIds,
      drills: this.data.selDrillIds,
      examPicks: this.data.selExamIds,
      itemOrder: this.data.selOrder
    };
    let records = store.loadRecords();
    const i = records.findIndex(r => r.id === rec.id);
    if (i > -1) records[i] = Object.assign({}, records[i], rec);
    else records.push(rec);
    store.saveRecords(records);
    wx.showToast({ title: '已保存' });
    setTimeout(() => wx.navigateBack(), 300);
  },

  del() {
    if (!this.data.id) return;
    wx.showModal({
      title: '删除',
      content: '确定删除这条训练？',
      success: r => {
        if (!r.confirm) return;
        store.saveRecords(store.loadRecords().filter(x => x.id !== this.data.id));
        wx.showToast({ title: '已删除' });
        setTimeout(() => wx.navigateBack(), 300);
      }
    });
  }
});
