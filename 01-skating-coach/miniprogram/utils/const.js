// 版本号：**每次发布前必须 +1**（最后一段递增）。升级保护靠它判断"是不是换版本了"：
// 换版本 → 启动时先本地快照 + 记数据指纹，迁移后再校验有没有变少。
const APP_VERSION = '2026.10.08.21';

// ---------- 对外发布的功能开关 ----------
// 姿态自查：真机上 VisionKit 关键点识别还没跑通（返回 0 个关键点），对外先隐藏。
// 要放出来：把这里改成 true，并在 app.json 的 pages 里恢复 "pages/pose/pose"。
const POSE_ENABLED = false;

const TYPES = {
  ice:   { name: '上冰', emoji: '⛸️' },
  land:  { name: '陆地', emoji: '🏋️' },
  rehab: { name: '康复', emoji: '💪' }
};
const MODES = {
  self:   { name: '🤸 自己训练' },
  lesson: { name: '📖 上课' }
};
// 动作分类：默认表（用户可在「动作库 → 分类管理」里改名 / 新增 / 排序 / 删除）
//   id = 内部标识，动作记录按 id 关联，改名不影响历史记录
// 分类只是「动作库怎么分组」；训练记录里点动作名一律会把它下面的组合一起勾上
const DEFAULT_CATS = [
  { id: 'warm',  name: '热身' },
  { id: 'step',  name: '步法' },
  { id: 'spin',  name: '旋转' },
  { id: 'jump',  name: '跳跃' },
  { id: 'topic', name: '专题练习' },
  { id: 'other', name: '其他' }
];
const CAT_FALLBACK = 'other';   // 兜底分类：固定存在且排在最后，不可删除
// 首次升级到「可编辑分类」时自动补进动作库的预置动作
//   专题练习 = 串 / 组 / 综合类，命名统一带 串 / 练习 / 组合 后缀，与其他板块区分
const CAT_SEED_MOVES = [
  { name: '常规热身',       category: 'warm' },
  { name: '膝关节激活',     category: 'warm' },
  { name: '髋部激活',       category: 'warm' },
  { name: '变刃步伐串',     category: 'topic' },
  { name: '膝关节韵律练习', category: 'topic' },
  { name: '胯的练习',       category: 'topic' }
];
// 兼容旧代码的静态表（页面请改用 store.cats() / store.catName()）
const CATS = {};
DEFAULT_CATS.forEach(c => { CATS[c.id] = { name: c.name }; });
const CAT_ORDER = DEFAULT_CATS.map(c => c.id);
const DEFAULT_MOVES = [
  // 跳跃（6 种官方跳型）
  { name: '后内结环跳', category: 'jump' },  // Salchow
  { name: '后外点冰跳', category: 'jump' },  // Toe Loop
  { name: '后外结环跳', category: 'jump' },  // Loop
  { name: '后内点冰跳', category: 'jump' },  // Flip
  { name: '勾手跳', category: 'jump' },      // Lutz
  { name: '阿克塞尔跳', category: 'jump' },  // Axel
  // 旋转（官方姿势 / 结构种类）
  { name: '直立旋转', category: 'spin' },      // Upright
  { name: '蹲踞旋转', category: 'spin' },      // Sit
  { name: '燕式旋转', category: 'spin' },      // Camel
  { name: '躬身旋转', category: 'spin' },      // Layback
  { name: '联合旋转', category: 'spin' },      // Combination
  { name: '换足旋转', category: 'spin' },      // Change foot
  // 步法（按官方转体 / 步法种类）
  { name: '前压步', category: 'step' },
  { name: '后压步', category: 'step' },
  { name: '转3', category: 'step' },
  { name: '括弧步', category: 'step' },
  { name: '内勾步', category: 'step' },
  { name: '外勾步', category: 'step' },
  { name: '捻转步', category: 'step' },
  { name: '结环步', category: 'step' },
  { name: '莫霍克步', category: 'step' },
  { name: '乔克塔步', category: 'step' },
  // 其他
  { name: '接续步', category: 'other' },
  { name: '燕式步', category: 'other' }
];
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const ICE_THRESHOLDS = [1, 10, 50, 100, 365, 500, 1000];
const HOURS_THRESHOLDS = [100, 500, 1000];

const MS_TYPES = [
  { k: 'skates', name: '上冰纪念', emoji: '⛸️' },
  { k: 'exam', name: '考级', emoji: '🎖️' },
  { k: 'competition', name: '比赛', emoji: '🏆' },
  { k: 'first', name: '第一次', emoji: '🌟' },
  { k: 'recovery', name: '康复', emoji: '💪' },
  { k: 'custom', name: '自定义', emoji: '✨' }
];

// 姿态自查：需要校准的关键点（顺序即校准顺序）
const POSE_JOINTS = [
  { k: 'head',    n: '头（头顶或鼻）' },
  { k: 'neck',    n: '颈 / 肩中点' },
  { k: 'shL',     n: '左肩' },
  { k: 'shR',     n: '右肩' },
  { k: 'hipL',    n: '左髋' },
  { k: 'hipR',    n: '右髋' },
  { k: 'kneeL',   n: '左膝' },
  { k: 'kneeR',   n: '右膝' },
  { k: 'ankL',    n: '左踝' },
  { k: 'ankR',    n: '右踝' }
];

// 上课形式（仅“上课”记录用）
const LESSON_FORMS = {
  one:   { name: '一对一' },
  two:   { name: '一对二' },
  multi: { name: '一对多' }
};

// ---------- 考级备考 ----------
// 级别划分依据《国家花样滑冰等级测试大纲（第2版）》第一章 总则：
//   单人滑：步法表演节目 基础级至10级，自由滑 1至10级
//   成人单人滑：步法表演节目 1至6级，自由滑 1至6级
//   冰上舞蹈：1至6级        双人滑：1至3级
const EXAM_KINDS = {
  free:  { name: '自由滑' },
  steps: { name: '步法' },
  dance: { name: '冰上舞蹈' },
  adult: { name: '成人' },
  pair:  { name: '双人滑' }
};
const EXAM_SECTIONS = {
  free: ['我的要点'],
  steps: ['我的要点'],
  dance: ['我的要点'],
  adult: ['我的要点'],
  pair: ['我的要点']
};

// ---------- 内置考纲骨架 ----------
// ⚠️ 版权与做法（重要，改这里之前先读）：
//   《国家花样滑冰等级测试大纲（第2版）》由 中国花样滑冰协会 审定、**人民体育出版社**出版
//   （ISBN 978-7-5009-6516-9，版权页写明「版权所有·侵权必究」），是受著作权保护的出版物。
//   所以这个 App **只内置「结构」**——级别、官方分节名称、以及用户自己写的内容；
//   **不复制官方正文**（要点、评判说明等正文一律留空，由用户自己在「我的要点」里记）。
//   官方原文请查阅纸质书或官方渠道。
const SYLLABUS_SOURCE = '《国家花样滑冰等级测试大纲（第2版）》· 中国花样滑冰协会 审定 · 人民体育出版社';

// 每个项目的官方分节名称（取自原书目录，只有"节的名字"，没有正文）
// ⚠️ key 必须全是 ASCII：列表页跳转详情页时会把 id（= sy_ + key）拼进 navigateTo 的 URL，
//    中文/非 ASCII 参数会被转坏 → 详情页找不到 → 报「考级不存在」。level 才是给人看的中文名。
// 每个项目保留哪些官方分节（只留真正有用的：要考什么 + 时长/节奏；
// 散文式的"简介/目的和任务"、以及多数级别本来是空的"本级步法明细"都不放，免得点开一堆空盒子）
const SYL_SECTIONS = {
  steps: [
    { key: 'key-steps', name: '重点步法说明' },
    { key: 'test', name: '时间与节奏' }
  ],
  free: [
    { key: 'content', name: '测试内容' }
  ],
  dance: [
    { key: 'content', name: '测试内容' },
    { key: 'test', name: '测试标准明细' }
  ],
  pair: [
    { key: 'content', name: '测试内容' },
    { key: 'test', name: '测试要求' }
  ]
};
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 生成一个级别的骨架条目：官方分节全部留空 + 一个可编辑的「我的要点」
//   kind    = 归到哪个项目（决定列表分组）
//   secKind = 用哪套官方分节名称（成人沿用单人滑的分节）
function sylLevel(kind, level, key, secKind, items) {
  const sections = (SYL_SECTIONS[secKind || kind] || []).map(sec => ({
    key: sec.key,
    name: sec.name,
    // 官方分节默认只读；「本级步法明细」放开成可加条目，方便你自己往里面补
    userAdd: true,   // 官方分节里的条目只读，但允许你自己往里加条目（补原书数字、明细等）
    // items 形如 { 'key-steps': ['前外单足弧线', ...] }，只放要素名称，不放正文
    // 元素可以是字符串（只有标题），也可以是 { title, points, mistakes }（带正文要点）
    items: ((items || {})[sec.key] || []).map((t, i) => (t && typeof t === 'object')
      ? { key: t.key || ('e' + (i + 1)), title: t.title || '', points: (t.points || []).slice(), mistakes: (t.mistakes || []).slice() }
      : { key: 'e' + (i + 1), title: t, points: [], mistakes: [] })
  }));
  sections.push({ key: 'my-points', name: '我的要点', userAdd: true, items: [] });
  return { key: key, kind: kind, level: level, source: SYLLABUS_SOURCE, sections: sections };
}
// pairs = [[显示用的级别名, ASCII key], ...]
function sylRange(kind, pairs, secKind) {
  return pairs.map(p => sylLevel(kind, p[0], p[1], secKind));
}
// 一~十级的中文名
const CN_LEVELS = CN_NUM.map(n => n + '级');

// 单人滑步法表演节目 基础级 + 1–3 级的要素与时长（[级别, key, 重点步法, 时长/节奏]）
// 成人步法 1–6 级原书写明"参考单人滑步法表演节目 1–6 级开展与评判"，所以这份数据两处共用。
const STEPS_REQ = [
    // ⚠️ 步法有两个时长：①「步法部分」的滑行时长 ②「整套节目」（步法+表演节目）的总时长。
    //    基础级/一级/二级只有步法部分，没有表演节目环节，所以只有一个时长。
    ['基础级', 'steps-0', ['左右侧蹬冰滑行', '左前交叉步', '左右单足支撑滑行'],
      ['步法滑行时长：约 1 分钟']],
    ['一级', 'steps-1', ['前外单足弧线', '前内单足弧线', '左、右前交叉步'],
      ['步法滑行时长：1 分 30 秒 ± 10 秒', '音乐节奏：按步法图案中的节奏要求']],
    ['二级', 'steps-2', ['单足后外弧线', '单足后内弧线', '左、右后交叉步'],
      ['步法滑行时长：1 分 35 秒 ± 10 秒', '音乐节奏：按步法图案中的节奏要求']],
    ['三级', 'steps-3', ['前外、后外3字步', '前内、后内3字步'],
      ['步法滑行时长：1 分 10 秒 ± 5 秒', '整套节目时长：1 分 55 秒 ± 5 秒', '音乐节奏：52 小节/分 · 156 拍/分']]
];

// ---------- 单人自由滑 1–10 级：逐级要求 ----------
// 来源：《国家花样滑冰等级测试大纲（第2版）》第三章「单人自由滑等级测试内容」表格（第 128–130 页）。
// 只放事实（时长、动作名称与数量、标准的判定口径），不放书里的正文描述。
const FREE_REQ = [
  { lv: '一级', time: '不超过 1 分钟（无音乐伴奏）',
    jumps: ['W（华尔兹跳）'],
    spins: ['USp-Ⅱ（5 圈），必须 3 字步进入'],
    steps: ['1 个前燕式平衡（3 秒），浮腿任选'],
    moves: ['2 个方向的前交叉蹬冰，每个方向至少连续 3 次'] },
  { lv: '二级', time: '不超过 1 分钟（无音乐伴奏）',
    jumps: ['1S（后内结环一周跳）'],
    spins: ['USp（3 圈），必须 3 字步进入'],
    steps: ['1 个 LFO 燕式平衡（3 秒）', '1 个 RFI 燕式平衡（3 秒）', '2 个燕式平衡中间最多 2 步滑行或步法，顺序任选'],
    moves: ['2 个方向的后交叉蹬冰，每个方向至少连续 3 次'] },
  { lv: '三级', time: '1 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1T', '1Lo', '1F'],
    spins: ['SSp（3 圈）', 'USp-B（3 圈）'],
    steps: ['1 个 RFO 燕式平衡（3 秒）', '1 个 LF 燕式平衡（3 秒）', '2 个燕式平衡中间最多 2 步滑行或步法，顺序任选'],
    moves: ['无'] },
  { lv: '四级', time: '1 分 50 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1Lz', '1A', '1Lo+1Lo'],
    spins: ['CSp（3 圈）', 'CUSp（4+4）', '反直立转单/双臂上手姿态（至少连续 2 圈）'],
    steps: ['1 个 BO 燕式平衡（3 秒）', '1 个 BI 燕式平衡（3 秒）', '必须换足，2 个燕式平衡中间最多 2 步滑行或步法，顺序任选'],
    moves: ['无'] },
  { lv: '五级', time: '2 分 15 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1A+1T+1Lo', '2S', '任选 1 种不同于 2S 的 2 周跳'],
    spins: ['CSSp 男（5+5）/ LSp 女（6）', 'CoSp（8 圈）至少 3 种基本姿势（每种至少转 2 圈）'],
    steps: ['1 个 StSq，充分利用冰面，至少包括 2 个简单或难度的转体步（Turns）和 2 个步法（Steps），每种最多可重复计算 1 次'],
    moves: ['无'] },
  { lv: '六级', time: '2 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1A+2T', '2Lo', '2F', '2Lz'],
    spins: ['CCSp（5+5）', 'CCoSp（6+6）至少 3 种基本姿势，每种至少转 2 圈（每只脚至少 2 种基本姿势）'],
    steps: ['1 个 StSq，充分利用冰面，至少包括 3 个简单或难度的转体步（Turns）和 3 个步法（Steps），每种最多可重复 1 次'],
    moves: ['无'] },
  { lv: '七级', time: '2 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['2A', '2Lo+2Lo', '2F+Eu+2S'],
    spins: ['FCSp（6 圈）', 'CCoSp（6+6）至少 3 种基本姿势（每种至少转 2 圈）', '所有旋转必须达到国际滑联旋转 1 级的定级标准；没达到的按不符合规定执行'],
    steps: ['1 个 StSq，充分利用冰面，至少包括 4 个难度转体步（Turns）/ 步法（Steps），每种最多可重复 1 次'],
    moves: ['难度滑行动作（3 秒），例如：伊娜鲍尔步（Ina Bauer）/ 大一字步（spread eagle）/ 创新滑行动作（Creative Movement）'] },
  { lv: '八级', time: '2 分 40 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['2A', '3T', '任选 1 个 2 周连 2 周的联跳（2+2）'],
    spins: ['FSSp（8 圈）空中必选择蹲踞姿势', '1 种姿势旋转（8 圈），不能跳进入，必须选择不同于蹲踞姿势（不可以做基本直立姿势）', 'CCoSp（6+6）至少选择 3 种基本姿势（每种至少转 2 圈）', '所有旋转必须达到国际滑联旋转 2 级的定级标准'],
    steps: ['1 个 StSq，充分利用冰面，至少包括 5 个难度的转体步（Turns）/ 步法（Steps），每种最多可重复 1 次'],
    moves: ['无'] },
  { lv: '九级', time: '2 分 40 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['3 周跳（任选）', '3 周连 2 周跳（3 周跳必须不同于单跳）', '2Lz+2T+2Lo'],
    spins: ['跳接转（8 圈）', '1 种姿势转（8 圈），不能跳进入，不能与跳接转姿势相同（不可以做基本直立姿势）', 'CCoSp（6+6）至少选择 3 种基本姿势（每种至少转 2 圈）', '所有旋转必须达到国际滑联旋转 3 级的定级标准'],
    steps: ['1 个 StSq，充分利用冰面，至少包括 7 个难度的转体步（Turns），每种最多可重复 1 次'],
    moves: ['无'] },
  { lv: '十级', time: '2 分 40 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['3Lo', '3F', '3Lz+2T / 2Lo'],
    spins: ['FCaSp（8 圈）/ FCCoSp（10 圈），至少选择 3 种基本姿势（每种至少转 2 圈）', '1 种姿势转（8 圈），不能跳进入，不能与跳接转姿势相同（不可以做基本直立姿势）', 'CCoSp（10 圈）至少选择 3 种基本姿势（每种至少转 2 圈）', '所有旋转必须达到国际滑联旋转 3 级的定级标准'],
    steps: ['1 个 ChSq，按照国际滑联要求执行'],
    moves: ['无'] }
];
// ---------- 单人成人自由滑 1–6 级 ----------
// 来源：第四章「单人成人自由滑等级测试内容」表格（第 136 页）与「成人自由滑等级测试评判标准」（第 137 页）。
const ADULT_FREE_REQ = [
  { lv: '一级', time: '1 分 ± 10 秒（在音乐伴奏下）',
    jumps: ['W（华尔兹跳）'],
    spins: ['USp-Ⅱ（转 3 圈）'],
    steps: ['1 个前燕式平衡（3 秒），浮腿任选', '少于 3 秒将按照规定动作没有达到规定时间评判'],
    moves: ['2 个方向的前交叉蹬冰，每个方向至少连续 3 次'] },
  { lv: '二级', time: '1 分 10 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['W + W（两个华尔兹跳）'],
    spins: ['USp-Ⅱ（转 5 圈），必须选择 3 字步进入'],
    steps: ['1 个 LFO 燕式平衡（3 秒）', '任选 1 个自由滑动作，不能与 LFO 燕式平衡相同（3 秒）'],
    moves: ['2 个方向的后交叉蹬冰，每个方向至少连续 3 次'] },
  { lv: '三级', time: '1 分 10 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1S（后内结环一周跳）'],
    spins: ['USp（转 3 圈），必须选择 3 字步进入'],
    steps: ['1 个 RFI 燕式平衡（3 秒）', '任选 1 个自由滑动作，不能与 RFI 燕式平衡相同（3 秒）'],
    moves: ['无'] },
  { lv: '四级', time: '1 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1T', '1Lo'],
    spins: ['SSp（转 3 圈）'],
    steps: ['1 个 RFO 燕式平衡（3 秒）', '1 个 LF 燕式平衡（3 秒）', '任选 1 个自由滑动作（3 秒）（不包括燕式平衡）'],
    moves: ['无'] },
  { lv: '五级', time: '1 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1F', '1S+1T'],
    spins: ['CSp（转 3 圈）'],
    steps: ['1 个 BO 燕式平衡（3 秒）', '1 个 BI 燕式平衡（3 秒）', '任选 1 个自由滑动作（3 秒）（不包括燕式平衡）'],
    moves: ['无'] },
  { lv: '六级', time: '1 分 30 秒 ± 10 秒（在音乐伴奏下）',
    jumps: ['1Lz', '1Lo+1Lo'],
    spins: ['CoSp（转 6 圈）至少 2 种基本姿势（每种不少于 2 圈）'],
    steps: ['2 个有创意的自由动作，各 3 秒（不包括燕式平衡）'],
    moves: ['无'] }
];
function adultFreeLevel(r, i) {
  return sylLevel('adult', '自由滑 · ' + r.lv, 'adult-f' + (i + 1), 'free', {
    content: [
      { title: '时间', points: [r.time] },
      { title: '跳跃', points: r.jumps },
      { title: '旋转', points: r.spins },
      { title: '接续步', points: r.steps },
      { title: '自由滑动作', points: r.moves }
    ]
  });
}

// 自由滑共用的评判标准（第三章「单人自由滑等级测试评判标准」，第 131–132 页）
function freeLevel(r, i) {
  return sylLevel('free', r.lv, 'free-' + (i + 1), null, {
    content: [
      { title: '时间', points: [r.time] },
      { title: '跳跃', points: r.jumps },
      { title: '旋转', points: r.spins },
      { title: '接续步', points: r.steps },
      { title: '自由滑动作', points: r.moves }
    ]
  });
}

// 内置考纲（只读）：内容摘自《国家花样滑冰等级测试大纲（第2版）》相应页，仅供备考参考，请以官方原文为准。
// 使用固定 key，用户个性化内容按 key 关联，因此用户不需要（也不能）编辑考纲本体。
const SYLLABUS = [
  // 单人滑 · 自由滑 1–10 级（书名与级别依据：第一章 总则）
  ...FREE_REQ.map(freeLevel),
  // 单人滑 · 步法表演节目：基础级 + 1–10 级（四级是你自己转录的那份，见下面 legacy）
  ...STEPS_REQ.map(x => sylLevel('steps', x[0], x[1], null, {
    'key-steps': x[2],
    test: [{ title: '时间与节奏', points: x[3] }]
  })),

  {
    key: 'steps-4',
    kind: 'steps',
    level: '四级',
    source: SYLLABUS_SOURCE,
    sections: [
      {
        key: 'test', name: '测试标准明细', userAdd: true, items: [{
          key: 't1', title: '时间与节奏', mistakes: [],
          points: [
            '步法滑行时长：1 分 10 秒 ± 5 秒',
            '整套节目时长：1 分 55 秒 ± 5 秒',
            '音乐节奏：52 小节/分 · 156 拍/分'
          ]
        }]
      },
      { key: 'pattern', name: '规定步法（图案）', userAdd: false, images: ['/packageExam/images/steps-4.png'], items: [] },
      {
        key: 'key-steps', name: '重点步法说明', userAdd: false, items: [
          {
            key: 's-3-5', title: '第3、5步 前内刃双3字步',
            points: [
              '双3字步要在弧线上完成，完成时应体现膝关节的韵律。',
              '在第2个3字步转体时浮足尽量靠近滑足。',
              '第2个3字步转体后浮足向前伸出。',
              '转体前后的用刃要准确。'
            ],
            mistakes: ['由于用刃错误，转3后不能保持相应的滑动感。', '膝关节在滑行时缺乏韵律性。']
          },
          {
            key: 's-mohawk', title: '第9-12、20、21、26、27、37、38、46、47步 闭式莫霍克步',
            points: [
              '要求用刃准确，换足后滑足立即用外刃滑出。',
              '换足时浮足靠近滑足。',
              '滑足膝关节保持应有的韵律。',
              '浮足抬起时要求膝关节伸直。'
            ],
            mistakes: ['换足时，两脚分开过大。', '重心不能靠住，换足后导致错误用刃。']
          },
          {
            key: 's-16-18', title: '第16、18步 前外刃双3字步',
            points: [
              '双3字步要在弧线上完成，完成时膝关节要保持应有的韵律。',
              '在每次转体时浮足尽量靠近滑足。',
              '第2个3字步转体后浮足向前伸出。',
              '转体前后的用刃要准确。'
            ],
            mistakes: ['如果沿纵轴出脚，会导致3字步滑线过直。', '膝关节在滑行时缺乏韵律性。', '由于用刃错误，转3后不能保持相应的滑动感。']
          },
          {
            key: 's-31-34', title: '第31、34步 后内刃双3字步',
            points: [
              '双3字步要在弧线上完成，完成时膝关节要保持应有的韵律。',
              '在每次转体时浮足尽量靠近滑足。',
              '转体前后的用刃要准确。'
            ],
            mistakes: ['由于用刃错误，转3后不能保持相应的滑动感。', '膝关节在滑行时缺乏韵律性。', '浮足过于松散，破坏了转体时的稳定性。']
          },
          {
            key: 's-41-44', title: '第41、44步 后外刃双3字步',
            points: [
              '双3字步要在弧线上完成，膝关节要保持应有的韵律。',
              '转3时浮足伸直、滑足与浮足的大腿尽量靠近。',
              '第2个3字步转体后浮足向后伸出。',
              '转体前后的用刃要准确。'
            ],
            mistakes: ['如果沿纵轴出脚，会导致3字步滑线过直。', '膝关节在滑行时缺乏韵律性。', '由于用刃错误，转3后不能保持相应的滑动感。', '浮足过于松散，破坏了转体时的稳定性。']
          },
          {
            key: 's-51-53', title: '第51、53步 后内刃规尺',
            points: ['要求支撑脚用刀齿点冰为中心点，滑行脚按照规定用刃，绕支撑点滑满1周。', '点冰腿膝关节弯曲，滑行腿伸直。'],
            mistakes: ['点冰腿和滑行腿同时弯曲。']
          }
        ]
      },
      { key: 'my-points', name: '我的要点', userAdd: true, items: [] }
    ]
  },
  ...([
    ['五级', 'steps-5', ['前外、前内摇滚步', '后外、后内摇滚步', '前外闭式乔克塔步'],
      ['步法滑行时长：1 分 5 秒 ± 5 秒', '整套节目时长：2 分 10 秒 ± 5 秒', '音乐节奏：26 小节/分 · 104 拍/分']],
    ['六级', 'steps-6', ['8种不同用刃的括弧步', '前外括弧步', '前内括弧步', '后外括弧步', '后内括弧步'],
      ['步法滑行时长：1 分 20 秒 ± 5 秒', '整套节目时长：2 分 ± 5 秒', '音乐节奏：24 小节/分 · 96 拍/分']],
    ['七级', 'steps-7', ['8种不同用刃的内勾步', '前外内勾步', '前内内勾步', '后外内勾步', '后内内勾步'],
      ['步法滑行时长：1 分 35 秒 至 1 分 40 秒', '整套节目时长：2 分 20 秒 ± 5 秒', '音乐节奏：24 小节/分 · 96 拍/分']],
    ['八级', 'steps-8', ['8种不同用刃的外勾步', '前外外勾步', '前内外勾步', '后外外勾步', '后内外勾步'],
      ['步法滑行时长：1 分 45 秒 ± 5 秒', '整套节目时长：2 分 30 秒 ± 5 秒', '音乐节奏：45 小节/分 · 135 拍/分']],
    ['九级', 'steps-9', ['8种不同用刃的结环步', '前内大一字步', '前外结环步', '前内结环步', '后外结环步', '后内结环步'],
      ['步法滑行时长：1 分 30 秒 ± 5 秒', '整套节目时长：2 分 10 秒 ± 5 秒', '音乐节奏：28 小节/分 · 112 拍/分']],
    ['十级', 'steps-10', ['4个外勾步', '4个内勾步', '4个结环步', '4个捻转步', '2个括弧步', '2个开式乔克塔步', '内刃变外刃的大一字步'],
      ['步法滑行时长：1 分 20 秒 ± 5 秒', '整套节目时长：2 分 ± 5 秒', '音乐节奏：本级不受限制']]
  ]).map(x => sylLevel('steps', x[0], x[1], null, {
    'key-steps': x[2],
    test: [{ title: '时间与节奏', points: x[3] }]
  })),
  // 冰上舞蹈 1–6 级
  ...sylRange('dance', CN_LEVELS.slice(0, 6).map((lv, i) => [lv, 'dance-' + (i + 1)])),
  // 成人单人滑：自由滑 1–6 级、步法表演节目 1–6 级（分节沿用单人滑那套）
  ...ADULT_FREE_REQ.map(adultFreeLevel),
  ...sylRange('adult', CN_LEVELS.slice(0, 6).map((lv, i) => ['步法 · ' + lv, 'adult-s' + (i + 1)]), 'steps'),
  // 双人滑 1–3 级
  ...sylRange('pair', [['一级', 'pair-1'], ['二级', 'pair-2'], ['三级', 'pair-3']])
];

// 成人步法 1–6 级：原书第四章写明"参考单人滑步法表演节目 1–6 级开展与评判"，
// 所以直接沿用单人步法同名级别的要素与时长，只在备注里说明出处（不重复维护两份数据）。
(function fillAdultSteps() {
  const src = {};
  SYLLABUS.forEach(x => { if (x.kind === 'steps') src[x.key] = x; });
  SYLLABUS.forEach(x => {
    if (x.kind !== 'adult' || x.key.indexOf('adult-s') !== 0) return;
    const n = x.key.replace('adult-s', '');
    const from = src['steps-' + n];
    if (!from) return;
    const note = '本级别参考《大纲》单人滑步法表演节目「' + from.level + '」开展与评判（原书第四章「单人成人步法表演节目测试内容及评判标准」）。';
    const secs = [{ key: 'adult-ref', name: '成人步法 · 说明', userAdd: true,
      items: [{ key: 'ref', title: '出处', points: [note], mistakes: [] }] }];
    from.sections.forEach(sec => {
      if (sec.key === 'my-points') return;
      secs.push({
        key: sec.key, name: sec.name, userAdd: sec.userAdd,
        items: sec.items.map(it => ({
          key: it.key, title: it.title,
          points: (it.points || []).slice(), mistakes: (it.mistakes || []).slice()
        }))
      });
    });
    secs.push({ key: 'my-points', name: '我的要点', userAdd: true, items: [] });
    x.sections = secs;
  });
})();

module.exports = {
  APP_VERSION, POSE_ENABLED, TYPES, MODES, CATS, CAT_ORDER, DEFAULT_CATS, CAT_FALLBACK, CAT_SEED_MOVES,
  DEFAULT_MOVES, WEEK, ICE_THRESHOLDS, HOURS_THRESHOLDS,
  MS_TYPES, EXAM_KINDS, EXAM_SECTIONS, SYLLABUS, LESSON_FORMS, POSE_JOINTS
};
