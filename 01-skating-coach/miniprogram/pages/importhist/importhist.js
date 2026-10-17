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
    importing: false,
    aiBusy: false, aiMsg: '', aiSteps: '', byAi: 0,
    promptOn: false,
    counted: true,          // 默认：当作真实训练记录（计入天数/时长）；关掉 = 只当笔记
  },

  onLoad() {
    // 记录一下"现有多少条"，导入后好算新增了几条
    this.setData({ beforeN: (store.loadRecords() || []).length, promptText: histnote.AI_PROMPT });
  },

  onInput(e) {
    // 改了文本就不再显示旧的识别结果，避免"看到的是上一次的"
    this.setData({ raw: e.detail.value, parsed: false, items: [] });
  },

  parse() {
    const raw = String(this.data.raw || '');
    if (!raw.trim()) { wx.showToast({ title: '先粘贴点内容', icon: 'none' }); return; }
    // 粘进来的是"AI 按我们的格式给的 JSON"？那就走 JSON 解析（自动判断，用户不用选）
    if (histnote.looksLikeAiJson(raw)) {
      const r = histnote.parseAiJson(raw);
      if (!r) { wx.showToast({ title: '这段像 AI 的 JSON，但解析不出来。让它重新按格式输出一次', icon: 'none', duration: 3000 }); return; }
      this.applyAiEntries(r.entries, r.rest, 'AI 格式');
      return;
    }
    const recs = store.loadRecords() || [];
    const pv = histnote.preview(raw, recs);
    if (!pv.items.length) {
      this.setData({ parsed: true, items: [], total: 0, pickN: 0, dupN: 0, ambiguous: 0, noDate: pv.noDate });
      return;
    }
    const items = pv.items.map(it => {
      const dup = pv.dup.some(d => d.date === it.date && d.text === it.text);
      const dur0 = histnote.extractDuration(it.text);
      return {
        durText: dur0.duration ? (dur0.units ? (dur0.units + ' 节 / ' + dur0.duration + ' 分钟') : (dur0.duration + ' 分钟')) : '',
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

  // ---------- AI 识别（规则认不出来时的兜底） ----------
  // 说明清楚三件事：会发原文给 AI、要花调用费、AI 只填日期/冰上还是陆地/原文，不填时长
  aiParse() {
    if (this.data.aiBusy) return;
    const raw = String(this.data.raw || '');
    if (raw.trim().length < 10) { wx.showToast({ title: '先粘贴点内容', icon: 'none' }); return; }
    wx.showModal({
      title: '让 AI 识别',
      content: '会把这段笔记原文发给 DeepSeek 做切分（只用于这次识别，不保存到别处）。\n\nAI 只会填「日期 / 冰上还是陆地 / 原文」，不填时长、不总结、不补内容；识别结果先给你核对，不会直接写进记录。',
      confirmText: '开始',
      success: r => { if (r.confirm) this.doAi(raw); }
    });
  },

  doAi(raw) {
    const chunks = splitChunks(raw, 6000);
    if (!chunks.length) { wx.showToast({ title: '没有内容', icon: 'none' }); return; }
    if (chunks.length > 20) {
      wx.showToast({ title: '太长了，请分几次粘（一次约 20 段以内）', icon: 'none', duration: 3000 });
      return;
    }
    this.setData({ aiBusy: true, aiMsg: '', aiSteps: '0/' + chunks.length, parsed: false, items: [] });
    const got = [];
    let restAll = [];
    const step = (i) => {
      if (i >= chunks.length) { this.finishAi(got, restAll, chunks.length); return; }
      this.setData({ aiSteps: i + '/' + chunks.length });
      wx.cloud.callFunction({
        name: 'deepseek',
        data: { mode: 'import', text: chunks[i] }
      }).then(res => {
        const r = (res && res.result) || {};
        if (r.answer) {   // 走了"非本人/未配置"的兜底分支
          this.setData({ aiBusy: false, aiMsg: String(r.answer) });
          return;
        }
        if (r.msg) { this.setData({ aiBusy: false, aiMsg: 'AI 报错：' + r.msg }); return; }
        (r.entries || []).forEach(x => got.push(x));
        if (r.rest) restAll.push(r.rest);
        step(i + 1);
      }).catch(err => {
        this.setData({ aiBusy: false, aiMsg: '调用失败：' + friendlyCloudErr(err) });
      });
    };
    step(0);
  },

  finishAi(entries, rests, nChunks) {
    this.applyAiEntries(entries, rests.join('\n'), 'AI 识别', nChunks);
  },

  // 把 [{date, kind, text}] 变成可预览的行。
  // 云函数的结果、以及用户自己拿 AI 转出来的 JSON，都走这里 —— 同一套规则，不各写一份。
  applyAiEntries(entries, restText, fromLabel, nChunks) {
    const recs = store.loadRecords() || [];
    const have = {};
    recs.forEach(r => { if (r && r.date) have[r.date + '|' + String(r.content || '').trim()] = 1; });
    const seen = {};
    let noDateN = 0;
    const items = [];
    entries.forEach(e => {
      const text = String(e.text || '').trim();
      if (!text) return;
      const date = String(e.date || '');
      const dup = !!(date && have[date + '|' + text]);
      if (!date) noDateN++;
      if (date && (have[date + '|' + text] || seen[date + '|' + text])) return;   // 真重复的直接不显示
      if (date) seen[date + '|' + text] = 1;
      const dur = histnote.extractDuration(text);
      items.push({
        durText: dur.duration ? (dur.units ? (dur.units + ' 节 / ' + dur.duration + ' 分钟') : (dur.duration + ' 分钟')) : '',
        date: date || '（没认出日期）',
        rawDate: date,
        text: text,
        kind: e.kind || 'other',
        byAi: true,
        ambiguous: false,
        dup: dup,
        // 没日期的、other 类的默认不勾（避免塞进一堆无意义的东西）
        pick: !!date && e.kind !== 'other',
        preview: text.replace(/\n+/g, ' ／ ').slice(0, 60)
      });
    });
    items.sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));
    const extra = nChunks ? ('，共 ' + nChunks + ' 批') : '';
    this.setData({
      aiBusy: false, parsed: true, items: items, byAi: items.length,
      total: items.length, pickN: items.filter(x => x.pick).length,
      dupN: 0, ambiguous: 0,
      noDate: String(restText || '').trim(),
      aiMsg: fromLabel + ' ' + items.length + ' 条' + (noDateN ? '（其中 ' + noDateN + ' 条没认出日期，已默认不勾）' : '')
        + extra + '。请核对后再导入。'
    });
  },

  // ---------- 复制提示词：让用户拿自己的 AI（豆包/ChatGPT/DeepSeek 都行）转格式 ----------
  copyPrompt() {
    wx.setClipboardData({
      data: histnote.AI_PROMPT,
      success: () => {
        wx.showModal({
          title: '提示词已复制',
          content: '① 打开任意 AI（豆包 / ChatGPT / DeepSeek 都行）\n② 粘贴这段提示词，下面接上你的笔记，发送\n③ 把它给的 JSON 整段复制回来，粘到上面那个框，点「识别」\n\n（用你自己的 AI：不花这个 app 的钱，也不会把笔记发给我们的服务）',
          showCancel: false,
          confirmText: '好'
        });
      }
    });
  },

  showPrompt() { this.setData({ promptOn: !this.data.promptOn }); },

  onCounted(e) {
    this.setData({ counted: !!e.detail.value });
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
    const picked = this.data.items.filter(x => x.pick && (x.rawDate || /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
    if (!picked.length) { wx.showToast({ title: '没有勾选任何一条', icon: 'none' }); return; }
    const recs = store.loadRecords() || [];
    const have = {};
    recs.forEach(r => { if (r && r.id) have[r.id] = 1; });
    const add = [];
    picked.forEach(it => {
      const rec = histnote.toRecord({ date: it.rawDate || it.date, text: it.text, kind: it.kind },
        { counted: this.data.counted });

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
      content: '新增了 ' + n + ' 条' + (this.data.counted ? '训练记录' : '历史笔记') + '。\n\n'
        + (this.data.counted
          ? '已计入上冰天数/次数；正文里写了时长的也算进了时长（没写的按 0 分钟）。\n想撤掉可以说「恢复导入前」。'
          : '它们不计入上冰天数/时长/周目标，只会在搜索和日历当天里出现。'),
      showCancel: false,
      confirmText: '好'
    });
  }
});

// 按行切成 ≤limit 字的块（尽量不切在句子中间）
function splitChunks(text, limit) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = '';
  lines.forEach(l => {
    if (cur && (cur.length + l.length + 1) > limit) { out.push(cur); cur = ''; }
    cur = cur ? (cur + '\n' + l) : l;
  });
  if (cur.trim()) out.push(cur);
  return out;
}

function friendlyCloudErr(err) {
  const s = String((err && (err.errMsg || err.message)) || '');
  if (/no baseresponse|FunctionName not found|-501000/i.test(s)) return '云函数 deepseek 没部署好（右键 cloudfunctions/deepseek → 上传并部署：云端安装依赖）';
  if (/timeout/i.test(s)) return '超时了，分小一点再试';
  return s || '未知错误';
}
