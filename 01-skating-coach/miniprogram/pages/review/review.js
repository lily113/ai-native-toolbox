const store = require('../../utils/store');
const { LESSON_FORMS } = require('../../utils/const');

// 大数字的字号档位：<=3 字用 lg，4-5 字用 md，再长用 sm（永远不用"缩一半"那种）
function numCls(txt) {
  const n = String(txt || '').replace(/\s/g, '').length;
  if (n <= 3) return 'num-lg';     // 3 / 4小时
  if (n <= 6) return 'num-md';     // 4小时30分
  if (n <= 8) return 'num-sm';     // 12小时45分
  return 'num-xs';
}

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  if (!h) return min + ' 分钟';
  return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
}

Page({
  data: {
    year: 0,
    month: 0,
    ymValue: '',
    stats: null,
    cvW: 640,     // 报告图画布尺寸（px，绘制时按 dpr 放大）
    cvH: 900
  },

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() });
    this.calc();
  },
  onShow() { this.calc(); },

  // ---------- 生成月度报告图 ----------
  // 用 canvas 2d 画一张 640x900 的图：标题、三个大数字、近 12 个月柱状、上下冰占比。
  // 已保存过就提示；保存到相册被拒时引导去设置里开权限。
  makeReport() {
    const st = this.data.stats || {};
    if (!st.count) { wx.showToast({ title: '这个月还没有记录', icon: 'none' }); return; }
    wx.showLoading({ title: '正在生成…', mask: true });
    const q = wx.createSelectorQuery();
    q.select('#reportCanvas').fields({ node: true, size: true }).exec(res => {
      const node = res && res[0] && res[0].node;
      if (!node) { wx.hideLoading(); wx.showToast({ title: '生成失败（画布没找到）', icon: 'none' }); return; }
      const W = 640, H = 900;
      const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
      node.width = W * dpr;
      node.height = H * dpr;
      const ctx = node.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#f0f9ff';
      ctx.fillRect(0, 0, W, H);
      // 标题
      ctx.fillStyle = '#0369a1';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('花样滑冰训练', 40, 70);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(st.label || '', 40, 108);
      ctx.fillStyle = '#64748b';
      ctx.font = '18px sans-serif';
      ctx.fillText('本机记录 · 数据只在你自己账号下', 40, 138);
      // 三个大数字
      const boxY = 170, boxH = 130;
      const boxes = [
        { n: String(st.count), lb: '训练次数' },
        { n: st.minutesText || '', lb: '总时长' },
        { n: String(st.ice) + ' / ' + String(st.lesson), lb: '上冰 / 上课' }
      ];
      boxes.forEach((b, i) => {
        const x = 40 + i * ((W - 80) / 3);
        const w = (W - 80) / 3 - 14;
        ctx.fillStyle = '#ffffff';
        this._roundRect(ctx, x, boxY, w, boxH, 16);
        ctx.fill();
        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(b.n, x + 16, boxY + 62);
        ctx.fillStyle = '#64748b';
        ctx.font = '18px sans-serif';
        ctx.fillText(b.lb, x + 16, boxY + 96);
      });
      // 近 12 个月柱状
      const chY = 340, chH = 260;
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('近 12 个月训练次数（最高 ' + (st.trendMax || 0) + ' 次）', 40, chY - 14);
      const trend = st.trend || [];
      const bw = Math.floor((W - 80) / Math.max(1, trend.length)) - 10;
      trend.forEach((t, i) => {
        const x = 40 + i * ((W - 80) / Math.max(1, trend.length));
        const h = Math.max(t.count ? 8 : 0, Math.round((t.count || 0) / Math.max(1, st.trendMax) * (chH - 40)));
        ctx.fillStyle = t.current ? '#0284c7' : '#7dd3fc';
        this._roundRect(ctx, x, chY + (chH - 40) - h, bw, h, 6);
        ctx.fill();
        ctx.fillStyle = t.current ? '#0284c7' : '#94a3b8';
        ctx.font = '16px sans-serif';
        ctx.fillText(String(t.label || ''), x, chY + chH - 14);
        if (t.count) {
          ctx.fillStyle = '#334155';
          ctx.font = '15px sans-serif';
          ctx.fillText(String(t.count), x, chY + (chH - 40) - h - 6);
        }
      });
      // 类型占比
      const tbY = 660;
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('上冰 / 陆地 / 上课', 40, tbY - 14);
      let bx = 40;
      (st.typeBar || []).forEach(t => {
        const w = Math.round((W - 80) * (t.pct || 0) / 100);
        if (w <= 0) return;
        ctx.fillStyle = (t.cls === 'ice') ? '#38bdf8' : (t.cls === 'land' ? '#a78bfa' : '#34d399');
        this._roundRect(ctx, bx, tbY, w, 30, 8);
        ctx.fill();
        bx += w + 2;
      });
      ctx.font = '18px sans-serif';
      let ly = tbY + 62;
      (st.typeBar || []).forEach(t => {
        ctx.fillStyle = (t.cls === 'ice') ? '#0ea5e9' : (t.cls === 'land' ? '#7c3aed' : '#059669');
        ctx.fillText(t.name + '  ' + t.n + ' 次 · ' + t.pct + '%', 40, ly);
        ly += 26;
      });
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText('累计上冰 ' + (st.allIce || 0) + ' 次 · 累计上课 ' + (st.allUnits || 0) + ' 节', 40, H - 40);

      wx.canvasToTempFilePath({
        canvas: node,
        success: r => {
          wx.hideLoading();
          const p = r.tempFilePath;
          const after = () => {
            if (wx.showShareImageMenu) {
              wx.showShareImageMenu({ path: p, fail: () => {} });
            } else {
              wx.previewImage({ urls: [p] });
            }
          };
          wx.saveImageToPhotosAlbum({
            filePath: p,
            success: () => { wx.showToast({ title: '已存到相册', icon: 'none' }); after(); },
            fail: err => {
              const msg = String((err && err.errMsg) || '');
              if (msg.indexOf('auth deny') > -1 || msg.indexOf('authorize') > -1) {
                wx.showModal({
                  title: '需要相册权限', content: '保存图片需要你允许"保存到相册"。去设置里打开？',
                  success: r2 => { if (r2.confirm) wx.openSetting({}); }
                });
              } else {
                wx.showToast({ title: '保存失败，可直接转发图片', icon: 'none' });
              }
              after();
            }
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '生成失败，稍后再试', icon: 'none' }); }
      });
    });
  },
  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  },

  prev() {
    const d = new Date(this.data.year, this.data.month - 1, 1);
    this.setData({ year: d.getFullYear(), month: d.getMonth() });
    this.calc();
  },
  next() {
    const d = new Date(this.data.year, this.data.month + 1, 1);
    this.setData({ year: d.getFullYear(), month: d.getMonth() });
    this.calc();
  },
  onDate(e) {
    const v = String(e.detail.value || '');
    const p = v.split('-');
    const y = Number(p[0]), m = Number(p[1]) - 1;
    if (!isNaN(y) && !isNaN(m)) { this.setData({ year: y, month: m }); this.calc(); }
  },

  calc() {
    const y = this.data.year, m = this.data.month;
    const all = store.loadRecords();
    const recs = all.filter(r => { const d = store.keyToDate(r.date); return d.getFullYear() === y && d.getMonth() === m; });

    let minutes = 0, ice = 0, land = 0, rehab = 0, lesson = 0, selfC = 0, monthUnits = 0;
    const formCount = {};
    recs.forEach(r => {
      minutes += Number(r.duration) || 0;
      if (r.type === 'ice') ice++; else if (r.type === 'land') land++; else rehab++;
      if (r.mode === 'lesson' && r.type === 'ice') {
        lesson++; monthUnits += Number(r.units) || 1;
        if (r.lessonForm && LESSON_FORMS[r.lessonForm]) formCount[r.lessonForm] = (formCount[r.lessonForm] || 0) + 1;
      }
      else if (r.mode === 'self') selfC++;
    });

    const goal = (store.load(store.KEYS.meta) || {}).weeklyIceGoal || 0;
    const weeklyAvg = Math.round(minutes / 4.33);
    const goalPct = goal ? Math.min(100, Math.round(weeklyAvg / goal * 100)) : 0;

    // 累计上冰/上课 = 截至“当前年月”的次数 + 基线（补偿早期未录的）
    const endDateKey = store.dateKey(new Date(y, m + 1, 0)); // 当前月最后一天
    const meta = store.load(store.KEYS.meta) || {};
    const iceBase = Number(meta.iceBase) || 0;
    const lessonBase = Number(meta.lessonBase) || 0;
    // 累计上冰：冰上记录（不限上课/自己），截至当前月
    const allIce = all.filter(r => r.type === 'ice' && r.date <= endDateKey).length + iceBase;
    // 累计上课：冰上 + 陆地 的上课记录（不含康复），截至当前月
    // 只统计“上冰课”（陆地课不计入累计，避免与笔记编号错位）
    const lessonRecs = all.filter(r => r.type === 'ice' && r.mode === 'lesson' && r.date <= endDateKey);
    const allLesson = lessonRecs.length + lessonBase;
    // 累计节数：基线（那时 1 节=1 次）+ 各次课的节数
    const allUnits = lessonRecs.reduce((n, r) => n + (Number(r.units) || 1), 0) + lessonBase;

    // 近 12 个月趋势（次数）
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - i, 1);
      const yy = d.getFullYear(), mm = d.getMonth();
      const cnt = all.filter(r => { const dd = store.keyToDate(r.date); return dd.getFullYear() === yy && dd.getMonth() === mm; }).length;
      trend.push({ label: (mm + 1) + '月', count: cnt, current: i === 0 });
    }
    const trendMax = Math.max(1, ...trend.map(t => t.count));
    trend.forEach(t => { t.h = Math.max(t.count ? 6 : 0, Math.round(t.count / trendMax * 100)); });
    // 本月类型占比
    const totalTypes = (ice + land + rehab) || 1;
    const typeBar = [
      { name: '上冰', n: ice, pct: Math.round(ice / totalTypes * 100), cls: 'ice' },
      { name: '陆地', n: land, pct: Math.round(land / totalTypes * 100), cls: 'land' },
      { name: '康复', n: rehab, pct: Math.round(rehab / totalTypes * 100), cls: 'rehab' }
    ].filter(x => x.n > 0);

    this.setData({
      ymValue: y + '-' + (m + 1 < 10 ? '0' + (m + 1) : (m + 1)),
      stats: {
        label: y + ' 年 ' + (m + 1) + ' 月',
        count: recs.length,
        minutesText: fmtMin(minutes),
        // 字号档位：两张卡的数字都按长度取档，避免"3"很大、"4 小时"很小
        minutesCls: numCls(fmtMin(minutes)),
        countCls: numCls(String(recs.length)),
        ice: ice,
        land: land,
        rehab: rehab,
        showRehab: rehab > 0,
        lesson: lesson,
        monthUnits: monthUnits,
        formText: Object.keys(LESSON_FORMS).filter(k => formCount[k]).map(k => LESSON_FORMS[k].name + ' ' + formCount[k]).join(' · '),
        selfC: selfC,
        goal: goal,
        weeklyAvg: weeklyAvg,
        goalPct: goalPct,
        allIce: allIce,
        allLesson: allLesson,
        allUnits: allUnits,
        trend: trend,
        trendMax: trendMax,
        typeBar: typeBar
      }
    });
  }
});
