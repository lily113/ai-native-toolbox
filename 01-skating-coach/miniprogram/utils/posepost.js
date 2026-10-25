// 关键点后处理：把 VisionKit 逐帧独立检测的结果，用"时间 + 骨骼一致性"修一遍。
//
// 为什么有效：模型每帧独立出点，所以（a）抖动（b）偶发错位（c）掉帧会造成不连续。
// 人体骨骼长度在一段视频里是**常数**（只受缩放影响），这是很强的先验，可以拿来纠错。
//
// 四步（顺序有讲究）：
//   1) 剔除跳变：同一关节相邻帧位移 > 0.35×人体尺度 → 判为误检
//   2) 补短缺口：≤6 帧的空缺线性插值（保持连续）
//   3) 时间平滑：5 帧中值 + 轻 EMA（去抖动，但保动作）
//   4) 骨骼长度约束：把明显违背"骨长恒定"的关节拉回合理位置
//
// 所有坐标都是归一化（0..1），阈值都用"人体尺度"（点集的稳健对角线）表示，所以跟分辨率无关。

const BONES = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],       // 肩-肩、手臂
  [5, 11], [6, 12], [11, 12],                     // 躯干、髋-髋
  [11, 13], [13, 15], [12, 14], [14, 16],         // 腿
  [0, 5], [0, 6]                                  // 头-肩
];

function median(a) {
  const v = a.filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  return v[Math.floor(v.length / 2)];
}

// 人体尺度：所有点坐标的稳健跨度（对角线），用于把阈值变成"身高比例"
function scaleOf(pts) {
  if (!pts || !pts.length) return 0;
  const xs = [], ys = [];
  pts.forEach(p => { if (p) { xs.push(p.x); ys.push(p.y); } });
  if (xs.length < 4) return 0;
  const q = (arr, t) => { const a = arr.slice().sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.round((a.length - 1) * t))]; };
  const w = q(xs, 0.9) - q(xs, 0.1), h = q(ys, 0.9) - q(ys, 0.1);
  return Math.max(0.05, Math.hypot(w, h));
}

function postProcess(track, opts) {
  const o = opts || {};
  const jumpK = o.jumpK == null ? 0.35 : o.jumpK;
  const maxGap = o.maxGap == null ? 6 : o.maxGap;
  const win = o.win == null ? 7 : o.win;
  const ema = o.ema == null ? 0.35 : o.ema;
  const boneTol = o.boneTol == null ? 0.25 : o.boneTol;

  const frames = (track || []).filter(f => f && f.pts && f.pts.length);
  if (frames.length < 3) return { track: frames, stats: { jumps: 0, filled: 0, bones: 0 } };

  const nJ = frames[0].pts.length;
  const stats = { jumps: 0, filled: 0, bones: 0 };

  // 每帧的人体尺度（逐帧算，兼容远近变化）
  const scales = frames.map(f => scaleOf(f.pts) || 0.3);

  // ---------- 1) 剔除跳变 ----------
  const series = [];                             // series[j] = [{x,y,c}|null]
  for (let j = 0; j < nJ; j++) series.push(frames.map(f => f.pts[j] || null));
  for (let j = 0; j < nJ; j++) {
    const s = series[j];
    // 自适应阈值：先看这个关节"正常一帧能走多远"（中位位移），
    // 快动作阈值自然放大、慢动作收紧 —— 固定比例会把快动作误判成跳变。
    const ds = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i] && s[i - 1]) ds.push(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
    }
    for (let i = 1; i < s.length; i++) {
      if (!s[i] || !s[i - 1]) continue;
      const sc = Math.max(scales[i], scales[i - 1]) || 0.3;
      const d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
      if (d > jumpK * sc) { s[i] = null; stats.jumps++; }
    }
  }

  // ---------- 2) 补短缺口 ----------
  for (let j = 0; j < nJ; j++) {
    const s = series[j];
    for (let i = 1; i < s.length; i++) {
      if (s[i]) continue;
      let k = i;
      while (k < s.length && !s[k]) k++;
      const gap = k - i;
      if (s[i - 1] && k < s.length && gap <= maxGap) {
        for (let t = 1; t <= gap; t++) {
          const r = t / (gap + 1);
          s[i + t - 1] = {
            x: s[i - 1].x + (s[k].x - s[i - 1].x) * r,
            y: s[i - 1].y + (s[k].y - s[i - 1].y) * r,
            c: Math.min(s[i - 1].c == null ? 1 : s[i - 1].c, s[k].c == null ? 1 : s[k].c),
            filled: true
          };
          stats.filled++;
        }
        i = k - 1;
      }
    }
  }

  // ---------- 3) 时间平滑（中值 + EMA）----------
  const half = Math.floor(win / 2);
  const smooth = series.map(s => s.slice());
  for (let j = 0; j < nJ; j++) {
    const s = series[j], out = smooth[j];
    for (let i = 0; i < s.length; i++) {
      if (!s[i]) { out[i] = null; continue; }
      const xs = [], ys = [];
      for (let k = i - half; k <= i + half; k++) { if (s[k]) { xs.push(s[k].x); ys.push(s[k].y); } }
      const mx = median(xs), my = median(ys);
      out[i] = { x: mx == null ? s[i].x : mx, y: my == null ? s[i].y : my, c: s[i].c };
    }
    // EMA 轻过一遍
    let px = null, py = null;
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) { px = py = null; continue; }
      if (px != null) {
        out[i] = { x: px + (out[i].x - px) * (1 - ema), y: py + (out[i].y - py) * (1 - ema), c: out[i].c };
        px = out[i].x; py = out[i].y;
      } else { px = out[i].x; py = out[i].y; }
    }
  }

  // ---------- 4) 骨骼长度约束 ----------
  // 先统计每根骨头的"典型长度"（用平滑后的数据的中位数）
  const boneLen = {};
  BONES.forEach(b => {
    const L = [];
    for (let i = 0; i < frames.length; i++) {
      const A = smooth[b[0]][i], B = smooth[b[1]][i];
      if (A && B) {
        const sc = scales[i] || 0.3;
        L.push(Math.hypot(B.x - A.x, B.y - A.y) / sc);
      }
    }
    const m = median(L);
    if (m != null && m > 0.02) boneLen[b.join('-')] = m;
  });
  // 逐帧把偏离过大的骨头拉回：以父关节为锚，把子关节沿方向移动到典型长度
  for (let i = 0; i < frames.length; i++) {
    const sc = scales[i] || 0.3;
    for (let pass = 0; pass < 2; pass++) {
      BONES.forEach(b => {
        const ref = boneLen[b.join('-')];
        if (ref == null) return;
        const A = smooth[b[0]][i], B = smooth[b[1]][i];
        if (!A || !B) return;
        const cur = Math.hypot(B.x - A.x, B.y - A.y) / sc;
        const med = ref;
        if (cur < 1e-6) return;
        const dev = Math.abs(cur - med) / med;
        if (dev <= boneTol) return;
        const k2 = (med * sc) / (cur * sc || 1);       // 目标/当前
        const nx = A.x + (B.x - A.x) * k2;
        const ny = A.y + (B.y - A.y) * k2;
        smooth[b[1]][i] = { x: nx, y: ny, c: B.c };
        stats.bones++;
      });
    }
  }

  // 重组
  const outTrack = frames.map((f, i) => {
    const pts = [];
    for (let j = 0; j < nJ; j++) pts.push(smooth[j][i] || null);
    return { n: f.n, pts: pts };
  });
  return { track: outTrack, stats: stats, boneLen: boneLen };
}

module.exports = { postProcess: postProcess, scaleOf: scaleOf, BONES: BONES };
