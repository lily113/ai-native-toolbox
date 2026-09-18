const store = require('../../utils/store');

const GHEAD = 'g#';   // 分组标题行的键前缀（仅用于界面，不参与排序）

// 某个排序键是否属于分组 g（组合键为 m:<moveId>::d:<drillId>；无组合动作为 m:<moveId>；考级为 e:<id>）
function inGroupOf(k, g) {
  return k === g || k.indexOf(g + '::d:') === 0;
}

// ---------- 时间工具（几点到几点 ⇄ 时长 联动） ----------
function toMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) : -1;
}
function fmtMin(m) {
  let x = ((m % 1440) + 1440) % 1440;
  return ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + (x % 60)).slice(-2);
}
function diffMin(a, b) {           // b - a，跨零点按 +24h 处理
  const x = toMin(a), y = toMin(b);
  if (x < 0 || y < 0) return 0;
  let d = y - x;
  if (d <= 0) d += 1440;
  return d;
}
// 训练时间：08:00 – 22:00，分钟按 15 分钟一档（也支持手工输入任意时间，如 15:08）
const TIME_FROM_H = 7, TIME_TO_H = 23;              // 滚轮范围 07:00 – 23:00
const TIME_MINUTES = ['00', '15', '30', '45'];
const TIME_HOURS = (() => { const a = []; for (let h = TIME_FROM_H; h <= TIME_TO_H; h++) a.push(('0' + h).slice(-2)); return a; })();
const LAST_HOUR = TIME_HOURS.length - 1;            // 最后一档：只有 :00（作为上限）
const TIME_FROM = TIME_FROM_H * 60, TIME_TO = TIME_TO_H * 60;

function slotToTime(hi, mi) {
  const h = TIME_HOURS[Math.max(0, Math.min(LAST_HOUR, hi))];
  const mins = h === TIME_HOURS[LAST_HOUR] ? ['00'] : TIME_MINUTES;
  return h + ':' + (mins[Math.max(0, Math.min(mins.length - 1, mi))] || '00');
}
function timeToSlots(t) {                    // 时间 → 双列下标（旧数据/手输值也定位得对）
  const m = toMin(t);
  if (m < 0) return [0, 0];
  if (m <= TIME_FROM) return [0, 0];                 // 早于下限 → 贴到首档
  if (m >= TIME_TO) return [LAST_HOUR, 0];           // 晚于上限 → 贴到末档
  const h = Math.floor(m / 60);
  const mi = Math.max(0, Math.min(3, Math.round((m % 60) / 15)));
  return [h - TIME_FROM_H, mi];
}
function normTime(str) {                     // 校验并规范成 HH:MM；非法返回 ''
  const m = String(str || '').trim().match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!m) return '';
  const h = Number(m[1]), mi = Number(m[2]);
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return '';
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}

function lenText(mins) {
  return '共 ' + Math.floor(mins / 60) + ' 小时' + (mins % 60 ? ' ' + (mins % 60) + ' 分' : '') + '（' + mins + ' 分钟）';
}

const { CATS, EXAM_KINDS, LESSON_FORMS } = require('../../utils/const');

Page({
  data: {
    id: '',
    date: '',
    type: 'ice',
    mode: 'self',
    duration: '90',
    durOptions: [60, 90, 120, 150],
    timeStart: '',
    timeEnd: '',
    timeHint: '',
    startRange: [TIME_HOURS, TIME_MINUTES],
    endRange: [TIME_HOURS, TIME_MINUTES],
    startIdx: [0, 0],
    endIdx: [0, 0],
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
    collapsed: {}
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
      timeStart: (rec && rec.time ? String(rec.time).split('-')[0] : '') || '',
      timeEnd: (rec && rec.time ? String(rec.time).split('-')[1] : '') || '',
      startIdx: timeToSlots((rec && rec.time ? String(rec.time).split('-')[0] : '') || ''),
      endIdx: timeToSlots((rec && rec.time ? String(rec.time).split('-')[1] : '') || ''),
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
    const keys = order.filter(k => map[k]).concat(items.map(i => i.key).filter(k => order.indexOf(k) < 0));
    const out = [], done = {};
    keys.forEach(k => {
      const it = map[k];
      if (!it || done[it.group]) return;
      done[it.group] = true;
      const sibs = keys.map(x => map[x]).filter(x => x && x.group === it.group && x.drill);
      if (it.group.indexOf('e:') === 0) { out.push(it.groupName); return; }   // 考级项本身已带【】
      if (!sibs.length) { out.push('【' + it.groupName + '】'); return; }     // 只勾了动作、没勾组合
      if (sibs.length === 1) { out.push('【' + it.groupName + '】' + sibs[0].drill); return; }  // A：单组合合并一行
      out.push('【' + it.groupName + '】');
      sibs.forEach((sb, i) => out.push('　' + (i + 1) + '. ' + sb.drill));
    });
    return out;
  },
  // 打开旧记录：识别文本里已有的“生成行”，便于以后取消勾选时删除
  seedGenLines() {
    this.reorderSelection();
    const gen = this.buildGenLines();
    const content = String(this.data.content || '');
    const lines = content.length ? content.split('\n') : [];
    const mark = {};
    // ① 与当前生成格式完全相同的行
    const genSet = {};
    gen.forEach(l => { genSet[l] = true; });
    lines.forEach((l, i) => { if (genSet[l]) mark[i] = true; });

    // ② 历史格式：必须「整组一致」才认定（避免把 '· 动作名' 这类手写行误删）
    const TAB = '　';
    this.data.movesList.forEach(m => {
      if (!m.checked) return;
      const dnames = m.drills.filter(d => d.checked).map(d => d.name);
      if (!dnames.length) return;

      // 最早格式（单行合并）：'· 动作名：组合1、组合2'
      const joined = '· ' + m.name + '：' + dnames.join('、');
      lines.forEach((l, i) => { if (l === joined) mark[i] = true; });
      if (dnames.length === 1) {
        const one = '· ' + m.name + '：' + dnames[0];
        lines.forEach((l, i) => { if (l === one) mark[i] = true; });
      }

      // 中间/上一版格式：标题行 + 紧随其后的「全部组合行」
      const heads = ['· ' + m.name, '▎' + m.name];
      lines.forEach((l, i) => {
        if (heads.indexOf(l) < 0) return;
        for (let k = 0; k < dnames.length; k++) {
          const nx = lines[i + 1 + k];
          if (!nx) return;
          if (['　' + (k + 1) + '. ' + dnames[k], '　- ' + dnames[k]].indexOf(nx) < 0) return;
        }
        mark[i] = true;
        for (let k = 0; k < dnames.length; k++) mark[i + 1 + k] = true;
      });
    });
    this._genLines = lines.filter((l, i) => mark[i]);
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
  // 一行 = 一个「组合」（没有组合的动作则一行 = 该动作）
  buildLineItems() {
    const items = [];
    this.data.movesList.forEach(m => {
      if (!m.checked) return;
      const drills = m.drills.filter(d => d.checked);
      const g = 'm:' + m.id;
      if (!drills.length) {
        items.push({ key: g, group: g, groupName: m.name, label: m.name, sub: '（未选组合）', drill: '' });
        return;
      }
      drills.forEach((d, i) => {
        items.push({
          key: g + '::d:' + d.id, group: g, groupName: m.name,
          label: d.name, drill: d.name,
          sub: m.name + (drills.length > 1 ? ' · 第 ' + (i + 1) + '/' + drills.length + ' 组' : '')
        });
      });
    });
    this.data.examList.forEach(ex => {
      if (ex.checked) items.push({ key: 'e:' + ex.id, group: 'e:' + ex.id, groupName: '【' + ex.label + '】', label: '【' + ex.label + '】', sub: '考级备考', drill: '' });
    });
    return items;
  },
  // 维护显示顺序：已在顺序里的保持位置，新勾选的追加到末尾
  reorderSelection() {
    const items = this.buildLineItems();
    const keys = items.map(i => i.key);
    // 兼容旧版排序键：'m:<动作id>'（动作级）→ 展开成该动作下各组合键，保留原有先后
    const expanded = [];
    (this.data.selOrder || []).forEach(k => {
      if (k.indexOf('::d:') > -1 || k.indexOf('e:') === 0) {
        if (keys.indexOf(k) > -1) expanded.push(k);
        return;
      }
      const kids = keys.filter(x => x.indexOf(k + '::d:') === 0);
      if (kids.length) kids.forEach(x => expanded.push(x));
      else if (keys.indexOf(k) > -1) expanded.push(k);
    });
    const order = expanded.filter((k, i) => expanded.indexOf(k) === i);
    keys.forEach(k => { if (order.indexOf(k) < 0) order.push(k); });

    const map = {}; items.forEach(i => { map[i.key] = i; });
    const collapsed = this.data.collapsed || {};
    const gmap = {};                                  // 分组 → 组合键（按当前顺序）
    order.forEach(k => {
      const g = map[k] ? map[k].group : k;
      (gmap[g] = gmap[g] || []).push(k);
    });
    const rows = [];
    Object.keys(gmap).forEach(g => {
      const first = map[gmap[g][0]] || {};
      const multi = gmap[g].length > 1;
      const isExam = g.indexOf('e:') === 0;
      if (multi) {
        rows.push({
          kind: 'head', key: GHEAD + g, group: g, label: first.groupName || g,
          sub: gmap[g].length + ' 组', open: !collapsed[g], tag: isExam
        });
        if (collapsed[g]) return;
      }
      gmap[g].forEach((k, i) => {
        const it = map[k] || {};
        rows.push({
          kind: 'item', key: k, group: g, label: it.label || '',
          sub: multi ? ('第 ' + (i + 1) + '/' + gmap[g].length + ' 组') : (it.sub || ''),
          indent: multi, tag: isExam
        });
      });
    });
    this._order = order;
    this.setData({ selOrder: order, orderRows: rows });
  },

  // ===== 上移 / 下移（标题/单组合行 = 整组移动；多组合动作内的组合 = 组内移动）=====
  moveRow(e) {
    const key = String(e.currentTarget.dataset.key || '');
    const dir = Number(e.currentTarget.dataset.dir) || 0;
    if (!dir || !key) return;
    const rows = this.data.orderRows || [];
    const row = rows.filter(r => r.key === key)[0];
    if (!row) return;
    const order = (this.data.selOrder || []).slice();
    const gkeys = order.filter(k => inGroupOf(k, row.group));

    const apply = out => this.setData({ selOrder: out }, () => { this.reorderSelection(); this.syncContent(); });

    // ① 多组合动作里的某个组合 → 组内上下交换
    if (row.kind === 'item' && gkeys.length > 1) {
      const i = gkeys.indexOf(key), j = i + dir;
      if (i < 0 || j < 0 || j >= gkeys.length) return;
      gkeys.splice(i, 1);
      gkeys.splice(j, 0, key);
      const rest = order.filter(k => !inGroupOf(k, row.group));
      const firstIdx = order.findIndex(k => inGroupOf(k, row.group));
      const before = order.slice(0, firstIdx).filter(k => !inGroupOf(k, row.group)).length;
      apply(rest.slice(0, before).concat(gkeys, rest.slice(before)));
      return;
    }

    // ② 标题行，或“单组合/考级”这类只有一行代表整组的行 → 整组前后移动
    const blocks = [];
    order.forEach(k => {
      const g = k.indexOf('::d:') > -1 ? k.slice(0, k.indexOf('::d:')) : k;
      const last = blocks[blocks.length - 1];
      if (last && last.g === g) last.keys.push(k);
      else blocks.push({ g: g, keys: [k] });
    });
    const bi = blocks.findIndex(b => b.g === row.group);
    const bj = bi + dir;
    if (bi < 0 || bj < 0 || bj >= blocks.length) return;
    const blk = blocks.splice(bi, 1)[0];
    blocks.splice(bj, 0, blk);
    let out = [];
    blocks.forEach(b => { out = out.concat(b.keys); });
    apply(out);
  },

  // 折叠 / 展开某个动作的组合
  toggleGroup(e) {
    const key = String(e.currentTarget.dataset.key || '').replace(GHEAD, '');
    const collapsed = Object.assign({}, this.data.collapsed || {});
    collapsed[key] = !collapsed[key];
    this.setData({ collapsed: collapsed }, () => this.reorderSelection());
  },

  // 打开旧记录：识别「历史格式的生成行」并记为待替换（下一次勾选变动时由 syncContent 换成新格式；
  // 不在这里直接改写文本，避免打开即静默重排你的手写内容）



  setType(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ type: k, mode: k === 'ice' ? this.data.mode : 'lesson' });
  },
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.k });
    // 方式变了，时间提示要重算（自己训练会自动按时长，上课按节数校验）
    this.syncTime('mode');
  },
  setLessonForm(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ lessonForm: k });
    // 记住这次选择，下次新建默认用它
    const meta = store.load(store.KEYS.meta) || {};
    meta.lastLessonForm = k;
    store.save(store.KEYS.meta, meta);
  },

  setDuration(e) { this.setData({ duration: String(Number(e.currentTarget.dataset.v) || 90) }, () => this.syncTime('duration')); },
  setUnits(e) {
    const u = Number(e.currentTarget.dataset.v) || 1;
    this.setData({ units: u });
    this.syncLessonDuration();
    this.syncTime('units');
  },
  // 上课：时长 = 节数 × 30 分钟
  syncLessonDuration() {
    if (this.data.mode !== 'lesson') return;
    const u = Number(this.data.units) || 1;
    this.setData({ duration: String(u * 30) });
  },
  setStart(e) {
    const v = e.detail.value || [0, 0];
    this.setData({ timeStart: slotToTime(v[0], v[1]), startIdx: v }, () => this.syncTime('start'));
  },
  setEnd(e) {
    const v = e.detail.value || [0, 0];
    this.setData({ timeEnd: slotToTime(v[0], v[1]), endIdx: v }, () => this.syncTime('end'));
  },
  // 滚轮联动：小时选到 22 时，分钟只有 00
  onStartCol(e) {
    const d = e.detail; if (d.column !== 0) return;
    const idx = this.data.startIdx.slice(); idx[0] = d.value;
    if (d.value === LAST_HOUR) idx[1] = 0;
    this.setData({ startIdx: idx, startRange: [TIME_HOURS, d.value === LAST_HOUR ? ['00'] : TIME_MINUTES] });
  },
  onEndCol(e) {
    const d = e.detail; if (d.column !== 0) return;
    const idx = this.data.endIdx.slice(); idx[0] = d.value;
    if (d.value === LAST_HOUR) idx[1] = 0;
    this.setData({ endIdx: idx, endRange: [TIME_HOURS, d.value === LAST_HOUR ? ['00'] : TIME_MINUTES] });
  },
  // 手工输入精确时间（支持 "15:08" 或 "15:08-16:30"）
  manualTime() {
    wx.showModal({
      title: '手动输入时间',
      editable: true,
      placeholderText: '如 15:08-16:30，或只填 15:08',
      success: r => {
        if (!r.confirm) return;
        const txt = String(r.content || '').trim();
        if (!txt) return;
        const two = txt.split(/[-–~—至到]/);
        if (two.length >= 2) {
          const a = normTime(two[0]), b = normTime(two[1]);
          if (!a || !b) { wx.showToast({ title: '格式如 15:08-16:30', icon: 'none' }); return; }
          this.setData({ timeStart: a, timeEnd: b, startIdx: timeToSlots(a), endIdx: timeToSlots(b) }, () => this.syncTime('end'));
        } else {
          const a = normTime(txt);
          if (!a) { wx.showToast({ title: '格式如 15:08', icon: 'none' }); return; }
          this.setData({ timeStart: a, startIdx: timeToSlots(a) }, () => this.syncTime('start'));
        }
      }
    });
  },
  clearTime() { this.setData({ timeStart: '', timeEnd: '', timeHint: '' }); },


  // 联动：anchor 决定以谁为准
  //   'start' / 'duration' / 'units' / 'mode' → 由「开始 + 时长」推算结束
  //   'end'                                   → 由「开始→结束」反推时长（自己训练）
  syncTime(anchor) {
    const mode = this.data.mode;
    const effDur = mode === 'lesson' ? (Number(this.data.units) || 1) * 30 : (Number(this.data.duration) || 90);
    let start = this.data.timeStart, end = this.data.timeEnd, hint = '';
    // 上课：时长一律 = 节数 × 30（否则切成上课后仍留着 90 分钟，与节数矛盾）
    let duration = mode === 'lesson' ? (Number(this.data.units) || 1) * 30 : this.data.duration;
    let durOptions = this.data.durOptions;

    if (anchor === 'end') {
      if (end && !start) {
        // 只有结束时间：以时长倒推开始时间（不提示，属于日常操作）
        start = fmtMin(toMin(end) - effDur);
      } else if (start && end) {
        const d = diffMin(start, end);
        if (mode !== 'lesson') {
          duration = String(d);
          if (durOptions.indexOf(d) < 0) { durOptions = durOptions.concat([d]).sort((x, y) => x - y); }
        } else if (d !== effDur) {
          // 上课：时间段与「节数 × 30 分钟」不符时提醒（唯一需要提示的情况）
          hint = '时间段是 ' + lenText(d).replace('共 ', '') + '，与「' + (Number(this.data.units) || 1) + ' 节 × 30 分钟」不一致';
        }
      }
    } else {
      if (start) {
        end = fmtMin(toMin(start) + effDur);   // 自动推算结束时间（不提示）
      }
      if (start && end && mode !== 'lesson') {
        const d = diffMin(start, end);
        duration = String(d);
        if (durOptions.indexOf(d) < 0) { durOptions = durOptions.concat([d]).sort((x, y) => x - y); }
      }
      if (start && end && mode === 'lesson') {
        const d = diffMin(start, end);
        if (d !== effDur) hint = '时间段是 ' + lenText(d).replace('共 ', '') + '，与「' + (Number(this.data.units) || 1) + ' 节 × 30 分钟」不一致';
      }
    }
    if (!start && !end) hint = '';
    // 手输/推算的时间超出滚轮范围时说明清楚（滚轮只覆盖 08:00–22:00）
    const outOfRange = t => { const m = toMin(t); return m >= 0 && (m < TIME_FROM || m > TIME_TO); };
    if (outOfRange(start) || outOfRange(end)) {
      hint = '时间超出滚轮范围（08:00–22:00）：已按你填写的值保存，滚轮内会显示为最近的档位';
    }
    this.setData({
      timeStart: start, timeEnd: end,
      duration: String(duration), durOptions: durOptions, timeHint: hint,
      startIdx: timeToSlots(start), endIdx: timeToSlots(end)
    });
  },

  // 初始化时：把内容里“看起来是勾选生成”的行认出来，便于以后取消勾选时删除
  // 增量更新：只增删生成行，保留用户手写的要点/备注


  setDate(e) {
    this.setData({ date: e.detail.value });
  },
  input(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  save() {
    const { id, date, type, mode, duration, content, units, lessonForm, timeStart, timeEnd } = this.data;
    if (!date) { wx.showToast({ title: '请选择日期', icon: 'none' }); return; }
    const rec = {
      id: id || store.uid(),
      date, type, mode,
      duration: Number(duration) || 0,
      time: (timeStart && timeEnd) ? (timeStart + '-' + timeEnd) : (timeStart || ''),
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
