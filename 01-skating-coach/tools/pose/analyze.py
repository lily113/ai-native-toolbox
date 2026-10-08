#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
花样滑冰 · 视频姿态自查（电脑端）

用法：
    ./build.sh                                   # 首次：编译关键点提取工具
    python3 analyze.py <视频文件> [选项]

选项：
    --step N        采样步长：每 N 帧取 1 帧（默认 1 = 全帧率，最准；N 越大越快）
    --start 秒      只分析这一段（默认整段）
    --end 秒
    --height-cm H   你的身高（用于把"占身高比例"换算成厘米）
    --out DIR       报告输出目录（默认：视频同目录下 <视频名>_分析/）

输出：
    report.md       文字报告（基本统计 + 检查项 + 关键时刻）
    series.csv      逐帧指标（可用 Excel/Numbers 画图）
    chart.png       指标曲线图（4 联图）

说明：
- 关键点用 macOS 自带 Vision 框架（VNDetectHumanBodyPoseRequest），与 iOS 端 WeChat VisionKit 同源；
- 关节语义已知，**不需要校准**（这一点比手机端省事）；
- 只能看"关节几何"：浮足高度、两腿夹角、膝角、上身前倾/压平、重心前后偏移、单足保持时长、节奏；
  用刃（内/外刃）、跳跃高度、快速旋转圈数、定级判定 **测不了**。
"""
import argparse, csv, json, math, os, statistics as st, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.join(HERE, 'vid')

# Vision 关节名 → 我们的键（Vision 坐标为 y 向上，脚本内统一翻转为 y 向下）
JOINTS = {
    'head':  'head_joint',
    'neck':  'neck_1_joint',
    'shL':   'left_shoulder_1_joint',
    'shR':   'right_shoulder_1_joint',
    'hipL':  'left_upLeg_joint',
    'hipR':  'right_upLeg_joint',
    'kneeL': 'left_leg_joint',
    'kneeR': 'right_leg_joint',
    'ankL':  'left_foot_joint',
    'ankR':  'right_foot_joint',
}

# 检查项阈值（与小程序 utils/pose.js 保持一致，可按自己的情况调）
TARGETS = {
    'freeLeg':   dict(name='浮足高度（两踝垂直差）', unit='%身高', dir='min', good=0.15, warn=0.08),
    'trunkFlat': dict(name='上身压低（与水平夹角，燕式越小越好）', unit='°', dir='max', good=25, warn=40),
    'cogFront':  dict(name='重心前后偏移（髋 vs 支撑踝）', unit='%身高', dir='max', good=0.06, warn=0.12),
    'kneeHold':  dict(name='支撑膝角（P10，越小说明越塌）', unit='°', dir='min', good=150, warn=130),
    'trunkUp':   dict(name='上身前倾（步法，中位）', unit='°', dir='max', good=15, warn=25),
}


# ---------------- 基础工具 ----------------
def median(a):
    a = [v for v in a if v is not None]
    return st.median(a) if a else None


def median_filter(series, win=5):
    w = max(1, win // 2)
    out = []
    for i, v in enumerate(series):
        if v is None:
            out.append(None); continue
        seg = [x for x in series[max(0, i - w):i + w + 1] if x is not None]
        out.append(st.median(seg) if seg else None)
    return out


def reject_outliers(series, k=3.5):
    vals = [v for v in series if v is not None]
    if len(vals) < 5:
        return list(series)
    m = st.median(vals)
    mad = st.median([abs(v - m) for v in vals]) or 0
    lim = k * 1.4826 * mad
    if not lim:
        return list(series)
    return [v if (v is not None and abs(v - m) <= lim) else None for v in series]


def clean(series):
    """趋势序列：全局离群剔除 + 中值滤波（用于中位数/区间）"""
    return median_filter(reject_outliers(series), 5)


def peak_clean(series):
    """保峰序列：只做中值滤波（用于最大值/高峰，避免把真实的短暂高峰当噪声删掉）"""
    return median_filter(series, 3)


def summarize(series):
    a = sorted(v for v in series if v is not None)
    if not a:
        return None
    q = lambda p: a[min(len(a) - 1, max(0, round((len(a) - 1) * p)))]
    return dict(n=len(a), min=a[0], p10=q(.1), median=q(.5), p90=q(.9), max=a[-1])


def angle(a, b, c):
    if not (a and b and c):
        return None
    v1 = (a[0] - b[0], a[1] - b[1]); v2 = (c[0] - b[0], c[1] - b[1])
    d = math.hypot(*v1) * math.hypot(*v2)
    if not d:
        return None
    return math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))))


# ---------------- 关键点提取 ----------------
def run_tool(*args):
    r = subprocess.run([VID] + list(args), capture_output=True, text=True)
    return r.stdout.strip()


def video_meta(path):
    out = run_tool(path, 'meta')
    meta = {}
    for line in out.split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            meta[k.strip()] = v.strip()
    fps = float(meta.get('fps', '30').split()[0])
    dur = float(meta.get('duration', '0').split()[0])
    return dict(fps=fps, duration=dur, raw=meta)


def extract_keypoints(path, step, min_conf):
    """返回 (rows, quality)
    rows: [(t, {joint: (x, y)}, {joint: conf})]，坐标已翻转为 y 向下
    quality: 关键点质量统计
    """
    tmp = os.path.join(HERE, '_kp.jsonl')
    run_tool(path, 'pose4', tmp, str(step))
    rows = []
    conf_sum = {k: [] for k in JOINTS}
    need = ['head', 'neck', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']
    good_frames = 0
    total = 0
    for line in open(tmp, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        total += 1
        pts = r.get('points') or {}
        frame, conf = {}, {}
        for key, vname in JOINTS.items():
            p = pts.get(vname)
            if p:
                conf[key] = p[2]
                conf_sum[key].append(p[2])
                if p[2] > 0.0:
                    frame[key] = (p[0], 1.0 - p[1])
        if all(conf.get(k, 0) >= min_conf for k in need):
            good_frames += 1
        rows.append((r['t'], frame, conf))
    try:
        os.remove(tmp)
    except OSError:
        pass
    mean_conf = {k: (st.mean(v) if v else 0) for k, v in conf_sum.items()}
    quality = dict(total=total, good=good_frames,
                   ratio=(good_frames / total if total else 0),
                   meanConf=mean_conf, minConf=min_conf)
    return rows, quality


# ---------------- 指标 ----------------
def frame_metrics(fr, conf=None, min_conf=0.5):
    need = ['head', 'neck', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']
    if not all(k in fr for k in need):
        return None
    if conf is not None and not all(conf.get(k, 0) >= min_conf for k in need):
        return None                      # 关键点不可信 → 丢弃该帧（避免把"猜出来的踝"当数据）
    head, neck = fr['head'], fr['neck']
    hipc = ((fr['hipL'][0] + fr['hipR'][0]) / 2, (fr['hipL'][1] + fr['hipR'][1]) / 2)
    ankL, ankR = fr['ankL'], fr['ankR']
    body = abs(head[1] - max(ankL[1], ankR[1]))
    if body <= 0.05:
        return None
    support = ankL if ankL[1] >= ankR[1] else ankR
    return dict(
        bodyH=body,
        legGap=abs(ankL[1] - ankR[1]) / body,
        kneeL=angle(fr['hipL'], fr['kneeL'], ankL),
        kneeR=angle(fr['hipR'], fr['kneeR'], ankR),
        trunkTilt=abs(math.degrees(math.atan2(neck[0] - hipc[0], hipc[1] - neck[1]))),
        cog=(hipc[0] - support[0]) / body,
        legHDist=abs(ankL[0] - ankR[0]) / body,
        oneFoot=abs(ankL[1] - ankR[1]) / body > 0.08,
    )


def judge(key, value):
    t = TARGETS[key]
    if value is None:
        return '—', 'na'
    ok = value >= t['good'] if t['dir'] == 'min' else value <= t['good']
    warn = value >= t['warn'] if t['dir'] == 'min' else value <= t['warn']
    return ('达标' if ok else ('接近' if warn else '需改进')), ('good' if ok else ('warn' if warn else 'bad'))


def one_foot_flags(leg_gaps, start=0.10, stop=0.06):
    """带滞回的单足判定：>start 进入、<stop 退出"""
    flags, on = [], False
    for v in leg_gaps:
        if v is None:            # 该帧被质量门限丢弃 → 保持段就此中断
            on = False
            flags.append(False)
            continue
        if not on and v > start:
            on = True
        elif on and v < stop:
            on = False
        flags.append(on)
    return flags


def longest_one_foot(flags, dt):
    best = cur = 0
    best_t = cur_t = None
    for i, f in enumerate(flags):
        if f:
            if cur == 0:
                cur_t = i
            cur += 1
            if cur > best:
                best, best_t = cur, cur_t
        else:
            cur = 0
    return (best * dt if best else 0), (best_t * dt if best_t is not None else None)


# ---------------- 主流程 ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--start', type=float, default=None)
    ap.add_argument('--end', type=float, default=None)
    ap.add_argument('--height-cm', type=float, default=0)
    ap.add_argument('--out', default=None)
    ap.add_argument('--min-conf', type=float, default=0.5,
                    help='关键点置信度门限（默认 0.5；越低越宽容但噪声越大）')
    ap.add_argument('--element', default='none', choices=['none', 'camel', 'step'],
                    help='动作类型：camel=燕式/燕转（判浮足高度+上身压平）；step=步法（判上身前倾+重心+浮足距离+膝角）；none=只给客观数字')
    args = ap.parse_args()

    if not os.path.exists(VID):
        print('❌ 缺少关键点工具，请先运行 ./build.sh'); sys.exit(1)
    if not os.path.exists(args.video):
        print('❌ 找不到视频：%s' % args.video); sys.exit(1)

    meta = video_meta(args.video)
    fps = meta['fps'] or 30.0
    dt = args.step / fps
    print('视频: %s' % os.path.basename(args.video))
    print('  %s · %.1ffps · %.1f 秒 · 采样步长 %d（实际 %.1f 帧/秒）' %
          (meta['raw'].get('size', '?'), fps, meta['duration'], args.step, 1 / dt))

    print('提取关键点中…（%s）' % ('全帧率' if args.step == 1 else '每 %d 帧取 1' % args.step))
    rows, quality = extract_keypoints(args.video, args.step, args.min_conf)
    lo = args.start if args.start is not None else 0
    hi = args.end if args.end is not None else 1e9
    rows = [r for r in rows if lo <= r[0] <= hi]
    print('  采样帧 %d' % len(rows))

    series = dict(t=[], legGap=[], legHDist=[], kneeL=[], kneeR=[], trunk=[], cog=[], one=[])
    loose_leg = []
    for t, fr, conf in rows:
        m = frame_metrics(fr, conf, args.min_conf)
        m2 = frame_metrics(fr, conf, 0.15)        # 宽松门限（仅用于峰值参考）
        series['t'].append(t)
        if m2:
            loose_leg.append(m2['legGap'])
        else:
            loose_leg.append(None)
        if m:
            series['legGap'].append(m['legGap'])
            series['legHDist'].append(m['legHDist'])
            series['kneeL'].append(m['kneeL'])
            series['kneeR'].append(m['kneeR'])
            series['trunk'].append(m['trunkTilt'])
            series['cog'].append(m['cog'])
            series['one'].append(m['oneFoot'])
        else:
            for k in ('legGap', 'legHDist', 'kneeL', 'kneeR', 'trunk', 'cog'):
                series[k].append(None)
            series['one'].append(False)

    need_k = ['head', 'neck', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']
    q_total = len(rows)
    q_good = sum(1 for _, _, cf in rows if all(cf.get(k, 0) >= args.min_conf for k in need_k))
    quality.update(total=q_total, good=q_good, ratio=(q_good / q_total if q_total else 0))
    print('  关键点质量：合格帧 %d / %d = %.0f%%（门限 %.2f）' % (q_good, q_total, quality['ratio'] * 100, args.min_conf))
    ok = [i for i, v in enumerate(series['legGap']) if v is not None]
    if len(ok) < 5:
        print('❌ 有效帧太少（%d）：请确认主体在画面中清晰、占比够大' % len(ok)); sys.exit(1)

    C = {k: clean(series[k]) for k in ('legGap', 'legHDist', 'kneeL', 'kneeR', 'trunk', 'cog')}
    P = {k: peak_clean(series[k]) for k in ('legGap', 'legHDist', 'kneeL', 'kneeR', 'trunk', 'cog')}
    sLegTrend, sKL, sKR, sTr = summarize(C['legGap']), summarize(C['kneeL']), summarize(C['kneeR']), summarize(C['trunk'])
    sLeg = summarize(P['legGap'])          # 浮足高度用保峰序列（燕式是短暂高峰）
    sTrPeak = summarize(P['trunk'])        # 上身“最平时刻”也用保峰序列
    sLooseLeg = summarize(median_filter(loose_leg, 3))   # 宽松门限（含低置信帧）的峰值参考
    sH = summarize(P['legHDist'])
    sCog = summarize([abs(v) for v in C['cog'] if v is not None])
    one_flags = one_foot_flags(P['legGap'])          # 用保峰序列：真实高峰保留，单帧抖动仍被中值滤波压掉
    hold_s, hold_t = longest_one_foot(one_flags, dt)
    H = args.height_cm or 0

    def pct(v):
        if v is None: return '—'
        return ('%.1f cm' % (v * H)) if H else ('%.1f%%身高' % (v * 100))

    outdir = args.out or os.path.join(os.path.dirname(os.path.abspath(args.video)),
                                      os.path.splitext(os.path.basename(args.video))[0] + '_分析')
    os.makedirs(outdir, exist_ok=True)

    # CSV
    csv_path = os.path.join(outdir, 'series.csv')
    with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['时间(s)', '浮足高度差(占身高)', '两踝水平距(占身高)', '左膝角(度)', '右膝角(度)', '上身前倾(度)', '重心偏移(占身高)', '单足'])
        for i, t in enumerate(series['t']):
            w.writerow([round(t, 3)] + [('' if series[k][i] is None else round(series[k][i], 4))
                                        for k in ('legGap', 'legHDist', 'kneeL', 'kneeR', 'trunk', 'cog')] + [1 if series['one'][i] else 0])

    # 关键时刻
    def peak(arr, times, mode='max'):
        vals = [(i, v) for i, v in enumerate(arr) if v is not None]
        if not vals: return None, None
        i, v = (max(vals, key=lambda x: x[1]) if mode == 'max' else min(vals, key=lambda x: x[1]))
        return v, times[i]

    legMax, legMaxT = peak(P['legGap'], series['t'], 'max')
    trunkMinAbs, trunkMinT = None, None
    if sTr:
        flat = [(i, 90 - v) for i, v in enumerate(P['trunk']) if v is not None]   # 用保峰序列找“最平时刻”
        i, v = min(flat, key=lambda x: x[1])
        trunkMinAbs, trunkMinT = v, series['t'][i]
    kneeMin, kneeMinT = peak(P['kneeL'], series['t'], 'min')

    md = []
    md.append('# 姿态自查报告\n')
    md.append('- 视频：`%s`' % os.path.basename(args.video))
    md.append('- 规格：%s · %.1f fps · %.1f 秒' % (meta['raw'].get('size', '?'), fps, meta['duration']))
    md.append('- 分析区间：%.1f–%.1f 秒 · 采样 %d 帧（%.1f 帧/秒）· 有效帧 %d' %
              (lo, min(hi, meta['duration']), len(rows), 1 / dt, sLeg['n']))
    if H:
        md.append('- 身高换算：%g cm' % H)
    md.append('')
    md.append('## 关键点质量\n')
    md.append('- 合格帧：**%d / %d = %.0f%%**（置信度门限 %.2f）' % (quality['good'], quality['total'], quality['ratio'] * 100, quality['minConf']))
    mc = sorted(quality['meanConf'].items(), key=lambda x: -x[1])
    md.append('- 各关节平均置信度：' + ' · '.join('%s %.2f' % (k, v) for k, v in mc))
    if quality['ratio'] < 0.5:
        md.append('')
        md.append('> ⚠️ **合格帧不足一半**：说明当前机位下部分关节（通常是远端踝/膝）经常识别不到。')
        md.append('> 常见原因：**不是正侧面**（浮腿向后伸展被身体遮挡、透视缩短）、距离太远、主体偏小、多人干扰。')
        md.append('> 建议按"侧面机位 · 距 2.5–3.5 米 · 全身入镜 · 冰面可见"重拍，指标会稳定得多。')
    md.append('')
    md.append('## 检查项\n')
    md.append('| 指标 | 数值 | 区间（P10–P90） | 结论 |')
    md.append('|---|---|---|---|')
    EL = {'camel': '燕式 / 燕转', 'step': '步法', 'none': '未指定（只给客观数字）'}[args.element]
    md.append('')
    md.append('> 动作类型：**%s**' % EL)
    md.append('')
    if args.element == 'camel':
        txt, _ = judge('freeLeg', sLeg['p90'] if sLeg else None)
        md.append('| 浮足高度（P90 / 最高） | %s / %s | 中位(趋势) %s | %s |' % (
            pct(sLeg['p90']) if sLeg else '—', pct(sLeg['max']) if sLeg else '—',
            pct(sLegTrend['median']) if sLegTrend else '—', txt))
        if sLooseLeg and sLeg and sLooseLeg['max'] > sLeg['max'] * 1.3:
            md.append('| ⚠️ 参考：含低置信帧的峰值 | %s | — | 置信度低，仅作参考 |' % pct(sLooseLeg['max']))
        txt, _ = judge('trunkFlat', (90 - sTrPeak['min']) if sTrPeak else None)
        md.append('| 上身与水平夹角（最平 / 中位） | %s / %s | — | %s |' % (
            ('%.0f°' % (90 - sTrPeak['min'])) if sTrPeak else '—',
            ('%.0f°' % (90 - sTr['median'])) if sTr else '—', txt))
    elif args.element == 'step':
        txt, _ = judge('trunkUp', sTr['median'] if sTr else None)
        md.append('| 上身前倾（中位，与竖直） | %.0f° | %.0f° – %.0f° | %s |' % (
            sTr['median'], sTr['p10'], sTr['p90'], txt) if sTr else '| 上身前倾 | — | — | — |')
        txt, _ = judge('cogFront', sCog['median'] if sCog else None)
        md.append('| 重心前后偏移（中位） | %s | 最大 %s | %s |' % (pct(sCog['median']) if sCog else '—',
                  pct(sCog['max']) if sCog else '—', txt))
        md.append('| 两踝水平距离（中位，浮足贴近度） | %s | %s – %s | %s |' % (
            pct(sH['median']) if sH else '—', pct(sH['p10']) if sH else '—', pct(sH['p90']) if sH else '—',
            '越接近 0 越贴近' if sH else '—'))
        txt, _ = judge('kneeHold', sKL['p10'] if sKL else None)
        md.append('| 左膝角（中位 / 最小） | %s / %s | — | %s |' % (
            ('%.0f°' % sKL['median']) if sKL else '—', ('%.0f°' % sKL['min']) if sKL else '—', txt))
    else:
        md.append('| 浮足高度（P90 / 中位） | %s / %s | 最高 %s | — |' % (
            pct(sLeg['p90']) if sLeg else '—', pct(sLeg['median']) if sLeg else '—', pct(sLeg['max']) if sLeg else '—'))
        md.append('| 上身前倾（中位，与竖直） | %s | %s – %s | — |' % (
            ('%.0f°' % sTr['median']) if sTr else '—', ('%.0f°' % sTr['p10']) if sTr else '—',
            ('%.0f°' % sTr['p90']) if sTr else '—'))
        md.append('| 上身与水平夹角（最平） | %s | — | — |' % (('%.0f°' % (90 - sTrPeak['min'])) if sTrPeak else '—'))
        md.append('| 两踝水平距离（中位） | %s | — | — |' % (pct(sH['median']) if sH else '—'))
        md.append('| 重心前后偏移（中位） | %s | 最大 %s | — |' % (pct(sCog['median']) if sCog else '—',
                  pct(sCog['max']) if sCog else '—'))
        md.append('| 左膝角（中位 / 最小） | %s / %s | — | — |' % (
            ('%.0f°' % sKL['median']) if sKL else '—', ('%.0f°' % sKL['min']) if sKL else '—'))
        md.append('')
        md.append('> 用 `--element camel`（燕式/燕转）或 `--element step`（步法）重跑，报告会给出**达标判定**；')
        md.append('> 也可以加 `--start 12 --end 18` 只分析其中一段（比如只分析保持段）。')
    md.append('| 单足最长保持 | %.1f 秒%s | — | — |' % (hold_s, ('（起于 %.1f 秒）' % (hold_t + lo)) if hold_t is not None else ''))
    md.append('')
    md.append('## 关键时刻\n')
    if legMax is not None:
        md.append('- 浮足抬高最大：**%s**（%.1f 秒）' % (pct(legMax), legMaxT))
    if trunkMinAbs is not None:
        md.append('- 上身最接近水平：**%.0f°**（%.1f 秒）' % (trunkMinAbs, trunkMinT))
    if kneeMin is not None:
        md.append('- 支撑膝最弯：**%.0f°**（%.1f 秒）' % (kneeMin, kneeMinT))
    md.append('- 单足帧占比：**%.0f%%**' % (100 * sum(1 for v in series['one'] if v) / len(series['one'])))
    md.append('')
    md.append('## 能看 / 不能看\n')
    md.append('✅ 浮足高度、两腿夹角、膝角、上身前倾/压平、重心前后偏移、单足保持时长、节奏')
    md.append('')
    md.append('❌ **用刃（内/外刃）**、跳跃高度、快速旋转圈数、定级判定 —— 这些需要刀刃与冰面接触信息，'
              '单目视频在物理上拿不到（刀刃仅 3–4.7mm 厚，3 米外约 2–3 像素）')
    md.append('')
    md.append('> 本报告是"关节在画面里的几何量"，只作**自查参考**，不代表技术是否达标。')
    report = os.path.join(outdir, 'report.md')
    open(report, 'w', encoding='utf-8').write('\n'.join(md))

    # 图
    try:
        os.environ.setdefault('MPLCONFIGDIR', os.path.join(HERE, '.mplcache'))
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        # 中文字体（macOS 自带）
        plt.rcParams['font.sans-serif'] = ['PingFang SC', 'Hiragino Sans GB', 'Heiti TC', 'Arial Unicode MS', 'DejaVu Sans']
        plt.rcParams['axes.unicode_minus'] = False
        fig, axs = plt.subplots(4, 1, figsize=(11, 12), sharex=True)
        panels = [('legGap', '浮足高度差（占身高）', '#0284c7'),
                  ('kneeL', '左膝角（度）', '#16a34a'),
                  ('trunk', '上身前倾（与竖直夹角，度）', '#ea580c'),
                  ('cog', '重心前后偏移（占身高，正=偏前）', '#9333ea')]
        for ax, (k, title, color) in zip(axs, panels):
            ax.plot(series['t'], [v if v is not None else float('nan') for v in series[k]],
                    color=color, lw=0.7, alpha=0.28)                    # 原始（淡）
            ax.plot(series['t'], [v if v is not None else float('nan') for v in C[k]],
                    color=color, lw=1.9)                                # 平滑去离群（主）
            med = median(series[k])
            if med is not None:
                ax.axhline(med, color='#f59e0b', ls='--', lw=1)
            ax.set_ylabel(title, fontsize=9)
            ax.grid(alpha=.25)
        axs[-1].set_xlabel('时间（秒）')
        fig.suptitle('姿态自查 · %s' % os.path.basename(args.video), fontsize=12)
        fig.tight_layout(rect=[0, 0, 1, 0.98])
        fig.savefig(os.path.join(outdir, 'chart.png'), dpi=130)
        print('  ✅ 曲线图: chart.png')
    except Exception as e:
        print('  （绘图跳过：%s）' % e)

    print('  ✅ 报告: %s' % report)
    print('  ✅ 数据: %s' % csv_path)
    print()
    for line in md:
        if line.startswith('|') and '---' not in line:
            print('  ' + line)


if __name__ == '__main__':
    main()
