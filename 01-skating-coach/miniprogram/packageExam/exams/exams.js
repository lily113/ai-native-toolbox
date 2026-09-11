const store = require('../../utils/store');
const { EXAM_KINDS, SYLLABUS } = require('../../utils/const');
const util = require('../../utils/util');

Page({
  data: { groups: [] },

  onShow() { this.refresh(); },

  refresh() {
    const arr = store.ensureExams();
    const groups = Object.keys(EXAM_KINDS).map(k => {
      const list = [];
      // 内置考纲（只读）
      SYLLABUS.filter(s => s.kind === k).forEach(sy => {
        const ov = arr.filter(e => e && e.key === sy.key)[0] || {};
        const syItems = (sy.sections || []).reduce((n, s) => n + ((s.items || []).length), 0);
        list.push({
          id: ov.id || ('sy_' + sy.key),
          builtin: true,
          level: sy.level,
          date: ov.date || '',
          cdText: util.countdownText(ov.date),
          imgCount: (ov.images || []).length,
          itemCount: syItems + ((ov.myItems || []).length),
          myCount: (ov.myItems || []).length
        });
      });
      // 自建考级
      arr.filter(e => e && e.key === '' && e.kind === k).forEach(e => {
        list.push({
          id: e.id,
          builtin: false,
          level: e.level,
          date: e.date || '',
          cdText: util.countdownText(e.date),
          imgCount: (e.images || []).length,
          itemCount: (e.myItems || []).length,
          myCount: (e.myItems || []).length,
          note: e.note || ''
        });
      });
      return { kind: k, name: EXAM_KINDS[k].name, list: list };
    });
    this.setData({ groups: groups });
  },

  open(e) {
    wx.navigateTo({ url: '/packageExam/exam/exam?id=' + e.currentTarget.dataset.id });
  },

  add() {
    wx.showActionSheet({
      itemList: ['自由滑', '步法'],
      success: r => {
        const kind = r.tapIndex === 0 ? 'free' : 'steps';
        wx.showModal({
          title: '新建考级', editable: true, placeholderText: '级别，如：五级 / 三级',
          success: m => {
            if (!m.confirm) return;
            const level = (m.content || '').trim();
            if (!level) { wx.showToast({ title: '请填写级别', icon: 'none' }); return; }
            const arr = store.ensureExams();
            arr.push(store.newExam(kind, level));
            store.saveExams(arr);
            this.refresh();
            wx.showToast({ title: '已创建' });
          }
        });
      }
    });
  },

  restoreBackup() {
    const bak = store.load('figure_skating_planner_exams_backup_v1');
    if (!bak || !Array.isArray(bak.exams) || !bak.exams.length) {
      wx.showToast({ title: '没有可恢复的备份', icon: 'none' }); return;
    }
    wx.showModal({
      title: '恢复考级数据',
      content: '将把上次同步前的考级内容合并回来（只补缺失，不覆盖现有）。确定？',
      success: r => {
        if (!r.confirm) return;
        const util = require('../../utils/util');
        const merged = util.mergeExams(store.ensureExams(), bak.exams, false);
        store.saveExams(merged);
        // 顺带恢复基线 / 每周目标
        if (bak.meta && typeof bak.meta === 'object') {
          store.save(store.KEYS.meta, util.mergeMeta(store.load(store.KEYS.meta) || {}, bak.meta, true));
        }
        this.refresh();
        const t = new Date(bak.at || Date.now());
        wx.showToast({ title: '已恢复（备份时间 ' + t.getMonth() + '/' + t.getDate() + '）' });
      }
    });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除考级',
      content: '确定删除这个自建考级及其所有笔记？',
      confirmColor: '#dc2626',
      success: r => {
        if (!r.confirm) return;
        store.saveExams(store.ensureExams().filter(x => x.id !== id));
        this.refresh();
        wx.showToast({ title: '已删除' });
      }
    });
  }
});
