// 分享图绘制底座：C（单次训练卡）和以后的 A（阶段报告卡）共用。
//
// 为什么单独抽出来：绘制逻辑原来全塞在回顾页里，加第二张卡就会出现两份几乎一样的代码；
// 而且"图上该放什么、不该放什么"的原则也该集中在一处（见下面 CAN_SHARE / NO_SHARE 注释）。
//
// 画布约定：逻辑尺寸 540×720（3:4，小红书和朋友圈都友好），按 dpr 放大后导出
// → 一般手机 dpr=2，输出正好 1080×1440。
const store = require('./store');
const { TYPES, MODES, EXAM_KINDS } = require('./const');
const util = require('./util');

const CARD_W = 540;
const CARD_H = 720;

// 分享图上"可以放"和"默认不放"的东西（2026-10 定的口径，别再随手加回来）：
//   ✅ 可以放：练过的动作/组合、教练的要点（用户自己的话）、考级倒计时、训练次数
//   ❌ 不放：累计上冰次数 / 累计上课节数 / 花费 —— 涉及"我投入了多少"，而且大多数人也统计不准
//   ⚙️ 默认关、设置里能开：训练时长、教练名字
const NO_SHARE = ['累计上冰', '累计上课', '累计节数', '累计次数'];

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 中英混排的按宽度折行（中文没有空格，只能逐字量）
function wrapText(ctx, text, maxW, maxLines) {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  const lines = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') { lines.push(cur); cur = ''; if (lines.length >= (maxLines || 99)) break; continue; }
    const next = cur + ch;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= (maxLines || 99)) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < (maxLines || 99)) lines.push(cur);
  if (maxLines && lines.length >= maxLines) {
    // 放不下就在最后一行加省略号
    const last = lines[maxLines - 1];
    let t = last;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    lines[maxLines - 1] = t + '…';
    return lines.slice(0, maxLines);
  }
  return lines;
}

// 画一段文字，返回下一行的 y
function drawText(ctx, text, x, y, opt) {
  const o = opt || {};
  ctx.font = o.font || '14px sans-serif';
  ctx.fillStyle = o.color || '#0f172a';
  ctx.textAlign = o.align || 'left';
  const maxW = o.maxWidth || (CARD_W - x * 2);
  const lines = wrapText(ctx, text, maxW, o.maxLines || 99);
  const lh = o.lineHeight || 20;
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
  ctx.textAlign = 'left';
  return y + lines.length * lh;
}

// 动作标签流式排布（一排排，放不下自动换行），返回下一行的 y
function drawChips(ctx, labels, x, y, maxW, opt) {
  const o = opt || {};
  const h = o.h || 30;
  const gapX = o.gapX || 8;
  const gapY = o.gapY || 8;
  const padX = o.padX || 12;
  const limit = o.max || 12;
  ctx.font = o.font || '14px sans-serif';
  let cx = x, cy = y, rows = 1;
  (labels || []).slice(0, limit).forEach(lb => {
    const tw = ctx.measureText(String(lb)).width;
    const w = tw + padX * 2;
    if (cx + w > x + maxW && cx > x) { cx = x; cy += h + gapY; rows++; }
    ctx.fillStyle = o.bg || '#e0f2fe';
    roundRect(ctx, cx, cy, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = o.color || '#0369a1';
    ctx.textAlign = 'center';
    ctx.fillText(String(lb), cx + w / 2, cy + h / 2 + 5);
    ctx.textAlign = 'left';
    cx += w + gapX;
  });
  return cy + h + gapY;
}

// 只量不画：先算 chips 需要多高，才能先把卡片底画出来（否则底会盖住字）
function chipsSize(ctx, labels, maxW, opt) {
  const o = opt || {};
  const h = o.h || 30, gapX = o.gapX || 8, gapY = o.gapY || 8, padX = o.padX || 12;
  const limit = o.max || 12;
  ctx.font = o.font || '14px sans-serif';
  let cx = 0, rows = 1;
  (labels || []).slice(0, limit).forEach(lb => {
    const w = ctx.measureText(String(lb)).width + padX * 2;
    if (cx + w > maxW && cx > 0) { cx = 0; rows++; }
    cx += w + gapX;
  });
  return { rows: rows, h: rows * h + (rows - 1) * gapY };
}

function drawCard(ctx, x, y, w, h, opt) {
  const o = opt || {};
  ctx.fillStyle = o.fill || '#ffffff';
  roundRect(ctx, x, y, w, h, o.r || 16);
  ctx.fill();
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// 底部水印：只留 App 名，不放"数据只在你账号下"这类解释（看的人不关心）
function watermark(ctx, text) {
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#b6c6d4';
  ctx.textAlign = 'center';
  ctx.fillText(text || '花样滑冰训练', CARD_W / 2, CARD_H - 22);
  ctx.textAlign = 'left';
}

// 把"自动生成的动作行"和"教练说的/我写的"分开：
// 记录里的 content 既包含勾选动作自动生成的行，也包含用户自己写的要点。
// 动作已经用 chips 呈现了，文字区只留后者，避免同一件事说两遍。
function splitNoteLines(content, moveNames) {
  const names = (moveNames || []).filter(Boolean);
  const auto = [], notes = [];
  String(content || '').split('\n').forEach(raw => {
    const line = String(raw).trim();
    if (!line) return;
    const m = /^【(.+?)】/.exec(line);
    if (m && names.indexOf(m[1]) > -1) { auto.push(line); return; }   // 勾选动作生成的行
    if (!m && /^\d+[.、]\s*/.test(line)) return;                      // 组合序号行（动作 chips 里已有）
    if (!m && /^[　\s]*\d+[.、]\s*/.test(line)) return;
    notes.push(line);
  });
  return { auto: auto, notes: notes };
}

// ---------- C 卡：单次训练卡 ----------
function weekdayCn(dateStr) {
  const p = String(dateStr || '').split('-').map(Number);
  if (!p[0] || !p[1] || !p[2]) return '';
  return '周' + '日一二三四五六'[new Date(p[0], p[1] - 1, p[2]).getDay()];
}

// 把一条记录整理成"卡片要用的数据"。
// ⚠️ 关键：时长和教练名在这里就按开关置空——不是在画的时候才判断，
//    这样以后不管谁调用，都不可能"忘了过滤"把不该露的信息露出去。
function recordCardData(rec, opts) {
  const o = opts || {};
  const r = rec || {};
  const t = TYPES[r.type] || {};
  const md = MODES[r.mode] || {};
  const moved = {};
  (r.drills || []).forEach(id => {
    const f = store.drillById(id);
    if (f) (moved[f.move.id] = moved[f.move.id] || []).push(f.drill.name);
  });
  const actions = (r.moves || []).map(id => store.moveById(id)).filter(Boolean).map(mv => ({
    name: mv.name,
    drills: moved[mv.id] || []
  }));
  let exam = '', examCd = '';
  const eid = (r.examPicks || [])[0];
  if (eid) {
    const ov = store.ensureExams().filter(e => e && e.id === eid)[0];
    if (ov) {
      exam = ((EXAM_KINDS[ov.kind] || {}).name || '') + ' · ' + ov.level;
      examCd = ov.date ? util.countdownText(ov.date, exam) : '';
    }
  }
  const note = splitNoteLines(r.content, actions.map(a => a.name));
  return {
    date: r.date || '', weekday: weekdayCn(r.date),
    typeText: t.name || '', typeEmoji: t.emoji || '',
    modeText: String(md.name || '').replace(/^[^\u4e00-\u9fa5A-Za-z]+/, ''),
    actions: actions,
    notes: note.notes,
    exam: exam, examCd: examCd,
    duration: o.withDuration ? (Number(r.duration) || 0) : 0,
    coach: o.withCoach ? String(r.coach || '').trim() : ''
  };
}

// 单次训练卡的版式：所有块都按"上一块返回的 y"往下走，不会互相压到
function drawTrainingCard(ctx, d) {
  const W = CARD_W, H = CARD_H;
  const PAD = 30;
  ctx.fillStyle = '#f0f9ff';
  ctx.fillRect(0, 0, W, H);

  // 头部：日期 + 类型
  let y = 62;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0369a1';
  ctx.font = 'bold 30px sans-serif';
  const dateNum = String(d.date || '').slice(5).replace('-', ' 月 ') + ' 日';
  ctx.fillText(dateNum, PAD, y);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(d.weekday || '', PAD + ctx.measureText('　').width + 190, y);

  y += 22;
  const tags = [];
  if (d.typeText) tags.push((d.typeEmoji ? d.typeEmoji + ' ' : '') + d.typeText);
  if (d.modeText) tags.push(d.modeText);
  if (d.duration) tags.push(d.duration + ' 分钟');
  if (d.coach) tags.push('教练 ' + d.coach);
  y = drawChips(ctx, tags, PAD, y, W - PAD * 2, { h: 28, font: '14px sans-serif' }) + 6;

  // 练了什么（先量出高度 → 画卡片底 → 再写字，顺序不能反，否则底会盖住字）
  const actY = y;
  const labels = d.actions.map(a2 => a2.drills.length ? (a2.name + ' · ' + a2.drills.length + ' 组') : a2.name);
  const chipOpt = { h: 30, font: '15px sans-serif', bg: '#e0f2fe', color: '#0369a1' };
  const actInner = d.actions.length ? chipsSize(ctx, labels, W - PAD * 2 - 32, chipOpt).h : 20;
  const h1 = 18 + 14 + actInner + 12;
  drawCard(ctx, PAD, actY, W - PAD * 2, h1, { fill: '#ffffff', border: '#dbeafe' });
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('这次练了', PAD + 16, actY + 26);
  if (d.actions.length) {
    drawChips(ctx, labels, PAD + 16, actY + 40, W - PAD * 2 - 32, chipOpt);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px sans-serif';
    ctx.fillText('（没有勾选动作）', PAD + 16, actY + 48);
  }
  y = actY + h1 + 16;

  // 教练说的 / 我写的（同样先底后字）
  const notes = d.notes || [];
  if (notes.length) {
    const noteY = y;
    const reserve = (d.examCd ? 40 : 0) + 46;
    const room = H - (noteY + 44) - reserve;
    const maxLines = Math.max(2, Math.min(8, Math.floor(room / 22)));
    const lines = wrapText(ctx, notes.join('\n'), W - PAD * 2 - 32, 99);
    const shown = lines.slice(0, maxLines);
    const truncated = lines.length > shown.length;
    const drawn = shown.length + (truncated ? 1 : 0);
    const h2 = 30 + drawn * 22 + 10;
    drawCard(ctx, PAD, noteY, W - PAD * 2, h2, { fill: '#ffffff', border: '#dbeafe' });
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('教练说的 / 我的笔记', PAD + 16, noteY + 20);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#0f172a';
    shown.forEach((ln, i) => ctx.fillText(ln, PAD + 16, noteY + 44 + i * 22));
    if (truncated) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('…', PAD + 16, noteY + 44 + shown.length * 22);
    }
    y = noteY + h2 + 14;
  }

  if (d.examCd) {
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#b45309';
    ctx.fillText('⏳ ' + d.examCd, PAD, Math.min(y + 22, H - 54));
  }
  watermark(ctx, '花样滑冰训练');
}

// 统一的导出流程：找画布 → 按 dpr 放大 → 交给调用方画 → 导出文件 → 存相册 → 可转发
function exportImage(opts, draw) {
  const o = opts || {};
  const W = o.width || CARD_W, H = o.height || CARD_H;
  wx.showLoading({ title: '正在生成…', mask: true });
  const q = wx.createSelectorQuery();
  q.select(o.selector || '#shareCanvas').fields({ node: true, size: true }).exec(res => {
    const node = res && res[0] && res[0].node;
    if (!node) { wx.hideLoading(); wx.showToast({ title: '生成失败（画布没找到）', icon: 'none' }); return; }
    let dpr = 2;
    try { dpr = Math.min(2, (wx.getSystemInfoSync().pixelRatio) || 2); } catch (e) {}
    node.width = W * dpr;
    node.height = H * dpr;
    const ctx = node.getContext('2d');
    ctx.scale(dpr, dpr);
    try { draw(ctx, W, H); } catch (e) { wx.hideLoading(); wx.showToast({ title: '绘制出错', icon: 'none' }); return; }
    wx.canvasToTempFilePath({
      canvas: node,
      success: r => {
        wx.hideLoading();
        const p = r.tempFilePath;
        const after = () => { if (wx.showShareImageMenu) wx.showShareImageMenu({ path: p, fail: () => {} }); else wx.previewImage({ urls: [p] }); };
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
}

module.exports = {
  CARD_W, CARD_H, NO_SHARE,
  roundRect, wrapText, drawText, drawChips, chipsSize, drawCard, watermark,
  splitNoteLines, exportImage, recordCardData, drawTrainingCard, weekdayCn
};
