const store = require('../../utils/store');
const AI_KEY = 'figure_skating_planner_ai_coach_v1';

// ---------- 极简 Markdown → 结构化块（只做展示，不改内容） ----------
function parseInline(s) {
  const out = [];
  let rest = String(s == null ? '' : s);
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(rest)) !== null) {
    if (m.index > last) out.push({ b: false, v: rest.slice(last, m.index) });
    out.push({ b: true, v: m[1] });
    last = m.index + m[0].length;
  }
  if (last < rest.length) out.push({ b: false, v: rest.slice(last) });
  return out.length ? out : [{ b: false, v: '' }];
}

function cellText(segs) {
  // 单元格：合并片段为纯文本；整格加粗则标记 b
  const txt = (segs || []).map(x => x.v).join('');
  const allBold = (segs || []).length > 0 && (segs || []).every(x => x.b);
  return { s: txt, b: allBold };
}

function isTableLine(l) {
  const t = String(l || '').trim();
  return t.indexOf('|') === 0 || (t.split('|').length >= 3 && /\|\s*$/.test(t));
}

function buildTable(group) {
  const rows = group.map(l => {
    const t = l.trim().replace(/^\|+/, '').replace(/\|+$/, '');
    return t.split('|').map(c => c.trim());
  }).filter(cells => !(cells.length && cells.every(c => c === '' || /^:?-{2,}:?$/.test(c))));
  if (!rows.length) return { t: 'gap' };
  const head = rows.shift();
  // 列数取所有行的最大值（否则正文多出来的列会被丢掉）
  const cols = Math.max.apply(null, [head.length].concat(rows.map(r => r.length)));
  const pad = r => { const c = r.slice(0, cols); while (c.length < cols) c.push(''); return c.map(x => cellText(parseInline(x))); };
  return { t: 'table', cols: cols, head: pad(head), rows: rows.map(pad) };
}

function md2blocks(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    // 表格：连续多行都含竖线
    if (isTableLine(raw)) {
      const group = [];
      while (i < lines.length && isTableLine(lines[i])) { group.push(lines[i]); i++; }
      blocks.push(buildTable(group));
      continue;
    }
    i++;
    if (!t) { blocks.push({ t: 'gap' }); continue; }
    let m;
    if ((m = t.match(/^#{1,6}\s*(.+)$/))) { blocks.push({ t: 'h', v: parseInline(m[1]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ t: 'hr' }); continue; }
    if ((m = t.match(/^>\s*(.+)$/))) { blocks.push({ t: 'quote', v: parseInline(m[1]) }); continue; }
    if ((m = t.match(/^[-*•·]\s+(.+)$/))) { blocks.push({ t: 'li', v: parseInline(m[1]) }); continue; }
    if ((m = t.match(/^(\d{1,2})[\.、)]\s+(.+)$/))) { blocks.push({ t: 'num', n: m[1], v: parseInline(m[2]) }); continue; }
    if ((m = t.match(/^【(.+?)】\s*(.*)$/))) { blocks.push({ t: 'h2', v: parseInline(m[1]), rest: parseInline(m[2]) }); continue; }
    if ((m = t.match(/^\*\*([^*]+)\*\*[:：]?$/))) { blocks.push({ t: 'h2', v: [{ b: true, v: m[1] }] }); continue; }
    blocks.push({ t: 'p', v: parseInline(t) });
  }
  const out = [];
  blocks.forEach(b => {
    if (b.t === 'gap' && (!out.length || out[out.length - 1].t === 'gap')) return;
    out.push(b);
  });
  while (out.length && out[out.length - 1].t === 'gap') out.pop();
  return out;
}

function buildSrcList(sources) {
  const DISC = { single: '单人滑', pair: '双人滑', dance: '冰舞', synchro: '队列滑', exam: '考级' };
  const map = {}, order = [];
  (sources || []).forEach(s => {
    if (!s || !s.doc) return;
    const key = s.doc + '#' + (s.outdated ? '1' : '0');
    if (!map[key]) {
      map[key] = { doc: s.doc, season: s.season, lang: s.lang, outdated: !!s.outdated, discipline: s.discipline, pages: [], n: 0 };
      order.push(key);
    }
    const g = map[key];
    g.n += 1;
    if (s.page && g.pages.indexOf(s.page) < 0) g.pages.push(s.page);
  });
  const list = order.map(k => {
    const g = map[k];
    const bits = [];
    if (g.discipline && DISC[g.discipline]) bits.push(DISC[g.discipline]);
    if (g.season) bits.push(/^\d{4}$/.test(g.season) ? g.season + ' 年' : g.season);
    if (g.pages.length) bits.push('第 ' + g.pages.slice(0, 4).join('、') + ' 页' + (g.pages.length > 4 ? ' 等' : ''));
    if (g.lang === 'zh-translation') bits.push('中译·未核对');
    else if (g.lang === 'en-official') bits.push('官方英文原文');
    else if (g.lang === 'zh-official') bits.push('国家官方文件');
    if (g.outdated) bits.push('⚠️历史版本');
    if (g.n > 1 && g.pages.length !== 1) bits.push(g.n + ' 段');
    return g.doc + (bits.length ? '（' + bits.join(' · ') + '）' : '');
  });
  return list.length > 6 ? list.slice(0, 6).concat(['…还有 ' + (list.length - 6) + ' 份来源']) : list;
}

// 把存储里的消息补上展示所需的字段（存储只存 text/sources，省空间）
function decorate(m) {
  const o = { role: m.role, text: m.text || '', sources: Array.isArray(m.sources) ? m.sources : [], srcOpen: false };
  if (m.role === 'ai' && o.text.indexOf('⏳') !== 0) o.blocks = md2blocks(o.text);
  else o.blocks = [{ t: 'p', v: [{ b: false, v: o.text }] }];
  o.srcList = buildSrcList(o.sources);
  return o;
}

Page({
  data: {
    msgs: [],
    input: '',
    sending: false,
    scrollId: ''
  },

  onLoad() {
    const raw = store.load(AI_KEY) || [];
    // 上次请求中途退出会留下「⏳ 思考中…」，载入时标记为未完成，避免看起来卡住
    raw.forEach(m => {
      if (m.role === 'ai' && String(m.text || '').indexOf('⏳') === 0) {
        m.text = '（上次提问没有完成，请重新提问）';
      }
    });
    const msgs = raw.map(decorate);
    this.setData({ msgs: msgs, scrollId: msgs.length ? 'm' + (msgs.length - 1) : '' });
  },
  onHide() { this.persist(); },
  onUnload() { this.persist(); },
  persist() {
    store.save(AI_KEY, this.data.msgs.map(m => ({ role: m.role, text: m.text, sources: m.sources || [] })));
  },

  input(e) { this.setData({ input: e.detail.value }); },

  append(role, text, sources) {
    const msgs = this.data.msgs.concat([decorate({ role: role, text: text, sources: sources || [] })]);
    this.setData({ msgs: msgs, scrollId: 'm' + (msgs.length - 1) });
    this.persist();
    return msgs.length - 1;
  },
  replaceAt(idx, role, text, sources) {
    const msgs = this.data.msgs.slice();
    msgs[idx] = decorate({ role: role, text: text, sources: sources || [] });
    this.setData({ msgs: msgs, scrollId: 'm' + idx });
    this.persist();
  },

  toggleSrc(e) {
    const i = Number(e.currentTarget.dataset.i);
    const msgs = this.data.msgs.slice();
    if (!msgs[i]) return;
    msgs[i] = Object.assign({}, msgs[i], { srcOpen: !msgs[i].srcOpen });
    this.setData({ msgs: msgs });
  },

  copyMsg(e) {
    const i = Number(e.currentTarget.dataset.i);
    const m = this.data.msgs[i];
    if (!m) return;
    wx.setClipboardData({ data: m.text || '' });
  },

  send() {
    const q = (this.data.input || '').trim();
    if (!q || this.data.sending) return;
    this.setData({ input: '' });
    this.append('user', q);
    this.setData({ sending: true });
    const idx = this.append('ai', '⏳ 思考中…');
    wx.cloud.callFunction({
      name: 'deepseek',
      data: { question: q }
    })
      .then(res => {
        const r = (res && res.result) || {};
        const ans = r.answer || '(空回复)';
        this.replaceAt(idx, 'ai', ans, r.sources);
      })
      .catch(err => {
        this.replaceAt(idx, 'ai', '❌ 调用失败：' + ((err && (err.errMsg || err.message)) || '未知错误') +
          '\n请检查：deepseek 云函数是否已部署、是否配置了 DEEPSEEK_KEY、执行超时是否 ≥60s。');
      })
      .then(() => this.setData({ sending: false }));
  },

  clear() {
    wx.showModal({
      title: '清空',
      content: '清空与 AI 教练的聊天记录？',
      success: r => {
        if (!r.confirm) return;
        this.setData({ msgs: [], scrollId: '' });
        store.save(AI_KEY, []);
      }
    });
  }
});
