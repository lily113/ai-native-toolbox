const store = require('../../utils/store');
const AI_KEY = 'figure_skating_planner_ai_coach_v1';

Page({
  data: {
    msgs: [],
    input: '',
    sending: false,
    scrollId: ''
  },

  onLoad() {
    const msgs = store.load(AI_KEY) || [];
    this.setData({ msgs, scrollId: msgs.length ? 'm' + (msgs.length - 1) : '' });
  },
  onHide() { store.save(AI_KEY, this.data.msgs); },
  onUnload() { store.save(AI_KEY, this.data.msgs); },

  input(e) { this.setData({ input: e.detail.value }); },

  append(role, text) {
    const msgs = this.data.msgs.concat([{ role: role, text: text }]);
    this.setData({ msgs: msgs, scrollId: 'm' + (msgs.length - 1) });
    store.save(AI_KEY, msgs);
    return msgs.length - 1;
  },
  replaceAt(idx, role, text) {
    const msgs = this.data.msgs.slice();
    msgs[idx] = { role: role, text: text };
    this.setData({ msgs: msgs });
    store.save(AI_KEY, msgs);
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
        const ans = (res && res.result && res.result.answer) || '(空回复)';
        this.replaceAt(idx, 'ai', ans);
      })
      .catch(err => {
        this.replaceAt(idx, 'ai', '❌ 调用失败：' + ((err && (err.errMsg || err.message)) || '未知错误') +
          '\n（请检查：deepseek 云函数是否已部署、是否配置了 DEEPSEEK_KEY、执行超时是否 ≥60s）');
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
