// 姿态自查：视频分析用的指标算法（离线：可做双向平滑、离群剔除、置信度加权）

// ---------- 基础几何 ----------
function angleAt(a, b, c) {                 // 顶点 b 的夹角（度）
  if (!a || !b || !c) return null;
  const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
  const d = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (!d) return null;
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
}
function mid(a, b) { return (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null; }
function dist(a, b) { return (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : null; }

// ---------- 序列处理 ----------
function median(arr) {
  const a = (arr || []).filter(v => typeof v === 'number' && isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function medianFilter(series, win) {
  const w = Math.max(1, Math.floor((win || 3) / 2));
  return (series || []).map((v, i) => {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    const seg = [];
    for (let k = i - w; k <= i + w; k++) {
      const x = series[k];
      if (typeof x === 'number' && isFinite(x)) seg.push(x);
    }
    return median(seg);
  });
}
// MAD 稳健离群剔除：超出 k 倍中位绝对偏差的值置为 null
function rejectOutliers(series, k) {
  const vals = (series || []).filter(v => typeof v === 'number' && isFinite(v));
  const m = median(vals);
  if (m == null || vals.length < 5) return (series || []).slice();
  const dev = vals.map(v => Math.abs(v - m));
  const mad = median(dev) || 0;
  const lim = (k || 3.5) * 1.4826 * mad;
  if (!lim) return (series || []).slice();
  return (series || []).map(v => (typeof v === 'number' && isFinite(v) && Math.abs(v - m) <= lim) ? v : null);
}
// ---------- 拍摄质量闸门 ----------
// 关键：指标的噪声取决于"人体在画面里占多少像素"。实测（Monte Carlo，见 CHANGELOG）：
//   180px 高 · 2px 抖动 → 膝角 ±1.9°
//    68px 高 · 2px 抖动 → 膝角 ±5.0°
//    68px 高 · 4px 抖动 → 膝角 ±10.1°，单足判定错判 34%
// 所以先算"人体像素高度"，再决定给不给数、给几个小数。
function quality(bodyHPx, frameH) {
  const px = Math.round(bodyHPx || 0);
  const frac = frameH ? (bodyHPx / frameH) : 0;
  // 噪声模型：误差 ∝ 1/人体像素高度（用实测两点拟合：68px→5.0°，180px→1.9°）
  const kneeErr = px > 20 ? Math.min(30, 340 / px) : 30;
  const hipErr = px > 20 ? Math.min(12, 122 / px) : 12;        // % 身高
  const legErr = px > 20 ? Math.min(15, 156 / px) : 15;        // % 身高
  let level = 'poor', note = '';
  if (px >= 180) { level = 'good'; note = '拍摄达标，数值可参考'; }
  else if (px >= 120) { level = 'fair'; note = '人体偏小，数值有误差（已标注）'; }
  else { level = 'poor'; note = '拍摄不达标：人体只有 ' + px + 'px 高，量化数值不可信'; }
  return {
    px: px, frac: Math.round(frac * 1000) / 1000, level: level, note: note,
    err: { knee: Math.round(kneeErr * 10) / 10, hip: Math.round(hipErr * 10) / 10, leg: Math.round(legErr * 10) / 10 },
    // 低于这个值就别给数字了：误差已经吃掉判定区间
    usable: px >= 120
  };
}

// 映射合理性自检：不是"对不对"，而是抓那种一眼就错的（比如踝跑到头上面）
function sanityCheck(pts, map) {
  const M = (map && Object.keys(map).length) ? map : DEFAULT_MAP;
  const at = k => { const i = M[k]; return (pts && i != null && i >= 0 && pts[i]) ? pts[i] : null; };
  const warns = [];
  const head = at('head'), ankL = at('ankL'), ankR = at('ankR');
  const hipL = at('hipL'), hipR = at('hipR'), kneeL = at('kneeL'), kneeR = at('kneeR');
  if (head && ankL && ankR && head.y > Math.max(ankL.y, ankR.y)) warns.push('头比踝还低：映射可能错位（人或镜像）');
  // 人体解剖上的硬约束：髋在踝上方、膝在踝上方。违反 = 点序错了（最常见的错是把手腕当踝）
  if (hipL && hipR && ankL && ankR) {
    const ankY = Math.max(ankL.y, ankR.y);
    if ((hipL.y + hipR.y) / 2 >= ankY - 0.02) warns.push('髋不在踝上方：映射明显错位');
  }
  if (kneeL && kneeR && ankL && ankR) {
    const ankY = Math.max(ankL.y, ankR.y);
    if ((kneeL.y + kneeR.y) / 2 >= ankY - 0.02) warns.push('膝不在踝上方：映射明显错位');
  }
  if (head && ankL && ankR) {
    const span = Math.abs(head.y - Math.max(ankL.y, ankR.y));
    if (!(span > 0.15)) warns.push('头到踝的纵向跨度只有 ' + (Math.round(span * 100) / 100) + '：点没对到人身上');
  }
  if (hipL && hipR && kneeL && kneeR && kneeL.y < Math.min(hipL.y, hipR.y) - 0.15) warns.push('膝在髋上方太多：映射可能错位');
  if (ankL && ankR && Math.abs(ankL.y - ankR.y) > 0.5) warns.push('两踝高度差超过半屏：可能把别的点当踝了');
  return warns;
}

// 峰峰值（用于横向摆动幅度等"范围"类指标）
function peakToPeak(series) {
  const a = (series || []).filter(v => typeof v === 'number' && isFinite(v));
  if (a.length < 3) return null;
  return Math.max.apply(null, a) - Math.min.apply(null, a);
}

// 周期检测（自相关）：返回周期（单位=样本数）与置信度。用于"压步节奏""单足换脚"这类反复动作。
// 做法朴素但够用：去均值 → 自相关 → 在 lag ∈ [4, 采样数/2] 里找最大峰。
function dominantPeriod(series, minLag, maxLag) {
  const raw = (series || []).map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
  const idx = raw.map((v, i) => v == null ? -1 : i).filter(i => i >= 0);
  if (idx.length < 12) return null;
  // 只在连续段里算（中间有 null 就用最大连续段）
  let best = { a: 0, b: 0 }, cur = { a: idx[0], b: idx[0] };
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === idx[i - 1] + 1) cur.b = idx[i];
    else { if (cur.b - cur.a > best.b - best.a) best = cur; cur = { a: idx[i], b: idx[i] }; }
  }
  if (cur.b - cur.a > best.b - best.a) best = cur;
  const seg = raw.slice(best.a, best.b + 1);
  if (seg.length < 12) return null;
  const mean = seg.reduce((x, y) => x + y, 0) / seg.length;
  const d = seg.map(v => v - mean);
  const lo = Math.max(2, Math.round(minLag || 4));
  const hi = Math.min(Math.floor(seg.length / 2), Math.round(maxLag || 60));
  let bestLag = -1, bestVal = -2;
  let varSum = 0;
  for (let i = 0; i < d.length; i++) varSum += d[i] * d[i];
  if (!varSum) return null;
  for (let lag = lo; lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < d.length; i++) acc += d[i] * d[i + lag];
    const v = acc / varSum;                          // 归一化自相关
    if (v > bestVal) { bestVal = v; bestLag = lag; }
  }
  if (bestLag < 0 || bestVal < 0.25) return null;     // 相关性太弱认为"没有明显节律"
  return { lag: bestLag, strength: bestVal, n: seg.length, from: best.a, to: best.b };
}

function summarize(series) {
  const a = (series || []).filter(v => typeof v === 'number' && isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const q = p => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  return { n: a.length, min: a[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: a[a.length - 1] };
}

// ---------- 单帧指标 ----------
// pts: [{x,y}] 归一化坐标（[0,1]，y 向下）；map: {head:idx, ...}
// 返回 { ok, bodyH, legGap, kneeL, kneeR, trunkTilt, cogOffset, oneFoot }
// 默认映射：VisionKit 的 detectBody 返回的是 COCO 顺序的 17 个点
//   0 鼻 · 1/2 眼 · 3/4 耳 · 5/6 肩 · 7/8 肘 · 9/10 腕 · 11/12 髋 · 13/14 膝 · 15/16 踝
// 有它就不必手工校准了；校准只是"顺序不对/换个模型"时的修正手段。
// neck 用 -1 表示"由两肩中点算出来"（COCO 里没有脖子这个点）。
const DEFAULT_MAP = {
  head: 0, neck: -1, shL: 5, shR: 6, hipL: 11, hipR: 12,
  kneeL: 13, kneeR: 14, ankL: 15, ankR: 16
};

// aspect = 画面宽/高。**必填**，否则角度会错：
// 归一化坐标里 x、y 都映射到 0..1，但 16:9 画面里"x 的 1"只有"y 的 1"的 9/16 那么长。
// 直接用归一化坐标算角度，一个真实的 45° 会被测成 60.6°（横屏）或 29.4°（竖屏）。
// 修法：算角度前把 x 乘以 aspect，还原成各向同性的空间。
function frameMetrics(pts, map0, side, minConf, aspect0) {
  const map = (map0 && Object.keys(map0).length) ? map0 : DEFAULT_MAP;
  const AR = (aspect0 > 0.1 && aspect0 < 10) ? aspect0 : 1;
  // 只用于算角度的投影函数
  const AX = p => p ? { x: p.x * AR, y: p.y } : null;
  // 每个关键点：有映射、且置信度达标才可用（个别关节不可信时，只让它参与的指标缺失，
  // 而不是把整帧丢掉 —— 以前"一个脚踝不可信 → 整帧作废"就是"有效帧 0"的主因）
  const C = (typeof minConf === 'number') ? minConf : 0.5;
  const blockedK = {};                                  // 被判定为"离群"的关节
  let outOfRange = [];
  const P = k => {
    if (blockedK[k]) return null;
    if (!pts || typeof map[k] !== 'number') return null;
    const p = pts[map[k]];
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
    if (p.c !== undefined && p.c < C) return null;      // 置信度不够的关节当"没有"
    return p;
  };
  const confOf = k => {
    if (!pts || typeof map[k] !== 'number') return null;
    const p = pts[map[k]];
    return (p && p.c !== undefined) ? p.c : (p ? 1 : null);
  };
  // ---- 先剔除明显离群的点（模型的误检：偶尔在画面角落冒一个孤立点）----
  // 做法：用所有已映射点的中位位置当"人体中心"，距离超过中位距离 3 倍以上的当噪声。
  const mapped = [];
  ['head', 'neck', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'].forEach(k => {
    const p = P(k);
    if (p) mapped.push({ k: k, p: p });
  });
  if (mapped.length >= 5) {
    // 用"人体包围盒 + 半个体长"当合理范围：模型偶尔会在画面角落冒一个孤立点，
    // 如果它被当成头/踝，bodyH 就会算错（真机上表现为"左上角多一个点，指标全乱"）
    // 用 10%–90% 分位算范围：**不能让离群点自己参与定范围**（否则它永远"在范围内"）
    const pct = (arr, t) => { const a = arr.slice().sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.round((a.length - 1) * t))]; };
    const xsA = mapped.map(o => o.p.x), ysA = mapped.map(o => o.p.y);
    const minX = pct(xsA, 0.1), maxX = pct(xsA, 0.9);
    const minY = pct(ysA, 0.1), maxY = pct(ysA, 0.9);
    const span = Math.max(0.06, Math.max(maxX - minX, maxY - minY));
    const pad = span * 0.5;
    const badK = [];
    mapped.forEach(o => {
      const x = o.p.x, y = o.p.y;
      if (x < minX - pad || x > maxX + pad || y < minY - pad || y > maxY + pad) badK.push(o.k);
    });
    badK.forEach(k => { blockedK[k] = true; });
    outOfRange = badK;
  }

  const head = P('head'), hipL = P('hipL'), hipR = P('hipR');
  const neckDirect = P('neck');
  const neck = neckDirect || ((P('shL') && P('shR')) ? { x: (P('shL').x + P('shR').x) / 2, y: (P('shL').y + P('shR').y) / 2, c: Math.min(P('shL').c == null ? 1 : P('shL').c, P('shR').c == null ? 1 : P('shR').c) } : null);
  const ankL = P('ankL'), ankR = P('ankR');
  const kneeL = P('kneeL'), kneeR = P('kneeR');
  const shL = P('shL'), shR = P('shR');

  const out = { ok: false, have: [], miss: [], conf: {} };
  (outOfRange || []).forEach(k => { out.miss.push(k + '(离群)'); });
  ['head', 'neck', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'].forEach(k => {
    const c = confOf(k);
    out.conf[k] = c;
    if (k === 'neck') { if (!neck) out.miss.push(k); return; }
    if (!P(k)) out.miss.push(k);
  });



  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const angleAt = (a, b, c) => {
    const A = AX(a), B = AX(b), C = AX(c);
    return (A && B && C) ? Math.abs(Math.atan2(C.y - B.y, C.x - B.x) * 180 / Math.PI - Math.atan2(A.y - B.y, A.x - B.x) * 180 / Math.PI) : null;
  };
  const ang = (a, b, c) => {
    if (!a || !b || !c) return null;
    let v = angleAt(a, b, c);
    if (v == null) return null;
    if (v > 180) v = 360 - v;
    return v;
  };

  // 身高（头顶 → 更低那只踝）：只要头和一只踝就够
  const minAnkY = Math.max(ankL ? ankL.y : -1, ankR ? ankR.y : -1);
  const bodyH = (head && minAnkY >= 0) ? Math.abs(head.y - minAnkY) : null;
  if (bodyH != null && bodyH > 0.05) out.bodyH = bodyH;

  // 浮足高度差：两只踝都要
  if (ankL && ankR && bodyH > 0.05) out.legGap = Math.abs(ankL.y - ankR.y) / bodyH;

  // 膝角：各自一侧的三个点
  if (hipL && kneeL && ankL) out.kneeL = ang(hipL, kneeL, ankL);
  if (hipR && kneeR && ankR) out.kneeR = ang(hipR, kneeR, ankR);

  // 上身前倾：颈 + 髋中点
  if (neck && hipL && hipR) {
    const hipC = mid(hipL, hipR);
    out.trunkTilt = Math.abs(Math.atan2((neck.x - hipC.x) * AR, hipC.y - neck.y) * 180 / Math.PI);
  }
  // 重心前偏：髋中点 vs 支撑踝（画面里更低的那只脚）
  if (hipL && hipR && (ankL || ankR)) {
    const support = (ankL && ankR) ? (ankL.y >= ankR.y ? ankL : ankR) : (ankL || ankR);
    const hipC = mid(hipL, hipR);
    if (bodyH > 0.05) out.cogOffset = ((hipC.x - support.x) * AR) / bodyH;
    if (out.cogOffset != null && side === 'left') out.cogOffset *= -1;
  }
  if (out.legGap != null) out.oneFoot = out.legGap > 0.08;

  // ---------- 通用指标（跟动作无关，任何花滑动作都能看） ----------
  const hipC = (hipL && hipR) ? mid(hipL, hipR) : null;
  const shC = (shL && shR) ? mid(shL, shR) : null;
  // 髋高度：髋中点比"更低那只踝"高多少（按身高归一）→ 蹲得深不深、起速有没有起来
  if (hipC && bodyH > 0.05) {
    const lowAnk = Math.max(ankL ? ankL.y : -1, ankR ? ankR.y : -1);
    if (lowAnk >= 0) out.hipH = (lowAnk - hipC.y) / bodyH;
  }
  // 肩线 / 髋线倾角（度；0=水平，正=右高）
  if (shL && shR) out.shAng = Math.atan2(shR.y - shL.y, (shR.x - shL.x) * AR) * 180 / Math.PI;
  if (hipL && hipR) out.hipAng = Math.atan2(hipR.y - hipL.y, (hipR.x - hipL.x) * AR) * 180 / Math.PI;
  // 髋中点横向位置（用于"横向摆动幅度"与"节奏"）
  if (hipC) out.hipX = hipC.x;
  // 头—髋连线相对竖直的倾角（整体轴线，比"上身前倾"更中性）
  if (head && hipC) out.axisTilt = Math.abs(Math.atan2((hipC.x - head.x) * AR, hipC.y - head.y) * 180 / Math.PI);

  out.aspect = AR;
  out.have = ['bodyH', 'legGap', 'kneeL', 'kneeR', 'trunkTilt', 'cogOffset',
              'hipH', 'shAng', 'hipAng', 'hipX', 'axisTilt'].filter(k => out[k] != null);
  out.ok = out.have.length > 0;                 // 只要有一个指标能用，这帧就有价值
  // 兼容旧调用方
  out.lowConf = out.miss.length > 0;
  out.noMap = out.have.length === 0 && out.miss.length > 0;
  const cs = Object.keys(out.conf).map(k => out.conf[k]).filter(v => v != null);
  if (cs.length) { out.avgConf = cs.reduce((a, b) => a + b, 0) / cs.length; out.minConf = Math.min.apply(null, cs); }
  return out;
}

// ---------- 动作检查项目标（阈值可按自己情况调整）----------
// dir: 'min' 表示越大越好（≥ 目标），'max' 表示越小越好（≤ 目标）
const POSE_TARGETS = {
  freeLeg:  { name: '浮足高于支撑踝', unit: '%身高', dir: 'min', good: 0.15, warn: 0.08,
              hint: '浮足抬得越高越接近"浮腿不低于髋"，可用燕式/步法自查' },
  trunkFlat:{ name: '上身压低（燕式）', unit: '°(与水平)', dir: 'max', good: 25, warn: 40,
              hint: '燕式/燕转要求上体前俯接近水平，角度越小越"压平"' },
  trunkUp:  { name: '上身前倾（步法）', unit: '°(与竖直)', dir: 'max', good: 15, warn: 25,
              hint: '步法里上身过度前倾通常意味着重心跑到前面' },
  cogFront: { name: '重心前偏', unit: '%身高', dir: 'max', good: 0.06, warn: 0.12,
              hint: '髋中点相对支撑脚踝的水平偏移，偏大=前倾/后坐' },
  kneeHold: { name: '支撑膝角', unit: '°', dir: 'min', good: 150, warn: 130,
              hint: '支撑腿是否塌（角度过小=蹲得太深/无力）' }
};

function judge(key, value) {
  const t = POSE_TARGETS[key];
  if (!t || value == null) return { state: 'na', text: '—' };
  const ok = t.dir === 'min' ? (value >= t.good) : (value <= t.good);
  const warn = t.dir === 'min' ? (value >= t.warn) : (value <= t.warn);
  return { state: ok ? 'good' : (warn ? 'warn' : 'bad'), text: ok ? '达标' : (warn ? '接近' : '需改进') };
}

module.exports = {
  angleAt: angleAt, mid: mid, dist: dist,
  median: median, medianFilter: medianFilter, rejectOutliers: rejectOutliers, summarize: summarize,
  frameMetrics: frameMetrics, POSE_TARGETS: POSE_TARGETS, judge: judge, peakToPeak: peakToPeak, dominantPeriod: dominantPeriod, DEFAULT_MAP: DEFAULT_MAP, sanityCheck: sanityCheck, quality: quality
};
