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
function summarize(series) {
  const a = (series || []).filter(v => typeof v === 'number' && isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const q = p => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  return { n: a.length, min: a[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: a[a.length - 1] };
}

// ---------- 单帧指标 ----------
// pts: [{x,y}] 归一化坐标（[0,1]，y 向下）；map: {head:idx, ...}
// 返回 { ok, bodyH, legGap, kneeL, kneeR, trunkTilt, cogOffset, oneFoot }
function frameMetrics(pts, map, side, minConf) {
  // 每个关键点：有映射、且置信度达标才可用（个别关节不可信时，只让它参与的指标缺失，
  // 而不是把整帧丢掉 —— 以前"一个脚踝不可信 → 整帧作废"就是"有效帧 0"的主因）
  const C = (typeof minConf === 'number') ? minConf : 0.5;
  const P = k => {
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
  const head = P('head'), neck = P('neck'), hipL = P('hipL'), hipR = P('hipR');
  const ankL = P('ankL'), ankR = P('ankR');
  const kneeL = P('kneeL'), kneeR = P('kneeR');
  const shL = P('shL'), shR = P('shR');

  const out = { ok: false, have: [], miss: [], conf: {} };
  ['head', 'neck', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'].forEach(k => {
    const c = confOf(k);
    out.conf[k] = c;
    if (!P(k)) out.miss.push(k);
  });

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const angleAt = (a, b, c) => (a && b && c) ? Math.abs(Math.atan2(c.y - b.y, c.x - b.x) * 180 / Math.PI - Math.atan2(a.y - b.y, a.x - b.x) * 180 / Math.PI) : null;
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
    out.trunkTilt = Math.abs(Math.atan2(neck.x - hipC.x, hipC.y - neck.y) * 180 / Math.PI);
  }
  // 重心前偏：髋中点 vs 支撑踝（画面里更低的那只脚）
  if (hipL && hipR && (ankL || ankR)) {
    const support = (ankL && ankR) ? (ankL.y >= ankR.y ? ankL : ankR) : (ankL || ankR);
    const hipC = mid(hipL, hipR);
    if (bodyH > 0.05) out.cogOffset = (hipC.x - support.x) / bodyH * (side === 'left' ? -1 : 1);
  }
  if (out.legGap != null) out.oneFoot = out.legGap > 0.08;

  out.have = ['bodyH', 'legGap', 'kneeL', 'kneeR', 'trunkTilt', 'cogOffset'].filter(k => out[k] != null);
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
  frameMetrics: frameMetrics, POSE_TARGETS: POSE_TARGETS, judge: judge
};
