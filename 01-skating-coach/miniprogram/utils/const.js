const TYPES = {
  ice:   { name: '上冰', emoji: '⛸️' },
  land:  { name: '陆地', emoji: '🏋️' },
  rehab: { name: '康复', emoji: '💪' }
};
const MODES = {
  self:   { name: '🤸 自己训练' },
  lesson: { name: '📖 上课' }
};
const CATS = {
  jump:  { name: '跳跃' },
  spin:  { name: '旋转' },
  step:  { name: '步法' },
  other: { name: '其他' }
};
const CAT_ORDER = ['jump', 'spin', 'step', 'other'];
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

// 上课形式（仅“上课”记录用）
const LESSON_FORMS = {
  one:   { name: '一对一' },
  two:   { name: '一对二' },
  multi: { name: '一对多' }
};

// ---------- 考级备考 ----------
const EXAM_KINDS = { free: { name: '自由滑' }, steps: { name: '步法' } };
const EXAM_SECTIONS = {
  free: ['我的要点'],
  steps: ['我的要点']
};

// 内置考纲（只读）：内容摘自《国家花样滑冰等级测试大纲（第2版）》相应页，仅供备考参考，请以官方原文为准。
// 使用固定 key，用户个性化内容按 key 关联，因此用户不需要（也不能）编辑考纲本体。
const SYLLABUS = [
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
  }
];

module.exports = {
  TYPES, MODES, CATS, CAT_ORDER, DEFAULT_MOVES, WEEK, ICE_THRESHOLDS, HOURS_THRESHOLDS,
  MS_TYPES, EXAM_KINDS, EXAM_SECTIONS, SYLLABUS, LESSON_FORMS
};
