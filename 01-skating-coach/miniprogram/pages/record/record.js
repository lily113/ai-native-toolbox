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

// 打开记录编辑时，把残留的旧字段（课后总结 / 备注）并进笔记框。
// 否则保存时这两个字段会被写成空串——那是真的丢字（网页版导出/云端旧数据里都可能有）。
function mergeLegacyNotes(rec) {
  let c = String((rec && rec.content) || '');
  if (!rec) return c;
  [rec.lessonSummary, rec.notes].forEach(x => {
    const t = x && String(x).trim();
    if (t && c.indexOf(t) === -1) c = c ? (c + '\n' + t) : t;
  });
  return c;
}

const { EXAM_KINDS, LESSON_FORMS, TYPES, MODES } = require('../../utils/const');

Page({
  data: {
    id: '',
    date: '',
    type: 'ice',
    mode: 'self',
    duration: '90',
    durOptions: [60, 90, 120, 150],
    durOptionsIce: [60, 90, 120, 150],
    durOptionsLand: [30, 45, 60, 90, 120],
    timeStart: '',
    timeEnd: '',
    timeHint: '',
    startRange: [TIME_HOURS, TIME_MINUTES],
    endRange: [TIME_HOURS, TIME_MINUTES],
    startIdx: [0, 0],
    endIdx: [0, 0],
    content: '',
    orphanLines: [], orphanCount: 0,
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
    onlyPicked: false,
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
      content: rec ? mergeLegacyNotes(rec) : '',
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
    const catMap = store.catMap();
    const selMoves = (rec && Array.isArray(rec.moves)) ? rec.moves : [];
    const selDrills = (rec && Array.isArray(rec.drills)) ? rec.drills : [];
    const movesList = lib.map(m => {
      const cid = store.validCat(m.category);
      const checked = selMoves.indexOf(m.id) > -1;
      return {
        id: m.id,
        name: m.name,
        catName: (catMap[cid] || {}).name || '其他',
        checked: checked,
        drills: (m.drills || []).slice()
          .sort((a, b) => (Number(b.c) || 0) - (Number(a.c) || 0))
          .map(d => ({
            id: d.id, name: d.name, detail: d.detail || '',
            checked: selDrills.indexOf(d.id) > -1
          }))
      };
    });
    // ── 兼容旧记录：把「动作」与「组合」的勾选状态对齐（父框状态一律由组合算出来）──
    // ① 动作被记录了、但它下面的组合一个都没记 → 按旧的「整组」语义视为全部组合
    //    （预置动作刚进来时还没有组合，那时勾的就是"整个动作"）
    movesList.forEach(m => {
      if (!m.checked || !m.drills.length) return;
      if (m.drills.some(d => d.checked)) return;
      m.drills.forEach(d => { d.checked = true; });
    });
    // ② 组合被记录了、动作却没勾（早期 bug 存下来的）→ 反推把动作勾上，别让这条数据渲染不出来
    movesList.forEach(m => {
      if (m.checked || !m.drills.length) return;
      if (m.drills.some(d => d.checked)) m.checked = true;
    });
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
    this.setData({
      movesList: movesList,
      selMoveIds: movesList.filter(m => m.checked).map(m => m.id),
      selDrillIds: this.pickedDrillIds(movesList)
    }, () => this.refreshMoves());
  },

  // 已勾选的组合 id（只有被勾选动作下的组合才算数）
  pickedDrillIds(list) {
    const out = [];
    (list || []).forEach(m => { if (m.checked) m.drills.forEach(d => { if (d.checked) out.push(d.id); }); });
    return out;
  },
  // 父框状态由子项算出来：全选 ✓ / 部分 − / 未选 空
  markSel(list) {
    return list.map(m => Object.assign({}, m, {
      allOn: !!m.checked && (!m.drills.length || m.drills.every(d => d.checked)),
      partOn: !!m.checked && m.drills.length > 0 && !m.drills.every(d => d.checked)
    }));
  },
  // 搜索 / 最近使用 → 生成展示用列表
  refreshMoves() {
    const q = String(this.data.moveQuery || '').trim().toLowerCase();
    const recent = !!this.data.recentOnly;
    const only = !!this.data.onlyPicked;
    let list = this.data.movesList.filter(m => {
      if (only && !m.checked) return false;
      if (recent && !m.recent) return false;
      if (!q) return true;
      if (String(m.name).toLowerCase().indexOf(q) > -1) return true;
      return (m.drills || []).some(d => String(d.name).toLowerCase().indexOf(q) > -1);
    });
    if (recent || q) {
      list = list.slice().sort((a, b) => String(b.lastUse || '').localeCompare(String(a.lastUse || '')));
    }
    // 列表为空时给一句对症的话：勾选筛选 / 搜索 / 动作库为空
    let emptyHint = '可先到「动作库」添加动作';
    if (only && !q) emptyHint = '这条记录还没勾选任何动作';
    else if (q) emptyHint = '换个关键词试试';
    this.setData({ viewMoves: this.markSel(list), emptyHint: emptyHint });
  },
  toggleOnlyPicked() {
    this.setData({ onlyPicked: !this.data.onlyPicked }, () => this.refreshMoves());
  },
  onMoveQuery(e) { this.setData({ moveQuery: e.detail.value }, () => this.refreshMoves()); },
  clearMoveQuery() { this.setData({ moveQuery: '' }, () => this.refreshMoves()); },
  toggleRecent() { this.setData({ recentOnly: !this.data.recentOnly }, () => this.refreshMoves()); },

  toggleMove(e) {
    const id = e.currentTarget.dataset.id;
    let list = this.data.movesList.map(m =>
      m.id === id ? Object.assign({}, m, { checked: !m.checked }) : m
    );
    // 点动作名 = 连同它下面的组合一起勾上（取消勾选则一起取消），所有分类一致
    const cur = list.filter(m => m.id === id)[0];
    if (cur && (cur.drills || []).length) {
      list = list.map(m => m.id !== id ? m : Object.assign({}, m, {
        drills: m.drills.map(d => Object.assign({}, d, { checked: cur.checked }))
      }));
    }
    this.setData({
      movesList: list,
      selMoveIds: list.filter(m => m.checked).map(m => m.id),
      selDrillIds: this.pickedDrillIds(list)
    }, () => { this.refreshMoves(); this.syncContent(); });
  },

  toggleDrill(e) {
    const mid = e.currentTarget.dataset.mid;
    const did = e.currentTarget.dataset.did;
    const list = this.data.movesList.map(m => {
      if (m.id !== mid) return m;
      const drills = m.drills.map(d => d.id === did ? Object.assign({}, d, { checked: !d.checked }) : d);
      // 有组合的动作：勾选状态完全跟着组合走——勾了任一个才算被记录，全取消就不算
      return Object.assign({}, m, { drills: drills, checked: drills.some(d => d.checked) });
    });
    this.setData({
      movesList: list,
      selMoveIds: list.filter(m => m.checked).map(m => m.id),
      selDrillIds: this.pickedDrillIds(list)
    }, () => { this.refreshMoves(); this.syncContent(); });
  },

  // 初始化「考级备考」勾选（只到「级别 + 类型」粒度）
  initExams(rec) {
    const exams = store.ensureExams();
    const picked = (rec && Array.isArray(rec.examPicks)) ? rec.examPicks : [];
    // 按「类型 + 级别」去重：优先内置考纲那条，其次内容更多的
    const best = {};
    exams.forEach(ex => {
      const label = ((EXAM_KINDS[ex.kind] || {}).name || '') + ' · ' + ex.level;
      // 关注(⭐) 优先，其次内置考纲，再次内容多的（否则关注的那条可能被同级别的旧条目挤掉）
      const score = (ex.star ? 5000 : 0) + (ex.key ? 1000 : 0) + (ex.myItems || []).length + Object.keys(ex.itemExtra || {}).length;
      if (!best[label] || score > best[label].score) best[label] = { label: label, ex: ex, score: score };
    });
    const chosen = Object.keys(best).map(k => best[k]);
    let examList = chosen.map(b => ({
      id: b.ex.id,
      label: b.label,
      star: !!b.ex.star,
      // 若之前勾选的是同类同级的另一条，也视为已勾选
      checked: exams.some(x => (x.kind === b.ex.kind && x.level === b.ex.level) && picked.indexOf(x.id) > -1)
    }));
    // ★ 只显示「我关注的（⭐）」和「这条记录已经勾选的」——官方 42 个级别全列出来太灾难了
    const shownIds = {};
    examList = examList.filter(x => {
      if (!x.star && !x.checked) return false;
      shownIds[x.id] = 1;
      return true;
    });
    // 记录里勾选过、但不在上面这批里的（老数据/重复条目）也要保留，否则那行删不掉
    (rec && Array.isArray(rec.examPicks) ? rec.examPicks : []).forEach(id => {
      if (shownIds[id]) return;
      const ex = exams.filter(x => x && x.id === id)[0];
      if (!ex) return;
      examList.push({
        id: ex.id,
        label: ((EXAM_KINDS[ex.kind] || {}).name || '') + ' · ' + ex.level,
        star: !!ex.star,
        checked: true
      });
      shownIds[id] = 1;
    });
    const ids = examList.filter(x => x.checked).map(x => x.id);
    this.setData({ examList: examList, selExamIds: ids, selOrder: (rec && Array.isArray(rec.itemOrder)) ? rec.itemOrder.slice() : [] }, () => {
      if (rec) { this.seedGenLines(); this.scanOrphans(); } else { this.syncContent(); this.scanOrphans(); }
    });
  },

  goExams() {
    wx.navigateTo({ url: '/packageExam/exams/exams' });
  },

  toggleExam(e) {
    const id = e.currentTarget.dataset.id;
    const examList = this.data.examList.map(x => x.id === id ? Object.assign({}, x, { checked: !x.checked }) : x);
    const ids = examList.filter(x => x.checked).map(x => x.id);
    this.setData({ examList: examList, selExamIds: ids }, () => { this.refreshMoves(); this.syncContent(); });
  },

  // 找出笔记里"已经不是当前生成结果"的条目行（【…】开头）。
  // 典型场景：这个动作已经从动作库里删掉了 → 没有勾选框可取消 → 那几行永远删不掉。
  scanOrphans() {
    try {
      const genSet = {};
      this.buildGenLines().forEach(l => { genSet[l] = true; });
      // 库里有哪些名字、这条记录当前勾了哪些、库里所有组合名（用来判断一行"像不像自动生成的"）
      const knownMoves = {}, knownExams = {}, checkedMoves = {}, checkedExams = {}, drillNames = {};
      store.ensureMoves().forEach(m => {
        knownMoves[m.name] = true;
        (m.drills || []).forEach(d => { drillNames[d.name] = true; });
      });
      store.ensureExams().forEach(ex => { knownExams[((EXAM_KINDS[ex.kind] || {}).name || '') + ' · ' + ex.level] = true; });
      (this.data.movesList || []).forEach(m => { if (m.checked) checkedMoves[m.name] = true; });
      (this.data.examList || []).forEach(ex => { if (ex.checked) checkedExams[ex.label] = true; });
      const lines = String(this.data.content || '').split('\n');
      const orphan = lines.filter((l, i) => {
        const t = l.trim();
        if (genSet[l]) return false;                 // 就是当前勾选生成的行，正常
        const m = /^【(.+?)】/.exec(t);
        if (!m) return false;                        // 不是条目行（普通文字/要点）
        const n = m[1];
        // 后面跟着「1. xxx」这类你自己列的点 → 这是你手写的标题，不是自动生成的条目
        for (let j = i + 1; j < lines.length; j++) {
          const nx = String(lines[j]).trim();
          if (!nx) continue;
          if (/^\d+\s*[.、]/.test(nx)) return false;
          break;
        }
        const rest = t.slice(t.indexOf('】') + 1).trim();
        // 名字都不在库里了（动作/考级被删）→ 取消勾选也删不掉，交给用户清理
        if (!knownExams[n] && !knownMoves[n]) return true;
        if (knownExams[n]) return !checkedExams[n];
        if (checkedMoves[n]) return false;           // 勾着 → 就是当前生成的行
        // 没勾选：只有"长得像自动生成"的行才算失效（空尾巴 / 尾巴是库里的组合名），
        // 你自己写的批注（【动作】后面接一段话）不动它
        if (!rest) return true;
        return !!drillNames[rest];
      });
      this.setData({ orphanLines: orphan, orphanCount: orphan.length });
    } catch (e) {}
  },
  cleanOrphans() {
    const orphan = this.data.orphanLines || [];
    if (!orphan.length) return;
    const show = orphan.slice(0, 6).join('\n') + (orphan.length > 6 ? '\n…' : '');
    wx.showModal({
      title: '清理 ' + orphan.length + ' 行失效条目',
      content: '这些行对应的动作/考级已经不在你的库里了，无法通过取消勾选删除：\n\n' + show + '\n\n确定从训练笔记里删掉它们吗？（只删笔记里的这几行，不动其它文字）',
      confirmText: '删除这几行',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        const set = {};
        orphan.forEach(l => { set[l] = true; });
        const kept = String(this.data.content || '').split('\n').filter(l => !set[l]);
        this._genLines = (this._genLines || []).filter(l => !set[l]);
        this.setData({ content: kept.join('\n') }, () => this.scanOrphans());
        wx.showToast({ title: '已清理' });
      }
    });
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
    this.setData({ content: text }, () => this.scanOrphans());
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



  // ---------- 复制上次这条训练（只复制“设置 + 勾选 + 顺序”，不复制日期/时间/笔记文字） ----------
  copyLast() {
    const recs = store.loadRecords();
    if (!recs.length) { wx.showToast({ title: '还没有历史记录', icon: 'none' }); return; }
    const sameType = recs.filter(r => r.type === this.data.type);
    const pool = sameType.length ? sameType : recs;
    let src = pool[0];
    pool.forEach(r => { if (String(r.date) >= String(src.date)) src = r; });   // 日期最新（同日取后录入的）
    const NM = (TYPES[src.type] || {}).name || src.type;
    const MM = (MODES[src.mode] || {}).name || src.mode;
    wx.showModal({
      title: '复制上次训练',
      content: '来源：' + src.date + '（' + NM + ' · ' + MM + '）\n' +
        '动作 ' + (src.moves || []).length + ' 个 · 组合 ' + (src.drills || []).length + ' 个 · 考级 ' + (src.examPicks || []).length + ' 项\n\n' +
        '将复制：类型 / 方式 / 时长 / 节数 / 上课形式 + 勾选与顺序\n' +
        '（日期、时间、笔记文字保留当前这条的）',
      confirmText: '复制',
      success: r => { if (r.confirm) this.applyCopy(src); }
    });
  },

  applyCopy(src) {
    const dur = Number(src.duration) || (src.type === 'land' ? 60 : 90);
    const base = (src.type === 'land' ? this.data.durOptionsLand : this.data.durOptionsIce) || [];
    const opts = base.slice();
    if (dur && opts.indexOf(dur) < 0) opts.push(dur);
    opts.sort((a, b) => a - b);
    this.setData({
      type: src.type,
      mode: MODES[src.mode] ? src.mode : 'self',
      units: Number(src.units) || 2,
      lessonForm: src.lessonForm || 'one',
      duration: String(dur),
      durOptions: opts,
      content: ''                                   // 笔记文字不复制，稍后由勾选重新生成
    }, () => {
      if (src.type === 'rehab') {                   // 兼容旧类型
        const t = this.data.types.slice();
        if (!t.some(x => x.k === 'rehab')) t.push({ k: 'rehab', e: '💪 康复（旧）' });
        this.setData({ types: t });
      }
      this.initMoves(src);
      this.initExams(src);
      if (this.data.mode === 'lesson') this.syncLessonDuration();
      setTimeout(() => this.syncContent(), 30);     // 等初始化回调完成后再生成笔记条目
      wx.showToast({ title: '已复制上次训练' });
    });
  },

  setType(e) {
    const k = e.currentTarget.dataset.k;
    // 陆地/上冰都支持「自己训练 / 上课」，切换类型不再强制方式；时长档位按类型给
    const isLand = k === 'land';
    const opts = (isLand ? this.data.durOptionsLand : this.data.durOptionsIce).slice();
    const cur = Number(this.data.duration);
    if (opts.indexOf(cur) < 0) opts.push(cur);
    opts.sort((a, b) => a - b);
    this.setData({ type: k, durOptions: opts });
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
