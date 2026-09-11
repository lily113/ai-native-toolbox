const https = require('https');
const kb = require('./kb');

// 本地知识库检索（同 PWA 的大词匹配思路）
function bigramSet(s) {
  s = String(s || '').toLowerCase();
  const o = {};
  for (let i = 0; i < s.length - 1; i++) o[s.slice(i, i + 2)] = true;
  return o;
}
function retrieve(q) {
  const qb = bigramSet(q);
  const scored = [];
  (kb.chunks || []).forEach((c, i) => {
    const cb = bigramSet(c.text);
    let s = 0;
    for (const k in qb) if (cb[k]) s++;
    if (s) scored.push({ i: i, s: s, label: c.label });
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 6)
    .map(x => (x.label || '') + '\n' + kb.chunks[x.i].text)
    .join('\n\n')
    .slice(0, 2600);
}

const SYSTEM = '你是资深花样滑冰教练（训练/规则答疑），熟悉单人滑与冰舞的技术动作、规则与考级。回答先讲关键要点再展开，术语准确、可落地。' +
  '【知识优先级】①【官方资料】是权威标准；②【术语参考】是整理补充的术语口径（非官方原文，冲突以官方为准）；③【个人笔记】是滑冰者练法记录。三者冲突时一律以【官方资料】为准。' +
  '【诚实原则】资料未覆盖或你不确定时，要明确说"这个不确定，建议查 ISU 原文或咨询教练"，绝不臆测、编造。' +
  '【定义诚实】被问到动作/转体定义时，若资料只有列举没有定义，必须说"资料未包含该动作的正式定义，建议查 ISU 原文/问教练"，禁止拿相邻步法描述或自行推理编解释。' +
  '涉及伤痛请提醒就医。';

const NOTE_SYSTEM = '你是花样滑冰课堂笔记整理助手。用户会给你一段「语音转写」的课堂口述（可能口语化、有错字、重复、漏词、没标点），请你把它整理成一份标准课堂笔记，用 Markdown 分节输出，只保留实际提到的内容，按以下顺序（某节没有内容就整节省略）：\n' +
  '## 训练内容\n本课实际训练的项目/动作/组合，尽量保留口述中的组数、次数、时长。\n' +
  '## 技术要点\n教练讲解的要领：发力、重心、用刃、节奏、姿态、呼吸等。\n' +
  '## 教练提醒\n教练指出的问题与纠正方法。\n' +
  '## 待改进 / 下次目标\n待改进项、教练布置的练习或作业、下次课目标。\n' +
  '要求：\n' +
  '1. 只整理口述中确实出现过的内容，严禁添加口述里没有的动作、要领、成绩、作业或安排；没听清、缺失的信息写「（未听清，请确认）」。\n' +
  '2. 把口语理顺成书面语：可修正明显错字/同音词（结合语境判断，如「内沟」应为「内勾(步)」、「捻砖步」应为「捻转步」等花滑术语），但不得改动口述的事实与数字。\n' +
  '3. 若某词听起来像花滑术语但上下文与知识库都无法确定标准写法，不要硬猜，保留原文并在其后紧跟「（疑似听错？请确认）」。\n' +
  '4. 若内容涉及动作规范/规则，可核对下方知识库：【官方资料】是权威标准，冲突时以官方为准并注明；拿不准就注明，不臆断。\n' +
  '5. 不要寒暄、不要复述原文、不要加「以下是整理结果」之类开头，直接输出笔记正文。';

function callDeepSeek(messages, key) {
  const body = JSON.stringify({ model: 'deepseek-chat', messages: messages, temperature: 0.4, max_tokens: 4000 });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
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
  const ctx = retrieve(q);
  const sys = mode === 'note'
    ? (NOTE_SYSTEM + (ctx ? '\n\n【可参考知识库片段】\n' + ctx : ''))
    : (SYSTEM + (ctx ? '\n\n【可参考知识库片段】\n' + ctx : ''));
  const userContent = mode === 'note' ? ('我的语音转写（口语化，可能含错字，请据此整理成标准课堂笔记）：\n' + q) : q;
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
    return { answer: reply };
  } catch (e) {
    return { answer: '云函数异常：' + e.message };
  }
};
