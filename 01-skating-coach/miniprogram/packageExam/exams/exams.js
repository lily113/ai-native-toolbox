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

    // 只统计"用户自己记的东西"：
    //   ① 自己加的条目（myItems）
    //   ② 给内置条目补的要点/易犯错误/备注，或挂到动作库的动作（itemExtra）
    // 内置考纲本身的内容不算，否则每级都显示"11 条"，看着像自己记了很多
    const myNoteCount = ov => {
      let n = (ov.myItems || []).length;
      const ex = ov.itemExtra || {};
      Object.keys(ex).forEach(k => {
        const v = ex[k] || {};
        if ((v.points && v.points.length) || (v.mistakes && v.mistakes.length) ||
            (v.note && String(v.note).trim()) || v.moveId) n++;
      });
      return n;
    };

    // ① 内置考纲：一条 = 一个级别
    Object.keys(EXAM_KINDS).forEach(k => {
      SYLLABUS.filter(s => s.kind === k).forEach(sy => {
        const ov = arr.filter(e => e && e.key === sy.key)[0] || {};
        const mine = myNoteCount(ov);
        all.push({
          id: ov.id || ('sy_' + sy.key),
          kind: k, kindName: EXAM_KINDS[k].name, level: sy.level,
          builtin: true,
          star: !!ov.star,
          date: ov.date || '',
          cdText: util.countdownText(ov.date),
          imgCount: (ov.images || []).length,
          itemCount: mine,
          myCount: mine
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
  //
  // 「我的考级」= ⭐关注过的 **或** 设了考级日期的（考级是一级一级考的，只关心要考的那一两级）。
  // 所以取消关注时如果这一级还设着日期，它会**因为日期继续留在列表里** ——
  // 加上这一栏的星星原来是写死的 ⭐，看起来就像"点了没反应"。
  // 现在：还带着日期就先问清楚要不要连日期一起清掉，清掉才是真的移出。
  toggleStar(e) {
    const id = e.currentTarget.dataset.id;
    const arr = store.ensureExams();
    const cur = arr.filter(x => x && x.id === id)[0];
    if (!cur) { wx.showToast({ title: '这条考级不存在', icon: 'none' }); return; }
    if (cur.star && cur.date) {
      wx.showModal({
        title: '移出我的考级',
        content: '这一级设了考级日期 ' + cur.date + '。只取消关注的话，它还会因为这个日期留在「我的考级」里。'
          + '点「移出」会把日期也清掉（首页倒计时随之消失）。',
        confirmText: '移出',
        success: r => { if (r.confirm) this.applyStar(id, false, true); }
      });
      return;
    }
    this.applyStar(id, !cur.star, false);
  },

  applyStar(id, star, clearDate) {
    const arr = store.ensureExams();
    const i = arr.findIndex(x => x && x.id === id);
    if (i < 0) return;
    arr[i].star = star;
    if (clearDate) arr[i].date = '';
    store.saveExams(arr);
    this.refresh();
    wx.showToast({
      title: star ? '已加入「我的考级」' : (clearDate ? '已移出（考级日期也清掉了）' : '已移出「我的考级」'),
      icon: 'none'
    });
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
