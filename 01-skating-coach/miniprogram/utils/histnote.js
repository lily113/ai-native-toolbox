// 从「历史笔记」里切出日期 + 内容
//
// 场景：微信收藏 / 备忘录里攒了几年的训练笔记，想一次性搬进来。
// 这类文本没有结构，唯一的锚点是**日期**，所以这里只做一件事：
//   **按日期切段** → 每段变成一条「笔记型记录」（noteOnly: true，不进任何上冰统计）。
//
// 刻意不做的事：
//   · 不去解析"练了什么动作"（认不准，认错比不认更糟）
//   · 不猜时长（历史笔记里通常没有，猜出来的数字会污染统计）
//   · 日期有歧义就**标出来**，让人自己看一眼，而不是硬猜

var MONTH_RE = '(\\d{1,2})';
var DAY_RE = '(\\d{1,2})';
var PAD = function (n) { return String(n).padStart(2, '0'); };

// 一行开头的日期锚点（允许前面有 ·、-、1.、emoji、空白）
var DATE_RE = new RegExp(
  '^[\\s\\u3000\\-*·•、.,，。:：\\t]*(?:' +
  '(\\d{4})\\s*[\\-/.年]\\s*' + MONTH_RE + '\\s*[\\-/.月]\\s*' + DAY_RE + '\\s*日?' +   // 2024-03-15 / 2024.3.15 / 2024年3月15日
  '|' +
  MONTH_RE + '\\s*[\\-/.月]\\s*' + DAY_RE + '\\s*日?' +                               // 3月15日 / 3.15 / 3/15
  ')'
);

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + PAD(d.getMonth() + 1) + '-' + PAD(d.getDate());
}
function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function key(y, m, d) { return y + '-' + PAD(m) + '-' + PAD(d); }

// 主函数：把一大段文字切成 [{date, text, ambiguous}]
// opts.today  —— 用来判断"没写年份"的条目该是哪一年（测试时可注入）
function splitByDate(raw, opts) {
  var today = (opts && opts.today) || todayKey();
  var tY = Number(today.slice(0, 4));
  var lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');

  var items = [];
  var cur = null;
  var lastYear = 0;        // 最近一次明确写出的年份
  var noDate = [];         // 第一段日期之前的内容（通常是一句说明）
  var ambiguous = 0;

  function push() {
    if (!cur) return;
    var text = cur.lines.join('\n').trim();
    if (!text) { cur = null; return; }
    items.push({ date: cur.date, text: text, ambiguous: !!cur.ambiguous });
    cur = null;
  }

  lines.forEach(function (line) {
    var m = line.match(DATE_RE);
    if (!m) {
      if (cur) cur.lines.push(line);
      else if (line.trim()) noDate.push(line.trim());
      return;
    }
    var y, mo, dy, hasYear;
    if (m[1]) { y = Number(m[1]); mo = Number(m[2]); dy = Number(m[3]); hasYear = true; }
    else { y = 0; mo = Number(m[4]); dy = Number(m[5]); hasYear = false; }

    var amb = false;
    if (hasYear) {
      lastYear = y;
    } else {
      // 没写年份：沿用最近一次写过的年份；一次都没写过就用今年，
      // 但如果拼出来的日期在未来（说明这是"去年 12 月"这种跨年笔记），回退一年
      y = lastYear || tY;
      if (!lastYear && key(y, mo, dy) > today) { y = y - 1; amb = true; }
      if (!lastYear) amb = true;
    }
    if (!validDate(y, mo, dy)) {          // 不是日期（比如 "3/5 个"），当成正文
      if (cur) cur.lines.push(line);
      return;
    }
    push();
    cur = { date: key(y, mo, dy), lines: [line.slice(m[0].length).replace(/^[\s:：\-—·、,，.。]*/, '')], ambiguous: amb };
    if (amb) ambiguous++;
  });
  push();

  // 内容太长的截断（一条记录正文最多 2000 字）
  items = items.map(function (it) {
    return { date: it.date, text: it.text.slice(0, 2000), ambiguous: it.ambiguous };
  });

  return { items: items, noDate: noDate.join('\n').trim(), ambiguous: ambiguous, today: today };
}

// 从正文里抽时长：「90 分钟」/「1.5 小时」/「1 小时 30 分钟」/「2 节」
// 抽不到就返回 0 —— **绝不猜**。一节按 30 分钟算（和 app 里 1 节 = 30 分钟的规则一致）。
var DUR_RE = [
  { re: /(\d+(?:\.\d+)?)\s*个?小时\s*(\d+)\s*分钟/, mins: function (m) { return Number(m[1]) * 60 + Number(m[2]); } },
  { re: /(\d+(?:\.\d+)?)\s*个?\s*(?:小时|hour|hr|h)(?![a-z])/i, mins: function (m) { return Number(m[1]) * 60; } },
  { re: /(\d+(?:\.\d+)?)\s*(?:分钟|min(?![a-z]))/i, mins: function (m) { return Number(m[1]); } },
  { re: /(\d+)\s*节/, mins: function (m) { return Number(m[1]) * 30; }, units: true }
];
function extractDuration(text) {
  var s = String(text || '');
  for (var i = 0; i < DUR_RE.length; i++) {
    var d = DUR_RE[i];
    var m = s.match(d.re);
    if (!m) continue;
    var v = Math.round(d.mins(m));
    if (!(v > 0) || v > 600) continue;         // 超过 10 小时当误认，忽略
    return { duration: v, units: d.units ? Number(m[1]) : 0 };
  }
  return { duration: 0, units: 0 };
}

// 生成记录对象（交给调用方决定要不要存）
// opts.counted === true  → 当作真实训练记录（计入天数/时长统计）
// opts.counted !== true  → 只当笔记（noteOnly，不进任何统计）
function toRecord(item, opts) {
  var o = opts || {};
  var text = String(item.text || '');
  var id = 'imp_' + String(item.date).replace(/-/g, '') + '_' + hash(text);
  var dur = o.counted ? extractDuration(text) : { duration: 0, units: 0 };
  return {
    id: id, date: item.date, type: item.kind === 'land' ? 'land' : 'ice', mode: 'self',
    duration: dur.duration, units: dur.units,
    moves: [], drills: [], examPicks: [], itemOrder: [], content: text, notes: [],
    landCats: [], time: '', coach: '', lessonSummary: '', status: 'done', feel: 0,
    noteOnly: o.counted ? false : true, src: 'import'
  };
}
function hash(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 预览：哪些是新的、哪些已经有（同日期 + 同内容）
function preview(raw, records, opts) {
  var parsed = splitByDate(raw, opts);
  var have = {};
  (records || []).forEach(function (r) {
    if (!r || !r.date) return;
    have[r.date + '|' + String(r.content || '').trim()] = 1;
  });
  var seen = {};
  var fresh = [], dup = [];
  parsed.items.forEach(function (it) {
    var k = it.date + '|' + it.text.trim();
    if (have[k] || seen[k]) { dup.push(it); return; }
    seen[k] = 1;
    fresh.push(it);
  });
  return {
    items: parsed.items, fresh: fresh, dup: dup, noDate: parsed.noDate,
    ambiguous: parsed.ambiguous, today: parsed.today
  };
}

// ============================================================
// 「让用户自己的 AI 转格式」用的提示词
// 思路：把"各种写法"这件麻烦事交给用户手里任意一个 AI，我们只认一种固定格式。
// 比走我们自己的云函数更好：不花我们的钱、不依赖某个平台、用户能自己追问和纠错。
// 输出格式跟云函数那条分支完全一致，所以清洗规则也是一套。
// ============================================================
var AI_PROMPT = [
  '你是数据整理助手。下面是我自己的训练笔记（写法不统一、可能有错别字和口语）。',
  '请按日期切成一条一条，只输出 JSON，不要解释、不要代码块。',
  '',
  '输出格式：',
  '{"entries":[{"date":"YYYY-MM-DD","kind":"ice","text":"这一条的原文"}],"rest":"无法归入任何日期的内容"}',
  '',
  '规则：',
  '1. date 必须是原文里能看到的日期（如 2024-03-15 / 2024.3.15 / 3月15日 / 3/15）。',
  '   没写年份但有上下文就补上；推不出来就留空字符串。绝对不许编日期（这条最重要）。',
  '2. kind 只能是 ice（冰上、上冰、冰场课）、land（陆地、体能、软开、舞蹈）、',
  '   other（考级要点、心情、与训练无关）。拿不准就写 other。',
  '3. text 必须原文照抄（可以去掉开头的日期本身），不许改写、总结、润色、补充。',
  '4. 不要输出时长、节数、动作编号、评分。原文里本来写了「90 分钟」就留在 text 里，',
  '   但不要另设字段。',
  '5. 一条日期一段；同一天的多段内容合并成一条，用换行分隔。',
  '6. 空行、分割线、==== 之类不属于内容。',
  '7. 如果整段没有日期、也不是按日期组织的，entries 用空数组，原文放进 rest。'
].join('\n');

// 解析 AI 给的 JSON（容错：去掉代码块、截取第一个 { ... }、字段白名单、日期校验）
// 跟云函数里的 _parseEntries 是同一套规则 —— 测试里会拿同一份样例比对两边输出，防止跑偏。
function parseAiJson(raw) {
  var s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^```(?:json|JSON)?/, '').replace(/```$/, '').trim();
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  var obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  var KINDS = { ice: 1, land: 1, other: 1 };
  var list = Object.prototype.toString.call(obj.entries) === '[object Array]' ? obj.entries : [];
  var entries = [];
  list.slice(0, 300).forEach(function (x) {
    if (!x || typeof x !== 'object') return;
    var text = String(x.text == null ? '' : x.text).slice(0, 2000).trim();
    if (!text) return;
    var d = String(x.date == null ? '' : x.date).trim().slice(0, 10);
    var date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
    if (date) {
      var p2 = date.split('-').map(Number);
      var dt = new Date(p2[0], p2[1] - 1, p2[2]);
      if (!(dt.getFullYear() === p2[0] && dt.getMonth() === p2[1] - 1 && dt.getDate() === p2[2])) date = '';
    }
    var kind = KINDS[String(x.kind || '').toLowerCase()] ? String(x.kind).toLowerCase() : 'other';
    entries.push({ date: date, kind: kind, text: text });
  });
  return { entries: entries, rest: String(obj.rest == null ? '' : obj.rest).slice(0, 2000) };
}

// 粘进来的东西是"AI 给的 JSON"还是"原始笔记"？—— 自动判断，用户不用选
function looksLikeAiJson(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return false;
  s = s.replace(/^```(?:json|JSON)?/, '').trim();   // AI 常把 JSON 包在代码块里
  if (!/[{[]/.test(s.slice(0, 4))) return false;
  return /"entries"|\bentries\s*:/.test(s) || /["']date["']\s*:/.test(s);
}

module.exports = { splitByDate, toRecord, preview, todayKey, AI_PROMPT, parseAiJson, looksLikeAiJson, extractDuration };
