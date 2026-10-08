const store = require('../../utils/store');
const { EXAM_KINDS, SYLLABUS } = require('../../utils/const');
const util = require('../../utils/util');

Page({
  // mine = 我的考级（关注过 / 设了日期的）；groups = 全部级别（按项目分组，默认折叠）
  data: { mine: [], groups: [], allOn: false, allCount: 0 },

  onShow() { this.refresh(); },

  refresh() {
    const arr = store.ensureExams();
    const all = [];

    // ① 内置考纲：一条 = 一个级别
    Object.keys(EXAM_KINDS).forEach(k => {
      SYLLABUS.filter(s => s.kind === k).forEach(sy => {
        const ov = arr.filter(e => e && e.key === sy.key)[0] || {};
        const syItems = (sy.sections || []).reduce((n, s) => n + ((s.items || []).length), 0);
        all.push({
          id: ov.id || ('sy_' + sy.key),
          kind: k, kindName: EXAM_KINDS[k].name, level: sy.level,
          builtin: true,
          star: !!ov.star,
          date: ov.date || '',
          cdText: util.countdownText(ov.date),
          imgCount: (ov.images || []).length,
          itemCount: syItems + ((ov.myItems || []).length),
          myCount: (ov.myItems || []).length
        });
      });
    });

    // ② 自建考级
    Object.keys(EXAM_KINDS).forEach(k => {
      arr.filter(e => e && e.key === '' && e.kind === k).forEach(e => {
        all.push({
          id: e.id,
          kind: k, kindName: EXAM_KINDS[k].name, level: e.level,
          builtin: false,
          star: !!e.star,
          date: e.date || '',
          cdText: util.countdownText(e.date),
          imgCount: (e.images || []).length,
          itemCount: (e.myItems || []).length,
          myCount: (e.myItems || []).length,
          note: e.note || ''
        });
      });
    });

    // 「我的考级」= 星标关注的 + 设了考级日期的 —— 考级是一级一级考的，
    // 绝大多数时候只关心要考的那一两级，全部 42 个级别堆在首页并不好用
    const mine = all.filter(x => x.star || x.date);
    const groups = Object.keys(EXAM_KINDS).map(k => ({
      kind: k, name: EXAM_KINDS[k].name, list: all.filter(x => x.kind === k)
    }));

    this.setData({ mine: mine, groups: groups, allCount: all.length });
  },

  // 关注 / 取消关注（catchtap，不触发跳转）
  toggleStar(e) {
    const id = e.currentTarget.dataset.id;
    const arr = store.ensureExams();
    const i = arr.findIndex(x => x && x.id === id);
    if (i < 0) { wx.showToast({ title: '这条考级不存在', icon: 'none' }); return; }
    arr[i].star = !arr[i].star;
    store.saveExams(arr);
    this.refresh();
    wx.showToast({ title: arr[i].star ? '已加入「我的考级」' : '已移出「我的考级」', icon: 'none' });
  },

  toggleAll() { this.setData({ allOn: !this.data.allOn }); },

  open(e) {
    // ⚠️ id 必须编码：曾经把中文 key 直接拼进 URL，跳转后 id 变样 → 详情页报「考级不存在」
    wx.navigateTo({ url: '/packageExam/exam/exam?id=' + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  add() {
    const kinds = Object.keys(EXAM_KINDS);
    wx.showActionSheet({
      itemList: kinds.map(k => EXAM_KINDS[k].name),
      success: r => {
        const kind = kinds[r.tapIndex] || 'free';
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
  }
});
