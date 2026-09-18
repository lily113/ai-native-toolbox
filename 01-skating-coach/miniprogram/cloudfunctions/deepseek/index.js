const https = require('https');
const KB = require('./kb_data');

// ============================================================
// 知识库检索：按「项目(discipline) + 赛季」过滤 + 关键词打分
// 数据来源：滑冰官方资料/生成云函数知识库.py 生成的 kb_data.js
// ============================================================

const DICT = KB.dict;
const RAW = KB.chunks || [];

// 展开为对象数组（冷启动一次）
const CHUNKS = RAW.map((r, i) => ({
  i,
  discipline: DICT.disciplines[r[0]],
  doc: DICT.docs[r[1]],
  season: DICT.seasons[r[2]],
  lang: DICT.langs[r[3]],
  official: !!r[4],
  verified: !!r[5],
  outdated: !!r[6],
  page: r[7],
  section: r[8] || '',
  text: r[9] || '',
  lower: (r[9] || '').toLowerCase(),
  secLower: (r[8] || '').toLowerCase(),
  docLower: (DICT.docs[r[1]] || '').toLowerCase(),
}));
const CURRENT_SEASON = KB.currentSeason || '2026-2027';

// ---------- 项目识别 ----------
const DISC_KEYWORDS = [
  ['dance', ['冰舞', '冰上舞蹈', '图案舞', '韵律舞', '自由舞', '捻转步', 'twizzle', 'pattern dance', 'rhythm dance', 'free dance', 'waltz', '华尔兹', '探戈', 'tango', '伦巴', 'rhumba', '快步', 'quickstep', 'key point', '关键点', 'dance lift', '托举', '规定舞']],
  ['pair', ['双人滑', '双人', 'pair', '捻转托举', '抛跳', 'twist lift', 'death spiral', '燕式旋转托举']],
  ['synchro', ['队列滑', '同步滑', 'synchro', 'synchronized']],
  ['exam', ['考级', '等级测试', '测试大纲', '大纲', '步法表演', '基础级', '一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级', '成人单人滑', '测试内容']],
  ['single', ['单人滑', '自由滑', '短节目', '跳跃', '旋转', '接续步', 'step sequence', '阿克塞尔', '勾手跳', '点冰跳', '结环跳', '跳跃', 'spin', 'jump']],
];

function detectDiscipline(q) {
  const s = String(q || '').toLowerCase();
  const hits = [];
  DISC_KEYWORDS.forEach(([d, words]) => {
    let n = 0;
    words.forEach(w => { if (s.indexOf(w) >= 0) n++; });
    if (n) hits.push([d, n]);
  });
  if (!hits.length) return null;
  hits.sort((a, b) => b[1] - a[1]);
  return hits[0][0];
}

// ---------- 赛季识别 ----------
function detectSeason(q) {
  const s = String(q || '');
  const m = s.match(/(20\d{2})\s*[-/–]\s*(\d{2,4})/);
  if (m) {
    const a = m[1], b = m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2];
    return a + '-' + b;
  }
  const y = s.match(/(20\d{2})\s*年/);
  if (y) return y[1];
  if (/上赛季|去年|以前|旧规则|历史/.test(s)) return 'history';
  return null;
}


// ---------- 中→英 术语映射（解决"中文提问、英文原文排不进来"的跨语言问题） ----------
const TERM_MAP = [
  // 单人滑技术动作
  ['接续步', ['step sequence', 'steps']],
  ['旋转', ['spin', 'spins']],
  ['跳跃', ['jump', 'jumps']],
  ['跳接', ['flying']],
  ['联合旋转', ['combination spin']],
  ['燕式旋转', ['camel spin']],
  ['蹲踞旋转', ['sit spin']],
  ['直立旋转', ['upright spin']],
  ['换足', ['change of foot']],
  ['落冰', ['landing']],
  ['起跳', ['take-off']],
  ['用刃', ['edge']],
  ['换刃', ['change of edge']],
  ['转三', ['three turn']],
  ['括弧', ['bracket']],
  ['内勾', ['rocker']],
  ['外勾', ['counter']],
  ['结环', ['loop']],
  ['捻转步', ['twizzle', 'twizzles']],
  ['莫霍克', ['mohawk']],
  ['乔克塔', ['choctaw']],
  ['压步', ['crossover']],
  // 项目与节目
  ['单人滑', ['single skating']],
  ['双人滑', ['pair skating', 'pairs']],
  ['冰舞', ['ice dance']],
  ['队列滑', ['synchronized skating', 'synchro']],
  ['短节目', ['short program']],
  ['自由滑', ['free skating', 'free program']],
  ['韵律舞', ['rhythm dance']],
  ['自由舞', ['free dance']],
  ['图案舞', ['pattern dance']],
  ['规定舞', ['compulsory dance', 'pattern dance']],
  ['关键点', ['key point', 'key points']],
  ['同步捻转步', ['synchronized twizzles']],
  ['舞蹈托举', ['dance lift']],
  ['托举', ['lift']],
  ['抛跳', ['throw jump']],
  ['捻转托举', ['twist lift']],
  // 规则 / 评分
  ['定级', ['levels of difficulty', 'level']],
  ['等级条件', ['levels of difficulty', 'requirements']],
  ['难度等级', ['levels of difficulty']],
  ['基础分', ['base value', 'scale of values']],
  ['分值', ['scale of values', 'base value']],
  ['加分', ['GOE', 'positive']],
  ['扣分', ['deduction', 'GOE']],
  ['节目内容分', ['program components']],
  ['技术分', ['technical elements score']],
  ['失误', ['error']],
  ['跌倒', ['fall']],
  ['超时', ['time violation', 'duration']],
  ['音乐', ['music']],
  ['服装', ['costume']],
  ['规定动作', ['required elements']],
  ['节奏', ['rhythm', 'tempo']],
  ['时长', ['duration', 'time']],
  // 考级
  ['等级测试', ['level test']],
  ['步法表演', ['step sequence']],
  ['测试', ['test']],
];

function expand(qLower) {
  const add = [];
  TERM_MAP.forEach(([zh, ens]) => {
    if (qLower.indexOf(zh) >= 0) add.push.apply(add, ens);
  });
  return add;
}

// ---------- 关键词切词（中文二元组 + 英文词 + 文书号 + 术语扩展） ----------
const STOP = new Set(['什么', '怎么', '如何', '为什么', '可以', '需要', '应该', '一下', '吗？', '的呢', '这个', '那个']);
function tokens(q) {
  const s = String(q || '').toLowerCase();
  const typedEn = new Set();   // 用户直接写的英文/代码（权重最高）
  const zh = new Set();        // 中文二元组
  const expEn = new Set();     // 由中文术语扩展出的英文
  // 允许以数字开头的动作代码（2Lz / 3T / 1A / 4S），以及普通英文词
  (s.match(/\d+[a-z][a-z0-9]*|[a-z][a-z0-9\-\.<>]{1,}/g) || []).forEach(w => typedEn.add(w));
  (s.match(/\b(\d{4})\b/g) || []).forEach(w => typedEn.add(w));
  expand(s).forEach(w => {
    const t = w.toLowerCase();
    if (!typedEn.has(t)) expEn.add(t);
  });
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, ' ');
  cjk.split(/\s+/).forEach(seg => {
    for (let i = 0; i < seg.length - 1; i++) {
      const g = seg.slice(i, i + 2);
      if (!STOP.has(g)) zh.add(g);
    }
  });
  return { typedEn: Array.from(typedEn), expEn: Array.from(expEn), zh: Array.from(zh) };
}

function coverage(c, list, secWeight, docWeight) {
  if (!list.length) return 0;
  let hit = 0;
  for (const t of list) {
    if (c.lower.indexOf(t) >= 0) { hit += 1; continue; }
    if (secWeight && c.secLower.indexOf(t) >= 0) { hit += secWeight; continue; }
    if (docWeight && c.docLower.indexOf(t) >= 0) { hit += docWeight; }
  }
  return hit / list.length;
}

// ---------- 检索 ----------
function retrieve(q, opts) {
  opts = opts || {};
  const disc = detectDiscipline(q);
  const seasonWanted = detectSeason(q);
  const tk = tokens(q);
  const qLower = String(q || '').toLowerCase().trim();
  const docNoMatch = qLower.match(/\b(2\d{3})\b/);

  const scored = [];
  for (const c of CHUNKS) {
    // 项目过滤：识别出具体项目时，只保留该项目 + 通用
    if (disc && c.discipline !== disc && c.discipline !== 'general') continue;

    const covTyped = coverage(c, tk.typedEn, 0.6, 1);   // 手打英文/代码
    const covExp = coverage(c, tk.expEn, 0.5, 0.6);     // 术语扩展英文
    const covZh = coverage(c, tk.zh, 0.5, 0.5);         // 中文词
    if (!covTyped && !covExp && !covZh) continue;

    let s = covTyped * 110 + covExp * 42 + covZh * 55;
    // 项目精确匹配（考级/队列滑语料小，加成更高以保证优先）
    if (disc && c.discipline === disc) s += (disc === 'exam' || disc === 'synchro') ? 90 : 45;
    // 语言权威性
    if (c.lang === 'en-official') s += 12;
    else if (c.lang === 'zh-official') s += 6;
    else if (c.lang === 'zh-translation') s -= 4;
    // 问「基础分/分值」并带动作代码（2Lz/3T/1A…）→ 优先分值表（SOV）
    const hasCode = tk.typedEn.some(t => /^\d[a-z]/.test(t));
    const wantsValue = /基础分|分值|多少分|几分|base value|sov/i.test(q);
    if (hasCode && wantsValue && /scale of values|sov|分值/i.test(c.doc)) s += 40;
    // 文书号 / 整句
    if (docNoMatch && c.docLower.indexOf(docNoMatch[1]) >= 0) s += 25;
    if (qLower.length >= 6 && c.lower.indexOf(qLower) >= 0) s += 30;
    // 赛季
    if (c.outdated) s -= 12;
    if (c.season === CURRENT_SEASON || !c.season) s += 6;
    if (seasonWanted && seasonWanted !== 'history' && c.season === seasonWanted) s += 30;
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);

  // 赛季过滤：默认排除历史条目（除非明确问历史/旧赛季，或当季命中不足）
  // 用户明确问某个旧赛季（或“历史/旧规则”）时，不要过滤掉历史条目
  const wantHistory = seasonWanted === 'history' || (!!seasonWanted && seasonWanted !== CURRENT_SEASON);
  let picked = scored.filter(x => wantHistory || !x.c.outdated);
  if (!wantHistory && picked.length < 3) {
    const extra = scored.filter(x => x.c.outdated).slice(0, 3 - picked.length);
    picked = picked.concat(extra);
  }
  const top = picked.slice(0, opts.k || 5);

  // 组装上下文（带出处）
  const LIMIT = opts.limit || 4500;
  let used = 0, ctx = [], sources = [];
  top.forEach((x, n) => {
    const c = x.c;
    const langTag = c.lang === 'en-official' ? 'ISU 官方英文原文'
      : c.lang === 'zh-translation' ? '中文翻译（未与原文核对）'
      : c.lang === 'zh-official' ? '国家官方文件'
      : c.lang === 'zh-summary' ? '整理版（非官方）' : '个人笔记';
    const seasonTxt = c.season ? (/^\d{4}$/.test(c.season) ? c.season + ' 年' : c.season + ' 赛季') : '';
    const headBits = [seasonTxt, c.outdated ? '⚠️历史版本，可能已过期' : '', langTag, c.page ? '第 ' + c.page + ' 页' : ''].filter(Boolean);
    const head = '【片段' + (n + 1) + '】' + c.doc + '（' + headBits.join(' · ') + '）'
      + (c.section ? '\n章节：' + c.section : '');
    const body = c.text.slice(0, Math.max(600, LIMIT - used));
    ctx.push(head + '\n' + body);
    sources.push({ doc: c.doc, season: c.season, page: c.page, lang: c.lang, outdated: c.outdated, discipline: c.discipline });
    used += body.length + head.length;
    if (used >= LIMIT) return;
  });
  return { text: ctx.join('\n\n'), sources, discipline: disc, season: seasonWanted };
}

// ============================================================
// 系统提示词
// ============================================================
const USER_PROFILE = '【用户画像】提问者是成年业余花样滑冰练习者：主项单人滑（自由滑 + 步法表演，备考中国花样滑冰等级测试），计划后续练习冰舞。回答默认按单人滑口径；若问题涉及冰舞/双人滑/队列滑，切换到对应规则口径。';

const CITATION_RULES =
  '【必须带出处】凡用到知识库片段，就在相关结论后用括号注明来源与位置，例如：' +
  '（依 ISU Communication 2788，2026-27 赛季）／（依 ISU Sports Rules 2026, Rule 353）／（依 ISU 技术组手册·单人滑，第 4 页）／（依《国家花样滑冰等级测试大纲（第2版）》相关级别）' +
  '。不要编造条款号或页码；片段里没有页码就只写文书名。' +
  '【翻译声明】若片段标注为「中文翻译（未与原文核对）」，引用时必须补一句："该条为中文翻译、尚未与 ISU 英文原文逐条核对，涉及定级/扣分等精确判定请以 ISU 官网原文为准。"' +
  '【赛季优先】默认只依据最新赛季（' + CURRENT_SEASON + '）与长期有效的规定；若片段标了"⚠️历史版本"，引用时必须说明"这是旧赛季版本，现行规则可能已变化"。若用户明确问某旧赛季，才按旧赛季回答并注明。' +
  '【项目对应】先判断问题属于 单人滑 / 双人滑 / 冰舞 / 队列滑 / 考级，再用对应项目的资料回答，不要把冰舞的要求套到单人滑上（反之亦然）。' +
  '【范围与尺度】只回答花样滑冰训练、技术、规则、评分、考级相关的问题；与滑冰无关的请求礼貌拒答。涉及伤痛请提醒就医。' +
  '【排版要求（手机屏幕窄）】可以用 Markdown 表格做对比，但**列数不超过 3 列、每格文字尽量短（≤12 字）**；表格前用一句话说明它对比的是什么；不要用表格排长句。' +
  '不要输出特殊符号字符（§、箭头符号、图形字体字符等），用常规中文标点；列表用「- 」开头，多级用「1. 」编号。内容分小节，每节不超过 5 条，避免长篇大段。';

const SYSTEM = '你是资深花样滑冰教练（训练/规则答疑），熟悉单人滑、双人滑、冰舞、队列滑的技术动作、ISU 规则与评分体系，以及中国花样滑冰等级测试。回答先讲关键要点再展开，术语准确、可落地。' +
  USER_PROFILE +
  '【知识优先级】①ISU 官方英文原文是最高权威；②国家官方文件（《国家花样滑冰等级测试大纲》、全国技术规则等）在其适用范围内权威；③ISU 官方中译次之（未核对原文）；④术语参考与个人笔记只作补充。冲突时以更高优先级为准。' +
  '【名称规范】中国花样滑冰协会主办的等级测试，**规范名称是「国家花样滑冰等级测试」**（文件如《国家花样滑冰等级测试大纲（第2版）》《国家花样滑冰等级测试大纲修订内容》）。' +
  '不要写成「中国等级测试」「国家滑冰等级测试」等变体；提到时用全称或规范简称（国家等级测试）。级别名称用大纲原文：基础级、一级…十级、成人单人滑；项目用「单人滑（自由滑 / 步法表演）」「双人滑」「冰上舞蹈」。' +
  '【考级回答的边界】若知识库只覆盖部分级别或只有修订公告，要明确说明「未覆盖的级别请以《国家花样滑冰等级测试大纲（第2版）》原文为准」，不要用 ISU 竞技规则推定考级要求。' +
  CITATION_RULES +
  '【诚实原则】资料未覆盖或你不确定时，要明确说"这个不确定，建议查 ISU 原文或咨询教练"，绝不臆测、编造。' +
  '【定义诚实】被问到动作/转体定义时，若资料只有列举没有定义，必须说"资料未包含该动作的正式定义，建议查 ISU 原文/问教练"，禁止拿相邻步法描述或自行推理编解释。';

const NOTE_SYSTEM = '你是花样滑冰课堂笔记整理助手。用户会给你一段课堂口述或草稿（可能口语化、有错字、重复、漏词、没标点），请你整理成一份标准课堂笔记，用 Markdown 分节输出，只保留实际提到的内容，按以下顺序（某节没有内容就整节省略）：\n' +
  '## 训练内容\n本课实际训练的项目/动作/组合，尽量保留组数、次数、时长。\n' +
  '## 技术要点\n教练讲解的要领：发力、重心、用刃、节奏、姿态等。\n' +
  '## 教练提醒\n教练指出的问题与纠正方法。\n' +
  '## 待改进 / 下次目标\n待改进项、教练布置的练习、下次课目标。\n' +
  '要求：\n' +
  '1. 只整理确实出现过的内容，严禁添加没有的动作、要领、成绩或安排；没听清写「（未听清，请确认）」。\n' +
  '2. 把口语理顺成书面语，可修正明显错字/同音词（如「内沟」→「内勾(步)」、「捻砖步」→「捻转步」），但不得改动事实与数字。\n' +
  '3. 拿不准的术语不要硬猜，保留原文并紧跟「（疑似听错？请确认）」。\n' +
  '4. 可直接输出笔记正文，不要寒暄、不要复述原文。';

function callDeepSeek(messages, key) {
  const body = JSON.stringify({ model: 'deepseek-chat', messages: messages, temperature: 0.4, max_tokens: 4000 });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.main = async (event) => {
  const mode = (event && event.mode) === 'note' ? 'note' : 'coach';
  const q = String((event && event.question) || '').trim();
  if (!q) return { answer: '请说点什么' };
  const key = process.env.DEEPSEEK_KEY;
  if (!key) return { answer: '云函数未配置 DEEPSEEK_KEY 环境变量（在云开发控制台给 deepseek 配环境变量后重新部署）' };

  const hit = retrieve(q);
  const ctx = hit.text;
  const sys = mode === 'note'
    ? (NOTE_SYSTEM + (ctx ? '\n\n【可参考知识库片段】\n' + ctx : ''))
    : (SYSTEM + (ctx ? '\n\n【可参考知识库片段】\n' + ctx : ''));
  const userContent = mode === 'note' ? ('我的课堂口述/草稿（请整理成标准课堂笔记）：\n' + q) : q;

  try {
    const res = await callDeepSeek([
      { role: 'system', content: sys },
      { role: 'user', content: userContent }
    ], key);
    let j = {};
    try { j = JSON.parse(res.body); } catch (e) {}
    if (res.status < 200 || res.status >= 300) {
      return { answer: 'DeepSeek 返回错误 ' + res.status + '：' + ((j.error && j.error.message) || j.message || res.body.slice(0, 120)) };
    }
    const reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '(空回复)';
    return { answer: reply, sources: hit.sources, discipline: hit.discipline, season: hit.season };
  } catch (e) {
    return { answer: '云函数异常：' + e.message };
  }
};

// 便于本地测试
exports._retrieve = retrieve;
exports._chunks = CHUNKS;
