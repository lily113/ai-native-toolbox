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

// 生成记录对象（交给调用方决定要不要存）
function toRecord(item) {
  var text = String(item.text || '');
  var id = 'imp_' + String(item.date).replace(/-/g, '') + '_' + hash(text);
  return {
    id: id, date: item.date, type: 'ice', mode: 'self', duration: 0,
    moves: [], drills: [], examPicks: [], itemOrder: [], content: text, notes: [],
    landCats: [], time: '', coach: '', lessonSummary: '', status: 'done', feel: 0,
    noteOnly: true, src: 'import'
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

module.exports = { splitByDate, toRecord, preview, todayKey };
