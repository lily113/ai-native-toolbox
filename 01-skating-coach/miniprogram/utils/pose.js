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
function frameMetrics(pts, map, side) {
  const P = k => (pts && typeof map[k] === 'number' && pts[map[k]]) ? pts[map[k]] : null;
  const need = ['head', 'neck', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'];
  if (!need.every(k => P(k))) return { ok: false };
  // 置信度门限：关键点不可信时丢弃该帧（避免把"猜出来的关节"当数据）
  const MIN_CONF = 0.5;
  if (!need.every(k => { const p = pts[map[k]]; return p && (p.c === undefined || p.c >= MIN_CONF); })) return { ok: false, lowConf: true };
  const head = P('head'), neck = P('neck');
  const hipC = mid(P('hipL'), P('hipR'));
  const ankL = P('ankL'), ankR = P('ankR');
  const bodyH = Math.abs(head.y - Math.max(ankL.y, ankR.y));
  if (!(bodyH > 0.05)) return { ok: false };
  // 浮足高度差：两踝垂直距离 / 身高
  const legGap = Math.abs(ankL.y - ankR.y) / bodyH;
  // 膝角
  const kneeL = angleAt(P('hipL'), P('kneeL'), ankL);
  const kneeR = angleAt(P('hipR'), P('kneeR'), ankR);
  // 上身前倾：髋中点→颈 相对竖直方向的角度（0 = 直立，90 = 水平）
  const trunkTilt = Math.abs(Math.atan2(neck.x - hipC.x, hipC.y - neck.y) * 180 / Math.PI);
  // 重心前后偏移：髋中点相对“支撑脚踝”的水平偏移（正=偏前，按身高归一）
  const support = (ankL.y >= ankR.y) ? ankL : ankR;      // 画面里更低的那只脚视为支撑脚
  const cogOffset = (hipC.x - support.x) / bodyH * (side === 'left' ? -1 : 1);
  // 单足：一踝明显高于另一踝
  const oneFoot = legGap > 0.08;
  return { ok: true, bodyH: bodyH, legGap: legGap, kneeL: kneeL, kneeR: kneeR, trunkTilt: trunkTilt, cogOffset: cogOffset, oneFoot: oneFoot };
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
