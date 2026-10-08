// 版本号：**每次发布前必须 +1**（最后一段递增）。升级保护靠它判断"是不是换版本了"：
// 换版本 → 启动时先本地快照 + 记数据指纹，迁移后再校验有没有变少。
const APP_VERSION = '2026.10.08.3';

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
const EXAM_KINDS = {
  free:  { name: '自由滑' },
  steps: { name: '步法' },
  // ↓ 为冰舞考级预置（官方等级测试含「冰上舞蹈」三级~六级）
  dance: { name: '冰上舞蹈' }
  // 若以后练双人滑，加一行即可：pair: { name: '双人滑' }
};
const EXAM_SECTIONS = {
  free: ['我的要点'],
  steps: ['我的要点'],
  dance: ['我的要点']
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
const SYL_SECTIONS = {
  steps: [
    { key: 'intro', name: '步法简介' },
    { key: 'key-steps', name: '重点步法说明' },
    { key: 'test', name: '测试标准明细' },
    { key: 'detail', name: '本级步法明细' }
  ],
  free: [
    { key: 'content', name: '测试内容' },
    { key: 'pass', name: '评判标准 · 通过标准' },
    { key: 'fail', name: '评判标准 · 未通过标准' }
  ],
  dance: [
    { key: 'goal', name: '目的和任务' },
    { key: 'content', name: '测试内容' },
    { key: 'test', name: '测试标准明细' }
  ]
};
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 生成一个级别的骨架条目：官方分节全部留空 + 一个可编辑的「我的要点」
function sylLevel(kind, level, note) {
  const sections = (SYL_SECTIONS[kind] || []).map(sec => ({
    key: sec.key, name: sec.name, userAdd: false, items: []
  }));
  sections.push({ key: 'my-points', name: '我的要点', userAdd: true, items: [] });
  return {
    key: kind + '-' + (note || level),
    kind: kind,
    level: level,
    source: SYLLABUS_SOURCE,
    sections: sections
  };
}
function sylRange(kind, levels) {
  return levels.map(lv => sylLevel(kind, lv, lv));
}

// 内置考纲（只读）：内容摘自《国家花样滑冰等级测试大纲（第2版）》相应页，仅供备考参考，请以官方原文为准。
// 使用固定 key，用户个性化内容按 key 关联，因此用户不需要（也不能）编辑考纲本体。
const SYLLABUS = [
  // 以下为「只有结构、没有正文」的骨架：级别齐全，正文留空给你自己填
  ...sylRange('free', CN_NUM.map(n => n + '级')),
  ...sylRange('steps', ['基础级', '一级', '二级', '三级']),

  {
    key: 'steps-4',
    kind: 'steps',
    level: '四级',
    sections: [
      {
        key: 'intro', name: '步法简介与要求', userAdd: false, items: [
          {
            key: 'intro-1', title: '四级步法 · 简介',
            points: [
              '这套步法以双3字步为主，与莫霍克步加以综合。',
              '通过练习掌握由单足完成 2 次转体的技术，提高滑行的灵活性、流畅性以及相应的滑行控制能力。'
            ], mistakes: []
          },
          {
            key: 'intro-2', title: '四级步法 · 完成要求',
            points: [
              '将规定的步法与表演节目部分结合表演；自选音乐，但步法部分必须选择 3/4 拍的节奏，并在 1 分 15 秒至 1 分 20 秒之内完成。',
              '表演节目部分的音乐节奏和音乐风格不受限制，编排动作必须符合音乐特点。',
              '表演节目部分不能有超过 1 周的跳跃，不能有超过 3 圈以上的旋转；自由滑动作不受限制。',
              '为表达音乐风格特点，一套节目中最多 1 次停顿（在原地的非滑行动作），且不能超过 5 秒。',
              '整套节目时间为 2 分加减 5 秒。'
            ], mistakes: []
          }
        ]
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
  ...sylRange('steps', ['五级', '六级', '七级', '八级', '九级', '十级']),
  ...sylRange('dance', CN_NUM.slice(0, 6).map(n => n + '级'))
];

module.exports = {
  APP_VERSION, POSE_ENABLED, TYPES, MODES, CATS, CAT_ORDER, DEFAULT_CATS, CAT_FALLBACK, CAT_SEED_MOVES,
  DEFAULT_MOVES, WEEK, ICE_THRESHOLDS, HOURS_THRESHOLDS,
  MS_TYPES, EXAM_KINDS, EXAM_SECTIONS, SYLLABUS, LESSON_FORMS, POSE_JOINTS
};
