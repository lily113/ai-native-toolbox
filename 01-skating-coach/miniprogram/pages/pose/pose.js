const store = require('../../utils/store');
const pose = require('../../utils/pose');
const yuv = require('../../utils/yuv');
const { POSE_JOINTS } = require('../../utils/const');

// 姿态自查（视频分析）：
//   选相册视频 → VideoDecoder 逐帧解码 → VKSession.detectBody（静态图片模式）→ 关键点序列
//   → 离线平滑 + 离群剔除 → 客观指标 + 动作检查项
// 视频不上传、不保存；帧数据用完即丢。基础库要求：VideoDecoder ≥2.11.0，人体检测 ≥2.28.0
const MIN_SDK_BODY = '2.28.0';
const MIN_SDK_DEC = '2.11.0';
const HIT_R = 0.10;              // 点选校准命中半径（归一化到首帧图）

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

Page({
  data: {
    supported: true,
    blockTip: '',
    // 视频
    videoPath: '',
    videoInfo: '',            // 时长/尺寸
    step: 2,                  // 每 N 帧取 1 帧
    stepOptions: [1, 2, 3],
    maxSide: 640,             // 降采样后的长边上限
    // 校准
    calibrated: false,
    heightCm: 0,
    calibrating: false,
    calibIdx: 0,
    calibText: '',
    // 分析
    analyzing: false,
    progress: 0,
    decoded: 0,
    detected: 0,
    formatNote: '',           // 像素格式自检结论
    yuvLayout: 'nv12',        // YUV 布局（诊断会试 nv12/nv21/i420 并记住可用的）
    zoomed: false,            // 校准画布是否放大到人物
    zoomText: '',             // 放大倍数（让用户看到"确实放大了"）
    cfgYuv: '',
    diag: [],                 // 诊断信息（可复制）
    downscale: true,          // 高分辨率视频先降采样再检测
    cfgName: '',              // 实际生效的 VisionKit 配置
    // 结果
    rangeStart: '',
    rangeEnd: '',
    checks: [],               // 动作检查项
    stats: [],                // 指标统计
    general: [],              // 通用指标（跟动作无关）
    big: [],                  // 三个大数字
    quality: null,            // 拍摄质量（决定数值可信度）
    highlights: [],           // 最值得看的 3 个瞬间
    seekBusy: false,          // 正在跳到某一帧
    summaryText: '',          // 一句人话结论
    advice: [],               // 训练建议
    trackN: 0,                // 已存的关键点帧数（>0 才能回放叠加）
    playing: false,
    hud: null,                // 回放时叠加在画面上的实时数字
    playerH: 200,             // 回放画布高度（按视频比例算出来）
    showIdx: false,           // 是否叠加关键点序号（核对点序用）
    advOpen: false,           // 高级区（关键点映射）默认收起
    playPct: 0,
    playTime: '0.0s',
    chartKey: 'legGap',
    chartTitle: '',
    legend: []
  },

  onLoad() {
    const map = store.load(store.KEYS.poseMap);
    const calibrated = !!(map && POSE_JOINTS.every(j => typeof map[j.k] === 'number'));
    this._map = calibrated ? map : null;      // 没校准过就用内置默认映射
    const meta = store.load(store.KEYS.meta) || {};
    this.setData({ calibrated: calibrated, heightCm: Number(meta.heightCm) || 0 });
    this.checkSupport();
  },
  onUnload() { this.cleanup(); },

  checkSupport() {
    let sdk = '0', plat = '';
    try {
      const si = wx.getSystemInfoSync() || {};
      sdk = si.SDKVersion || '0';
      plat = si.platform || si.system || '';
    } catch (e) {}
    let tip = '';
    if (typeof wx.createVKSession !== 'function') tip = '当前环境不支持人体检测（VisionKit）：请用真机预览，开发者工具不支持';
    else if (cmpVer(sdk, MIN_SDK_BODY) < 0) tip = '需要基础库 ≥ ' + MIN_SDK_BODY + '（当前 ' + sdk + '）';
    else if (typeof wx.createVideoDecoder !== 'function') tip = '当前环境不支持视频逐帧解码（需基础库 ≥ ' + MIN_SDK_DEC + '）';
    this._sdk = sdk; this._platform = plat;
    this.setData({ supported: !tip, blockTip: tip });
  },

  setStep(e) {
    const v = Number(e.currentTarget.dataset.v) || 2;
    this.setData({ step: v });
  },

  // ---------- 选视频 ----------
  pickVideo() {
    if (this.data.analyzing) return;
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album'], maxDuration: 60,
      success: res => {
        const f = (res.tempFiles || [])[0];
        if (!f || !f.tempFilePath) return;
        this.setData({ videoPath: f.tempFilePath, videoInfo: '时长 ' + Math.round(f.duration || 0) + ' 秒 · ' + (f.size ? Math.round(f.size / 1048576 * 10) / 10 + ' MB' : ''), progress: 0, decoded: 0, detected: 0, checks: [], stats: [], formatNote: '' });
        // 补充真实尺寸/帧率
        if (typeof wx.getVideoInfo === 'function') {
          wx.getVideoInfo({
            src: f.tempFilePath,
            success: v => {
              this._totalFrames = Math.max(1, Math.round((v.duration || 0) * (v.fps || 30)));
              this._fps = v.fps || 30;
              this.setData({
                videoInfo: '时长 ' + (Math.round(v.duration * 10) / 10) + ' 秒 · ' + v.width + '×' + v.height +
                  ' · ' + Math.round(v.fps || 0) + 'fps · ' + (f.size ? Math.round(f.size / 1048576 * 10) / 10 + ' MB' : '')
              });
            }
          });
        }
        if (!this.data.calibrated) {
          wx.showModal({
            title: '先校准关键点', content: '首次使用需点选一次关键点（约 1 分钟）：分析时会先取一帧，请按提示依次点选关节。',
            showCancel: false
          });
        }
      }
    });
  },

  // ---------- 分析主流程 ----------
  analyze() {
    if (this.data.analyzing) return;
    if (!this.data.videoPath) { wx.showToast({ title: '先选一个视频', icon: 'none' }); return; }
    if (!this.data.supported) { wx.showToast({ title: '当前环境不支持', icon: 'none' }); return; }
    this.initWorkCanvas();
    this._detCount = 0; this._detErr = 0; this._frames = 0; this._flushT = 0; this._lowConf = 0;
    this._th = 0.5; this._miss = 0; this._frameCv = null; this._frameW = 0; this._frameH = 0;
    this._view = null; this._calibBox = null;
    this._minConf = this._minConf || 0.5;
    this._skipBusy = 0;
    this._track = []; this._bodyPx = []; this._aspect = 0;
    this._noMapN = 0; this._noMapKeys = []; this._confSum = 0; this._confN = 0; this._confOkSum = 0; this._confOkN = 0;
    this.setData({ analyzing: true, progress: 0, decoded: 0, detected: 0, checks: [], stats: [], formatNote: '', diag: ['开始分析…'] });
    this._series = { t: [], legGap: [], kneeL: [], kneeR: [], trunkTilt: [], cogOffset: [], oneFoot: [], bodyH: [],
                     hipH: [], shAng: [], hipAng: [], hipX: [], axisTilt: [] };
    this._firstPts = null;

    // ① 检测会话（用「测试一帧」选出的配置）
    let session = null;
    try {
      const opt = { track: { body: { mode: 2 } } };
      if (this.data.cfgName === 'v2') opt.version = 'v2';
      session = wx.createVKSession(opt);
      if (session && session.state === 0 && this.data.cfgName === 'v2') {
        try { session.destroy(); } catch (e) {}
        session = wx.createVKSession({ track: { body: { mode: 2 } } });
        this.setData({ cfgName: '默认版本' });
      }
      if (!session) throw new Error('无法创建人体检测会话');
    } catch (e) {
      this.setData({ analyzing: false });
      wx.showModal({ title: '无法启动', content: String(e.message || e), showCancel: false });
      return;
    }
    this._session = session;
    session.on('updateAnchors', anchors => {
      if (this._pending) { const r = this._pending; this._pending = null; r(anchors); }
    });
    try { session.start(() => {}); } catch (e) {}

    // ② 解码器：先按“最快速度”(mode=1)启动，2 秒内出不来首帧就换 mode=0
    this.startDecoder(1);
    this.waitFirstFrame();
  },

  startDecoder(mode) {
    try { if (this._dec) { this._dec.stop(); this._dec.remove(); } } catch (e) {}
    let dec = null;
    try { dec = wx.createVideoDecoder(); } catch (e) {
      this.pushDiag('创建解码器失败: ' + (e.message || e));
      this.finish(); return false;
    }
    this._dec = dec;
    this._endedFlag = false;
    try { dec.on('ended', () => { this._endedFlag = true; }); } catch (e) {}
    try {
      dec.start({ source: this.data.videoPath, mode: mode, abortAudio: true });
      this.pushDiag('解码器已启动（mode=' + mode + '）');
    } catch (e) {
      this.pushDiag('启动解码异常: ' + (e.message || e));
      return false;
    }
    return true;
  },

  pushDiag(line) {
    const d = (this.data.diag || []).slice();
    if (d.length < 12) { d.push(line); this.setData({ diag: d }); }
  },

  // 等首帧：最多等 6 秒（mode=1 等 2 秒后自动换 mode=0 再等 4 秒）
  waitFirstFrame() {
    const t0 = Date.now();
    let triedFallback = false;
    const tick = () => {
      if (!this.data.analyzing) return;
      let f = null;
      try { f = this._dec.getFrameData(); } catch (e) { this.pushDiag('取帧异常: ' + (e.message || e)); }
      if (f && f.data) {
        this.pushDiag('收到首帧：' + f.width + '×' + f.height + '（用时 ' + Math.round((Date.now() - t0) / 100) / 10 + 's）');
        this._firstFrame = f;
        this.loopFrames();
        return;
      }
      const el = Date.now() - t0;
      if (!triedFallback && el > 2000) {
        triedFallback = true;
        this.pushDiag('2 秒未出帧 → 换用 mode=0（按 pts 解码）重试');
        if (!this.startDecoder(0)) { this.finish(); return; }
      }
      if (el > 6000 || this._endedFlag) {
        this.pushDiag(this._endedFlag ? '解码器已结束（未取到任何帧）' : '等待 6 秒仍未取到解码帧');
        this.finish();
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  },

  // 逐帧循环（分批让出主线程；卡住超过 3 秒就收尾）
  loopFrames() {
    const step = this.data.step;
    let idx = 0, stall = 0;
    const BATCH = 6, STALL_MS = 3000;
    let lastOk = Date.now();

    const next = () => {
      if (!this.data.analyzing) return;
      let i = 0;
      while (i < BATCH) {
        let f = null;
        try { f = this._dec.getFrameData(); } catch (e) {}
        if (!f || !f.data) {
          stall++;
          if (this._endedFlag) { this.pushDiag('解码结束：共 ' + idx + ' 帧'); this.finish(); return; }
          if (Date.now() - lastOk > STALL_MS) { this.pushDiag('解码卡住（' + STALL_MS + 'ms 无新帧），提前收尾'); this.finish(); return; }
          break;                                     // 缓冲空：让出主线程再取
        }
        stall = 0; lastOk = Date.now();
        const n = idx++;
        if (n % step === 0) {
          const busy = !!this._pending;
          this.detectOne(f, n);
          if (busy) this._skipBusy = (this._skipBusy || 0) + 1;
        }
        if (n % 8 === 0) this.flushProgress(n);
        i++;
      }
      this.flushProgress(idx);
      setTimeout(next, 0);
    };
    next();
  },

  // 统一的"有效映射"：`{}` 或残缺的映射会让所有连线都画不出来（连环画全黑就是这个）
  getMap() {
    let m = this._map;
    if (!m) { try { m = store.load(store.KEYS.poseMap); } catch (e) { m = null; } }
    const need = ['head', 'neck', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'];
    const okMap = m && need.every(k => typeof m[k] === 'number');
    if (okMap && this._mapBad) return pose.DEFAULT_MAP;    // 已被判定为"明显不对"
    return okMap ? m : pose.DEFAULT_MAP;
  },

  // 用首帧检验当前映射是否"明显不对"：不对就记下来并退回内置默认（否则所有指标都是 0/垃圾）
  checkMap(pts) {
    if (!pts || !pts.length) return;
    const map = this.getMap();
    const warns = pose.sanityCheck(pts, map);
    // 额外判据：头到踝的纵向跨度太小（说明点和人没对应上）
    const at = k => { const i = map[k]; return (i != null && pts[i]) ? pts[i] : null; };
    const head = at('head'), ankL = at('ankL'), ankR = at('ankR');
    let spanBad = false;
    if (head && ankL && ankR) {
      const span = Math.abs(head.y - Math.max(ankL.y, ankR.y));
      if (!(span > 0.08)) spanBad = true;
    } else {
      spanBad = true;
    }
    if (warns.length || spanBad) {
      const usedCustom = !!(this._map || store.load(store.KEYS.poseMap));
      this._mapBad = true;
      this.setData({
        advOpen: true,
        diag: (this.data.diag || []).concat([
          '⚠️ 当前关键点映射明显不对' + (spanBad ? '（头到踝的纵向跨度太小）' : '') + '：' + (warns.join('；') || '点没对到身上'),
          usedCustom ? '已自动改用内置标准映射（你之前手工校准过，可在页面底部「高级」里恢复/重校）' : '请打开回放的「显示序号」核对一下点序'
        ])
      });
    }
  },

  // ---------- 会话与诊断 ----------
  // 试某个配置：创建 → start → 用一帧做一次 detectBody，报告结果
  tryConfig(name, version, frame) {
    return new Promise(resolve => {
      const out = { name: name, state: -1, anchors: 0, pts: 0, err: '', first: '' };
      let session = null;
      try {
        const opt = { track: { body: { mode: 2 } } };
        if (version) opt.version = version;
        session = wx.createVKSession(opt);
      } catch (e) {
        out.err = '创建失败: ' + (e.message || e);
        resolve({ out: out, session: null });
        return;
      }
      if (!session) { out.err = 'createVKSession 返回空'; resolve({ out: out, session: null }); return; }
      let done = false;
      session.on('updateAnchors', list => {
        const arr = Array.isArray(list) ? list : [];
        out.anchors = arr.length;
        const body = arr.filter(a => a && a.type === 5 && a.points && a.points.length)[0];
        if (body) {
          out.pts = body.points.length;
          const p0 = body.points[0];
          if (p0) out.first = '(' + p0.x.toFixed(3) + ',' + p0.y.toFixed(3) + ')';
        }
      });
      try { session.start(() => {}); } catch (e) { out.err = 'start 失败: ' + (e.message || e); }
      setTimeout(() => {
        out.state = session.state;
        if (frame && !out.err) {
          try {
            const f = this.prepareFrame(frame);
            session.detectBody({ frameBuffer: f.data, width: f.width, height: f.height, scoreThreshold: 0.8, sourceType: 0 });
          } catch (e) { out.err = 'detectBody 抛错: ' + (e.message || e); }
        }
        setTimeout(() => {
          if (done) return;
          done = true;
          resolve({ out: out, session: session });
        }, 800);
      }, 400);
    });
  },

  // ---------- 「测试一帧」：快速判定本机能否做视频人体检测 ----------
  testOne() {
    if (this.data.analyzing) return;
    if (!this.data.videoPath) { wx.showToast({ title: '先选一个视频', icon: 'none' }); return; }
    if (!this.data.supported) { wx.showToast({ title: '当前环境不支持', icon: 'none' }); return; }
    const diag = ['开始诊断…', '基础库 ' + (this._sdk || '?') + ' · ' + (this._platform || '?')];
    this.setData({ analyzing: true, progress: 0, diag: diag });
    this._endedFlag = false;
    if (!this.startDecoder(1)) { this.setData({ analyzing: false }); return; }
    let tries = 0;
    const t0 = Date.now();
    let triedFallback = false;
    const waitFrame = () => {
      let f = null;
      try { f = this._dec.getFrameData(); } catch (e) { diag.push('取帧异常: ' + (e.message || e)); }
      if (f && f.data) { diag.push('✅ 取到解码帧（用时 ' + Math.round((Date.now() - t0) / 100) / 10 + 's）'); run(f); return; }
      const el = Date.now() - t0;
      if (!triedFallback && el > 2000) {
        triedFallback = true;
        diag.push('2 秒未出帧 → 换 mode=0 重试');
        this.setData({ diag: diag });
        if (!this.startDecoder(0)) { this.setData({ analyzing: false, diag: diag }); return; }
      }
      if (el > 8000 || this._endedFlag) {
        diag.push(this._endedFlag ? '❌ 解码器结束但从未取到帧' : '❌ 等待 8 秒仍未取到解码帧');
        this.setData({ analyzing: false, diag: diag });
        this.cleanup();
        return;
      }
      tries++;
      setTimeout(waitFrame, 40);
    };
    const fmt = f => {
      const px = f.width * f.height, bytes = f.data.byteLength || f.data.length || 0;
      if (Math.abs(bytes - px * 4) < px * 0.1) return 'RGBA（4 字节/像素）✅ 符合接口要求';
      if (Math.abs(bytes - px * 1.5) < px * 0.2) return '⚠️ 疑似 YUV420（1.5 字节/像素）——检测接口要 RGBA';
      return '未知（' + bytes + ' 字节 / ' + px + ' 像素）';
    };
    const run = async f => {
      diag.push('解码帧: ' + f.width + '×' + f.height + ' · 格式 ' + fmt(f));
      let working = null;
      // 参数矩阵：阈值 × 来源类型（每个组合发 3 次，给模型预热机会）
      // 帧格式先定：YUV 的话要把三种布局都试一遍（字节数一样，只能靠试）
      const fmtNow = yuv.sniff(f.data.byteLength || f.data.length || 0, f.width, f.height);
      diag.push('像素格式判定: ' + fmtNow + '（' + Math.round((f.data.byteLength || f.data.length || 0) / (f.width * f.height) * 100) / 100 + ' 字节/像素）');
      const layouts = fmtNow === 'yuv420' ? ['nv12', 'nv21', 'i420'] : [''];
      const combos = [];
      layouts.forEach(lay => {
        [0.5, 0.3].forEach(th => { [1, 0].forEach(st => { combos.push({ th: th, st: st, lay: lay }); }); });
      });
      const cfg = { n: '默认版本', v: undefined, opt: {} };
      const r = await this.tryConfig(cfg.n, cfg.v, null);
      const session = r.session;
      diag.push('【' + cfg.n + '】state=' + r.out.state + (r.out.err ? ' · ' + r.out.err : ''));
      if (session) {
        let got = 0;
        for (const cb of combos) {
          let pts = 0;
          for (let k = 0; k < 3; k++) {
            if (cb.lay && this.data.yuvLayout !== cb.lay) this.setData({ yuvLayout: cb.lay });
            const one = await this.detectOnce(session, f, cb.th, cb.st);
            if (one > 0) { pts = one; break; }
          }
          diag.push('  阈值 ' + cb.th + ' · sourceType ' + cb.st + ' · 布局 ' + (cb.lay || '原始') + ' → 关键点 ' + pts + (pts > 0 ? ' ✅' : ''));
          if (pts > 0) { got = pts; break; }
        }
        if (got > 0) working = { name: cfg.n, version: cfg.v, session: session, yuv: this.data.yuvLayout };
        else { try { session.destroy(); } catch (e) {} }
      }
      try { if (working && working.session) working.session.destroy(); } catch (e) {}
      this.cleanup();
      const okLine = working
        ? ('✅ 可用配置：' + working.name + (working.yuv ? ' · YUV 布局 ' + working.yuv : '') + '（分析将使用它）')
        : ('❌ 所有组合都没拿到关键点。'
           + (fmtNow === 'yuv420' ? '已试过 nv12/nv21/i420 三种 YUV 布局仍为 0 —— 多半是本机不支持「静态图片人体检测」。' : '')
           + (fmtNow === 'rgba' ? '帧格式是 RGBA（符合接口），仍为 0 → 本机不支持「静态图片人体检测」。' : ''));
      this.setData({
        analyzing: false,
        diag: diag.concat([okLine]),
        cfgName: working ? working.name : '',
        cfgVersion: working ? (working.version || '') : '',
        cfgYuv: working ? (working.yuv || '') : '',
        formatNote: fmt(f)
      });
    };
    waitFrame();
  },

  detectOnce(session, f, th, st) {
    return new Promise(resolve => {
      let resolved = false;
      const onAnchors = list => {
        const arr = Array.isArray(list) ? list : [];
        const body = arr.filter(a => a && a.type === 5 && a.points && a.points.length)[0];
        if (body && !resolved) { resolved = true; session.off && session.off('updateAnchors', onAnchors); resolve(body.points.length); }
      };
      try { session.on('updateAnchors', onAnchors); } catch (e) {}
      try {
        const prep = this.prepareFrame(f);
        session.detectBody({ frameBuffer: prep.data, width: prep.width, height: prep.height, scoreThreshold: th, sourceType: st });
      } catch (e) {}
      setTimeout(() => { if (!resolved) { resolved = true; try { session.off && session.off('updateAnchors', onAnchors); } catch (e) {} resolve(0); } }, 900);
    });
  },

  // 把首帧画面存进一张离屏画布（校准时要当背景画出来，否则只有一堆黄点，看不出哪个是头）
  captureFrame(prep) {
    try {
      if (!prep || !prep.data) return;
      const w = prep.width, h = prep.height;
      if (!w || !h) return;
      let cv = this._frameCv;
      if (!cv || this._frameW !== w || this._frameH !== h) {
        cv = wx.createOffscreenCanvas ? wx.createOffscreenCanvas({ type: '2d', width: w, height: h }) : null;
        this._frameCv = cv; this._frameW = w; this._frameH = h;
      }
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(w, h);
      img.data.set(new Uint8ClampedArray(prep.data, 0, w * h * 4));
      ctx.putImageData(img, 0, 0);
    } catch (e) { /* 存不下就算了：校准仍然可以点，只是没有背景图 */ }
  },

  // 把帧等比放进画布（letterbox）——点选和绘制必须用同一个矩形，否则会点歪
  fitRect(cw, ch, fw, fh) {
    if (!fw || !fh) return { x: 0, y: 0, w: cw, h: ch };
    const s = Math.min(cw / fw, ch / fh);
    const w = fw * s, h = fh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
  },

  copyDiag() {
    const t = (this.data.diag || []).join('\n') + '\n— 基础库 ' + (this._sdk || '?') + ' · ' + (this._platform || '?');
    wx.setClipboardData({ data: t });
  },

  toggleDownscale() { this.setData({ downscale: !this.data.downscale }); },

  // 高分辨率帧先降采样（减少内存与耗时；检测模型本身也会缩放）
  prepareFrame(f) {
    const maxSide = this.data.maxSide || 640;
    const bytes0 = f.data.byteLength || f.data.length || 0;
    const info = yuv.sniffFrame(bytes0, f.width, f.height);
    const fmt0 = info.fmt;
    const stride0 = info.stride || f.width;

    // ① 先把非 RGBA 的帧转成 RGBA（这一步是之前"0 个关键点"的解药）
    let srcData = f.data, srcW = f.width, srcH = f.height, converted = '';
    if (fmt0 === 'yuv420') {
      const lay = this.data.yuvLayout || 'nv12';
      try {
        srcData = yuv.yuvToRgba(f.data, f.width, f.height, lay, stride0).buffer;
        converted = 'YUV(' + lay + (info.padded ? '·stride' + stride0 : '') + ')→RGBA';
      } catch (e) { return { data: f.data, width: f.width, height: f.height, converted: 'YUV 转换失败: ' + (e.message || e) }; }
    } else if (fmt0 === 'yuv422') {
      // 422 不常见，按 420 的口径试一次（错位也比直接喂强不了多少，但至少能出日志）
      const lay = this.data.yuvLayout || 'nv12';
      try {
        srcData = yuv.yuvToRgba(f.data, f.width, f.height, lay, stride0).buffer;
        converted = 'YUV422(按420处理)→RGBA';
      } catch (e) { return { data: f.data, width: f.width, height: f.height, converted: 'YUV422 转换失败' }; }
    } else if (fmt0 === 'gray') {
      try {
        srcData = yuv.grayToRgba(f.data, f.width, f.height).buffer;
        converted = '灰度' + (info.padded ? '·stride' + stride0 : '') + '→RGBA';
      } catch (e) { return { data: f.data, width: f.width, height: f.height, converted: '灰度转换失败' }; }
    }

    // ② 再按需缩放（缩放走 canvas，输入必须已经是 RGBA）
    if (!this.data.downscale || Math.max(srcW, srcH) <= maxSide) {
      return { data: srcData, width: srcW, height: srcH, converted: converted };
    }
    try {
      const c1 = this._w1, c2 = this._w2;
      if (!c1 || !c2) return { data: srcData, width: srcW, height: srcH, converted: converted };
      const px = srcW * srcH;
      if ((srcData.byteLength || srcData.length) < px * 4) {
        return { data: srcData, width: srcW, height: srcH, converted: converted };
      }
      const scale = maxSide / Math.max(srcW, srcH);
      const w2 = Math.max(2, Math.round(srcW * scale)), h2 = Math.max(2, Math.round(srcH * scale));
      const ctx1 = c1.getContext('2d'), ctx2 = c2.getContext('2d');
      const img = ctx1.createImageData(srcW, srcH);
      img.data.set(new Uint8ClampedArray(srcData, 0, px * 4));
      ctx1.putImageData(img, 0, 0);
      ctx2.clearRect(0, 0, w2, h2);
      ctx2.drawImage(c1, 0, 0, srcW, srcH, 0, 0, w2, h2);
      const out = ctx2.getImageData(0, 0, w2, h2);
      return { data: out.data.buffer, width: w2, height: h2, converted: converted };
    } catch (e) {
      return { data: srcData, width: srcW, height: srcH, converted: converted };
    }
  },

  initWorkCanvas() {
    if (this._w1) return;
    wx.createSelectorQuery().in(this).select('#work1').fields({ node: true }).exec(r1 => {
      wx.createSelectorQuery().in(this).select('#work2').fields({ node: true }).exec(r2 => {
        const c1 = r1 && r1[0] && r1[0].node, c2 = r2 && r2[0] && r2[0].node;
        if (!c1 || !c2) return;
        c1.width = 1280; c1.height = 720;
        c2.width = 640; c2.height = 360;
        this._w1 = c1; this._w2 = c2;
      });
    });
  },

  flushProgress(n) {
    this._frames = n;
    if (this._flushT && Date.now() - this._flushT < 120 && n < (this._totalFrames || 1e9)) return;
    this._flushT = Date.now();
    const total = this._totalFrames || 0;
    const progress = total ? Math.min(99, Math.round(n / total * 100)) : Math.min(99, Math.round(n / (n + 40) * 100));
    this.setData({ progress: progress, decoded: n, detected: this._detCount || 0 });
  },

  // 单帧检测：帧数据 → frameBuffer → detectBody → 等 updateAnchors
  detectOne(f, n) {
    // ⚠️ 关键：同一时刻只允许一个 detectBody 在飞。
    // 以前解码循环不等检测完成就连续调用，会互相覆盖 `_pending`，并让 `_lastPrep` 被后一帧顶掉 ——
    // 结果就是"关键点来自第 N 帧、背景画面来自第 N+k 帧"，看起来像"算法不准，整片偏移"。
    if (this._pending) return;
    // ⚠️ 这里以前直接拿 f.data（原厂帧）去检测 —— 如果是 YUV 就是 0 个关键点。
    // 现在统一走 prepareFrame：先判格式、YUV/灰度转 RGBA、再按需缩放。
    const prep = this.prepareFrame(f);
    if (!this._frameH) this._frameH = prep.height;      // 记住帧高：quality 要用
    const frameBuffer = prep.data;
    const w = prep.width, h = prep.height;
    this._lastPrep = prep;
    if (!this.data.formatNote) {
      const bytes0 = f.data.byteLength || f.data.length || 0;
      const fmt0 = yuv.sniff(bytes0, f.width, f.height);
      const per = Math.round(bytes0 / (f.width * f.height) * 100) / 100;
      this.setData({
        formatNote: '像素格式：' + fmt0 + '（' + f.width + '×' + f.height + '，' + per + ' 字节/像素）'
          + (fmt0 === 'rgba' ? ' ✅ 与检测接口匹配'
             : fmt0 === 'yuv420' ? ' → 已自动转 RGBA（布局 ' + (this.data.yuvLayout || 'nv12') + '）'
             : fmt0 === 'gray' ? ' → 已按灰度转 RGBA'
             : ' ⚠️ 未知格式，可能检测不到')
      });
    }
    const anchors = new Promise(resolve => {
      this._pending = resolve;
      setTimeout(() => { if (this._pending === resolve) { this._pending = null; resolve(null); } }, 400);
    });
    // 自适应阈值：固定 0.8 太严 —— 主体远一点、光暗一点的视频就直接 0 点。
    // 先 0.5；连续 12 帧一个点都没有就降到 0.3（检出后的姿态质量还有一道 pose.frameMetrics 把关）。
    if (this._th === undefined) this._th = 0.5;
    if (this._miss >= 12 && this._th > 0.3) { this._th = 0.3; this._miss = 0; }
    try {
      this._session.detectBody({ frameBuffer: frameBuffer, width: w, height: h, scoreThreshold: this._th, sourceType: 0 });
    } catch (e) {
      this._pending = null;
      return;
    }
    anchors.then(list => {
      const arr = Array.isArray(list) ? list : [];
      const body = arr.filter(a => a && a.type === 5 && a.points && a.points.length)[0];
      if (body) { this._detCount = (this._detCount || 0) + 1; this._miss = 0; }
      if (!body) { this._miss = (this._miss || 0) + 1; return; }
      if (!this._firstPts) {
        this._firstPts = body.points;
        this.captureFrame(prep);                    // ← 必须是"这一帧"的画面，否则点和背景错位
        // 首帧检验映射：明显不对就自动退回内置标准映射（否则后续指标全是 0/垃圾）
        this.checkMap(body.points);
      }
      if (this.data.calibrating) return;                       // 校准中只取首帧
      // 没手工校准过 → 直接用内置默认映射（COCO 顺序），所以"不校准也能出指标"
      const map = this.getMap();
      // ⚠️ 必须传画面宽高比：否则横屏会把膝角算大、竖屏算小（16:9 时偏 +17°，9:16 时偏 -14°）
      const asp = (prep && prep.width && prep.height) ? (prep.width / prep.height) : (this._aspect || 1);
      if (!this._aspect) this._aspect = asp;
      const m = pose.frameMetrics(body.points, map, 'right', this._minConf || 0.5, asp);
      // 一个指标都算不出来：只记原因（缺映射 / 置信度不够），不推入序列
      if (!m.have || !m.have.length) {
        if (m.noMap) { this._noMapN = (this._noMapN || 0) + 1; this._noMapKeys = m.miss || []; }
        else { this._lowConf = (this._lowConf || 0) + 1; this._confSum = (this._confSum || 0) + (m.avgConf || 0); this._confN = (this._confN || 0) + 1; }
        return;
      }
      this._confOkSum = (this._confOkSum || 0) + (m.avgConf || 0); this._confOkN = (this._confOkN || 0) + 1;
      // 人体像素高度（决定指标噪声，见 utils/pose.js 的 quality）
      if (m.bodyH != null && prep && prep.height) {
        if (!this._bodyPx) this._bodyPx = [];
        this._bodyPx.push(m.bodyH * prep.height);
      }
      // 每一帧都存关键点（回放时按帧号叠加骨架；只存归一化坐标，很轻）
      if (!this._track) this._track = [];
      if (this._track.length < 900) {
        this._track.push({ n: n, pts: body.points.map(q => q ? { x: q.x, y: q.y } : null) });
      }
      // **能算的就算，算不出的留 null** —— 不再因为某个关节不可信把整帧丢掉
      const S = this._series;
      S.t.push(n);
      S.legGap.push(m.legGap == null ? null : m.legGap);
      S.kneeL.push(m.kneeL == null ? null : m.kneeL);
      S.kneeR.push(m.kneeR == null ? null : m.kneeR);
      S.trunkTilt.push(m.trunkTilt == null ? null : m.trunkTilt);
      S.cogOffset.push(m.cogOffset == null ? null : m.cogOffset);
      S.oneFoot.push(m.legGap == null ? null : (m.oneFoot ? 1 : 0));
      S.bodyH.push(m.bodyH == null ? null : m.bodyH);
      S.hipH.push(m.hipH == null ? null : m.hipH);
      S.shAng.push(m.shAng == null ? null : m.shAng);
      S.hipAng.push(m.hipAng == null ? null : m.hipAng);
      S.hipX.push(m.hipX == null ? null : m.hipX);
      S.axisTilt.push(m.axisTilt == null ? null : m.axisTilt);
    }).catch(() => {});
  },

  stop() {
    this.setData({ analyzing: false });
    this.cleanup();
  },
  cleanup() {
    try { if (this._dec) { this._dec.stop(); this._dec.remove(); } } catch (e) {}
    try { if (this._session) { this._session.destroy(); } } catch (e) {}
    this._dec = null; this._session = null;
  },

  // ---------- 出结果 ----------
  finish() {
    this.setData({ analyzing: false, progress: 100, detected: this._detCount || 0, decoded: this._frames || this.data.decoded });
    this.cleanup();
    const S = this._series || { legGap: [] };
    const cnt = k => (S[k] || []).filter(v => typeof v === 'number' && isFinite(v)).length;
    const perMetric = { legGap: cnt('legGap'), kneeL: cnt('kneeL'), kneeR: cnt('kneeR'), trunkTilt: cnt('trunkTilt'), cogOffset: cnt('cogOffset') };
    const bestN = Math.max.apply(null, Object.keys(perMetric).map(k => perMetric[k]));
    const decodedN = this._frames || this.data.decoded || 0;
    const detN = this._detCount || 0;
    const rate = decodedN ? Math.round(detN / decodedN * 100) : 0;
    if (this._skipBusy) {
      this.setData({ diag: (this.data.diag || []).concat(['为对齐画面与关键点，跳过了 ' + this._skipBusy + ' 帧（检测是串行的）']) });
    }
    // 检出率诊断：解释"为什么这个视频不行"，而不是只丢一句"帧太少"
    const why = [];
    // 先说最可能的真原因：没校准 / 置信度不够
    if (this._noMapN) {
      const miss = (this._noMapKeys || []).slice(0, 5).map(k => (POSE_JOINTS.filter(j => j.k === k)[0] || {}).n || k);
      why.push('『还没校准』：' + this._noMapN + ' 帧因为没有关节映射被跳过（缺 ' + miss.join('、') + '…）。');
      why.push('先点「校准关键点」把关节一一点出来，完成后会自动重新分析。');
    }
    if (this._lowConf) {
      const avg = this._confN ? (this._confSum / this._confN) : 0;
      why.push('『置信度不够』：' + this._lowConf + ' 帧被挡（这些帧平均置信度 ' + avg.toFixed(2) + '，门槛 ' + (this._minConf || 0.5) + '）。');
      why.push('主体在画面里太小时置信度就是低 —— 可以点「重跑」降门槛到 0.3，但结果要打折看。');
    }
    if (detN === 0) {
      why.push(this.data.formatNote || '');
      why.push('这个视频一帧都没检出。常见原因：① 人在画面里太小（建议占画面高度 ≥ 1/3）；');
      why.push('② 手机竖拍但视频是横的（人侧躺着）；③ 逆光/过曝/剪影；④ 只拍到局部（只有腿或只有上半身）。');
    } else if (rate < 25) {
      why.push('检出率偏低（' + detN + '/' + decodedN + ' 帧 = ' + rate + '%），指标可能不稳。');
      why.push('建议：让主体在画面里更大、正侧面、光线均匀，再试一次。');
    }
    if (bestN < 5) {
      const canRetry = !this._noMapN && this._lowConf > 0 && (this._minConf || 0.5) > 0.3;
      wx.showModal({
        title: detN ? '有效帧太少' : '这个视频没检出人体',
        content: (detN ? ('检出 ' + detN + ' 帧，但每个指标可用的帧都太少（浮足 ' + perMetric.legGap + '、左膝 ' + perMetric.kneeL + '、右膝 ' + perMetric.kneeR + '、前倾 ' + perMetric.trunkTilt + '）。\n') : '')
          + why.filter(Boolean).join('\n'),
        showCancel: canRetry,
        confirmText: canRetry ? '重跑' : '知道了',
        cancelText: '取消',
        success: r => {
          if (canRetry && r.confirm) { this._minConf = 0.3; this.analyze(); }
        }
      });
      return;
    }
    // 检出率不高时也提醒一句，但不挡住结果
    if (rate < 25) {
      this.setData({ diag: (this.data.diag || []).concat(['⚠️ 检出率 ' + rate + '%（' + detN + '/' + decodedN + '）—— 指标可信度会打折']) });
    }
    this.computeResults();
  },

  computeResults() {
    const clean = s => pose.medianFilter(pose.rejectOutliers(s, 3.5), 5);
    const S = this._series;
    const legGap = clean(S.legGap), kneeL = clean(S.kneeL), kneeR = clean(S.kneeR);
    const trunk = clean(S.trunkTilt), cog = clean(S.cogOffset);

    const oneFootGaps = S.legGap.map((v, i) => S.oneFoot[i] ? v : null).filter(v => v != null);
    const holdMax = (() => {                                  // 最长连续单足段（帧数 × 帧间隔）
      let best = 0, cur = 0, bestStart = -1, curStart = -1;
      S.oneFoot.forEach((v, i) => {
        if (v) { if (!cur) curStart = i; cur++; if (cur > best) { best = cur; bestStart = curStart; } }
        else cur = 0;
      });
      const fps = (this._fps || 30) / this.data.step;      // 实际采样频率 = 视频帧率 ÷ 采样步长
      return { frames: best, sec: fps > 0 ? (best / fps) : 0, startIdx: bestStart, fps: this._fps || 30 };
    })();

    const st = pose.summarize(legGap), k1 = pose.summarize(kneeL), k2 = pose.summarize(kneeR);
    const tr = pose.summarize(trunk), cg = pose.summarize(cog.map(v => Math.abs(v)));
    const hCm = Number(this.data.heightCm) || 0;
    const pct = (v, isCm) => (v == null ? '—' : (isCm && hCm ? (Math.round(v * hCm * 10) / 10) + ' cm' : (Math.round(v * 1000) / 10) + '%'));

    // 检查项（按“动作目标”给结论；燕式/步法各自的判据不同，这里给客观值与参考阈值）
    const jFree = pose.judge('freeLeg', st ? st.median : null);
    const jFlat = pose.judge('trunkFlat', tr ? (90 - tr.median) : null);   // 与竖直角的补角=与水平角
    const jFront = pose.judge('cogFront', cg ? cg.median : null);
    const jKnee = pose.judge('kneeHold', k1 ? k1.median : null);

    const checks = [
      { k: 'freeLeg', name: '浮足高度（两踝垂直差）', value: st ? pct(st.median, true) : '—', sub: '最大 ' + (st ? pct(st.max, true) : '—'), state: jFree.state, text: jFree.text, hint: pose.POSE_TARGETS.freeLeg.hint },
      { k: 'trunkFlat', name: '上身压低（燕式：与水平夹角）', value: tr ? (Math.round((90 - tr.median) * 10) / 10) + '°' : '—', sub: '最小 ' + (tr ? Math.round((90 - tr.max) * 10) / 10 + '°' : '—'), state: jFlat.state, text: jFlat.text, hint: pose.POSE_TARGETS.trunkFlat.hint },
      { k: 'cogFront', name: '重心前偏（髋 vs 支撑踝）', value: cg ? pct(cg.median, true) : '—', sub: '最大 ' + (cg ? pct(cg.max, true) : '—'), state: jFront.state, text: jFront.text, hint: pose.POSE_TARGETS.cogFront.hint },
      { k: 'kneeHold', name: '支撑膝角（左）', value: k1 ? Math.round(k1.median) + '°' : '—', sub: '最小 ' + (k1 ? Math.round(k1.min) + '°' : '—'), state: jKnee.state, text: jKnee.text, hint: pose.POSE_TARGETS.kneeHold.hint }
    ];
    const nn = a => (a || []).filter(v => typeof v === 'number' && isFinite(v)).length;
    const stats = [
      { name: '各指标可用帧', value: '浮足 ' + nn(legGap) + ' · 左膝 ' + nn(kneeL) + ' · 右膝 ' + nn(kneeR) + ' · 前倾 ' + nn(trunk) + ' · 重心 ' + nn(cog) },
      { name: '关键点质量', value: (S.t.length ? Math.round((this._confOkN || 0) / S.t.length * 100) : 0) + '% 帧可用'
          + (this._confOkN ? '（平均置信度 ' + ((this._confOkSum || 0) / this._confOkN).toFixed(2) + '）' : '')
          + (this._lowConf ? ' · 低置信丢弃 ' + this._lowConf + ' 帧' : '') },
      { name: '视频帧率 / 采样', value: (this._fps || '?') + ' fps · 每 ' + this.data.step + ' 帧取 1' },
      { name: '单足最长保持', value: holdMax.frames ? (Math.round(holdMax.sec * 10) / 10) + ' s' : '—' },
      { name: '右膝角中位', value: k2 ? Math.round(k2.median) + '°' : '—' },
      { name: '单足帧占比', value: Math.round(S.oneFoot.filter(v => v).length / S.oneFoot.length * 100) + '%' }
    ];

    // ---------- 通用指标（跟动作无关）----------
    const nn0 = a => (a || []).filter(v => typeof v === 'number' && isFinite(v));
    const sHipH = pose.summarize(S.hipH), sHipX = pose.summarize(S.hipX), sAxis = pose.summarize(S.axisTilt);
    const p2pHipX = pose.peakToPeak(S.hipX);
    // 左右扭转：肩线与髋线的夹角（转体/旋转时这个值会明显变化）
    const twist = S.shAng.map((v, i) => (v == null || S.hipAng[i] == null) ? null : Math.abs(((v - S.hipAng[i]) + 540) % 360 - 180));
    const sTwist = pose.summarize(twist);
    // 节奏：髋横向的主导周期（压步/换脚的节拍）
    const per = pose.dominantPeriod(S.hipX, 4, 60);
    const fpsEff = (this._fps || 30) / (this.data.step || 1);
    const rhythmHz = per ? (fpsEff / per.lag) : null;
    const sRot = pose.peakToPeak(S.shAng);                  // 肩线角度的范围（转体幅度）
    const general = [
      { k: 'hipH', name: '重心高度（髋 vs 支撑踝）', value: sHipH ? (Math.round(sHipH.median * 100) + '% 身高') : '—',
        sub: sHipH ? ('范围 ' + Math.round(sHipH.min * 100) + '–' + Math.round(sHipH.max * 100) + '%')
                   : '髋/踝不可见', hint: '越低=蹲得越深；起速时应当明显升高' },
      { k: 'axis', name: '身体轴线倾角（头—髋 vs 竖直）', value: sAxis ? (Math.round(sAxis.median * 10) / 10 + '°') : '—',
        sub: sAxis ? ('最大 ' + Math.round(sAxis.max * 10) / 10 + '°') : '', hint: '轴心是否"压得住"：竖直时接近 0°' },
      { k: 'sway', name: '横向摆动幅度（髋左右）', value: p2pHipX != null ? (Math.round(p2pHipX / Math.max(0.01, sHipH ? 1 : 1) * 1000) / 10 + '% 画面') : '—',
        sub: '峰峰值', hint: '压步/步法的横向覆盖；太小=没滑开，太大=重心晃' },
      { k: 'twist', name: '肩髋扭转（肩线 vs 髋线）', value: sTwist ? (Math.round(sTwist.median * 10) / 10 + '°') : '—',
        sub: sTwist ? ('最大 ' + Math.round(sTwist.max * 10) / 10 + '°') : '', hint: '转体/旋转/跳跃的关键：上身与下身的分离度' },
      { k: 'rot', name: '肩线转动范围', value: (!showNum) ? '—' : (sRot != null ? (Math.round(sRot) + '°') : '—'),
        sub: '仅参考（依赖肩点精度）', hint: '转体量：180°≈半圈，360°≈一圈' }
    ];

    // ---------- 拍摄质量（决定这些数到底能不能信） ----------
    const pxList = (this._bodyPx || []).slice().sort((a, b) => a - b);
    const bodyPx = pxList.length ? pxList[Math.floor(pxList.length / 2)] : 0;
    const q = pose.quality(bodyPx, this._frameH || 540);
    const showNum = q.usable;                       // 不达标就不给数字

    // ---------- 三个大数字（照参考产品的形态：一眼能读） ----------
    const sKnee = pose.summarize([].concat(kneeL, kneeR).filter(v => v != null));
    const oneN = (S.oneFoot || []).filter(v => v === 1).length;
    const oneTotal = (S.oneFoot || []).filter(v => v != null).length || 1;
    const onePct = Math.round(oneN / oneTotal * 100);
    const hipHv = sHipH ? Math.round(sHipH.median * 100) : null;
    const kneeV = sKnee ? Math.round(sKnee.median) : null;
    const big = [
      { k: 'hip', v: (!showNum || hipHv == null) ? '—' : String(hipHv), unit: '% 身高', name: '重心高度（中位）',
        sub: (!showNum) ? '拍摄不达标' : (sHipH ? ('±' + q.err.hip + '% · 范围 ' + Math.round(sHipH.min * 100) + '–' + Math.round(sHipH.max * 100) + '%') : '') },
      { k: 'knee', v: (!showNum || kneeV == null) ? '—' : String(kneeV), unit: '°', name: '膝角（中位）',
        sub: (!showNum) ? '拍摄不达标' : (sKnee ? ('±' + q.err.knee + '° · 最小 ' + Math.round(sKnee.min) + '°') : '') },
      { k: 'hold', v: (!showNum || !holdMax.frames) ? '—' : String(Math.round(holdMax.sec * 10) / 10), unit: '秒', name: '最长单足',
        sub: (!showNum) ? '拍摄不达标' : ('单足占比 ' + onePct + '%（±' + q.err.leg + '%）') }
    ];

    // ---------- 一句人话结论 ----------
    const say = [];
    if (hipHv != null) say.push('重心平均在 ' + hipHv + '% 身高');
    if (kneeV != null) say.push('膝角中位 ' + kneeV + '°' + (kneeV < 120 ? '（蹲得偏深）' : kneeV > 160 ? '（腿偏直）' : '（适中）'));
    say.push('单足滑行占 ' + onePct + '%' + (holdMax.frames ? '，最长连续 ' + (Math.round(holdMax.sec * 10) / 10) + ' 秒' : ''));
    if (rhythmHz) say.push('动作节律约 ' + (Math.round(rhythmHz * 10) / 10) + ' Hz');
    const summaryText = showNum
      ? ('这段视频里：' + say.join('，') + '。')
      : ('这段视频**不适合做量化分析**：' + q.note + '。骨架回放可以看姿态，但上面的数值不会给出来 —— '
         + '把主体拍大一点（占画面高度 1/3 以上、横向、正侧面、光线均匀）再分析。').replace(/\*\*/g, '');

    // ---------- 训练建议（规则生成，且明确"不是医疗/教练诊断"）----------
    const advice = [];
    if (kneeV != null && kneeV < 120) {
      advice.push({ t: '膝角偏深：先练"浅蹲控制"', s: ['扶墙做 1/4 蹲，保持 10 秒×5 组', '压步时刻意"蹲少一点、起来更快"', '录像对比：膝角目标 130–150°'] });
    } else if (kneeV != null && kneeV > 165) {
      advice.push({ t: '腿偏直：加"屈膝缓冲"', s: ['落地/滑行时膝盖保持微屈（别锁死）', '做压步节奏练习：1-2 蹲 3 起', '注意上身前趴不要代偿'] });
    }
    if (onePct < 25) {
      advice.push({ t: '单足时间偏少：加单足滑行', s: ['单足直线滑行 5 米×6 组（左右各）', '单足蛇形：一手上举、尾椎下沉', '目标：连续单足 ≥3 秒'] });
    }
    if (!rhythmHz) {
      advice.push({ t: '没检出节律：练"节拍"', s: ['压步跟着口令：4 拍一动（1-2 蹲住，3 站起，4 下蹲）', '熟了改 2 拍、1 拍', '用音乐或节拍器辅助'] });
    }
    if (sRot != null && sRot < 90) {
      advice.push({ t: '转体量偏小：加转体', s: ['转 3 单独练：前十次只求"不碰刀齿"', '连续转 3 × 全场一躺', '转体时"手—胯—脚"依次带动'] });
    }
    if (!showNum && !advice.length) {
      advice.push({ t: '先把拍摄改对，再谈数据', s: [
        '横屏拍，人占画面高度 1/3 以上（离机位近一点）',
        '正侧面机位，腰高，60fps',
        '避开逆光（冰场玻璃最容易过曝）',
        '一段视频只拍一个动作，动作保持 3–5 秒'
      ] });
    } else if (!advice.length) {
      advice.push({ t: '这段视频的各项都在合理范围', s: ['保持当前节奏', '连续拍 3 次同一动作，比较"重心高度范围"和"最长单足"是否稳定'] });
    }

    // ---------- 最值得看的瞬间（单次分析里最有用的东西）----------
    // 人看 20 秒视频会漏掉关键帧，机器不会。挑 3 个"最有信息量"的时刻并说明为什么。
    const fpsE = (this._fps || 30) / (this.data.step || 1);
    const t2s = n => Math.round((n / Math.max(1, fpsE)) * 10) / 10;
    const cands = [];
    const push = (arr, pick) => {
      const idx = pick(arr);
      if (idx == null) return;
      cands.push(idx);
    };
    // 膝角最深（蹲最狠）/最直（腿没屈）
    const kneeMinPer = S.kneeL.map((v, i) => {
      const a = (v == null ? Infinity : v), b = (S.kneeR[i] == null ? Infinity : S.kneeR[i]);
      return Math.min(a, b);
    });
    const kneeMaxPer = S.kneeL.map((v, i) => {
      const a = (v == null ? -Infinity : v), b = (S.kneeR[i] == null ? -Infinity : S.kneeR[i]);
      return Math.max(a, b);
    });
    const argExtreme = (arr, sign) => {
      let bestIdx = null;
      let bestVal = sign > 0 ? -Infinity : Infinity;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (sign > 0 ? v > bestVal : v < bestVal) { bestVal = v; bestIdx = i; }
      }
      return bestIdx;
    };
    const argMin = arr => argExtreme(arr, -1);
    const argMax = arr => argExtreme(arr, 1);
    const addCand = (i, kind, label, value, why, weight) => {
      if (i == null) return;
      cands.push({ i: i, n: S.t[i], kind: kind, label: label, value: value, why: why, w: weight });
    };
    addCand(argMin(kneeMinPer), 'kneeMin', '膝盖屈得最深', Math.round(kneeMinPer[argMin(kneeMinPer)]) + '°',
      '这里支撑腿蹲得最深；如果比你的目标还深，说明在"塌"，起速会慢', 10);
    addCand(argMax(kneeMaxPer), 'kneeMax', '膝盖最直', Math.round(kneeMaxPer[argMax(kneeMaxPer)]) + '°',
      '这里腿最"锁死"；落地/滑行时膝盖太直会吃冲击', 9);
    addCand(argMin(S.hipH), 'hipLow', '重心最低', Math.round(S.hipH[argMin(S.hipH)] * 100) + '% 身高',
      '整段里蹲得最低的一刻，看这一刻上身有没有跟着塌', 9);
    addCand(argMax(S.hipH), 'hipHigh', '重心最高', Math.round(S.hipH[argMax(S.hipH)] * 100) + '% 身高',
      '起速/站起最充分的一刻，和最低点对比能看出起伏幅度', 7);
    addCand(argMax(S.trunkTilt), 'trunk', '上身前倾最大', Math.round(S.trunkTilt[argMax(S.trunkTilt)] * 10) / 10 + '°',
      '上身趴得最厉害的一刻；超过 25° 就要看看是不是在靠上身代偿', 8);
    // 单足断掉：连续单足 ≥3 帧之后第一次变双足
    let run0 = 0, broke = null;
    S.oneFoot.forEach((v, i) => {
      if (v === 1) run0++;
      else { if (run0 >= 3 && broke == null) broke = i; run0 = 0; }
    });
    addCand(broke, 'oneFootBreak', '单足断掉', '第 ' + (broke == null ? 0 : Math.round(t2s(S.t[broke]) * 10) / 10) + 's',
      '前面单足支撑了 ' + Math.round(run0) + ' 帧后落回双足 —— 这里看是不是"撑不住"或"主动收"', 12);

    // 去重：时间上太近（<1s）的只留一个，按权重取前 3
    cands.sort((a, b) => b.w - a.w);
    const picked = [];
    cands.forEach(c => {
      if (picked.length >= 3) return;
      if (picked.some(p => Math.abs(p.n - c.n) < fpsE * 1.0)) return;
      picked.push(c);
    });
    picked.sort((a, b) => a.n - b.n);
    const highlights = picked.map(c => ({
      n: c.n, t: t2s(c.n) + 's', label: c.label, value: c.value, why: c.why
    }));

    this._clean = { t: S.t, legGap: legGap, kneeL: kneeL, kneeR: kneeR, trunk: trunk, cog: cog };
    this.setData({ checks: checks, stats: stats, general: general, big: big, summaryText: summaryText, advice: advice, quality: q, highlights: highlights,
      chartKey: 'legGap', chartTitle: '浮足高度差（按身高归一 · 已平滑）' });
    this.drawChart();
    this.setData({ trackN: (this._track || []).length });
  },

  // ---------- 视频 + 骨架回放：在原视频画面上叠加关键点 ----------
  // 为什么不用 <video> 再盖一层 canvas：视频是原生组件，层级压不住 canvas（会盖掉骨架）。
  // 所以自己解码逐帧画到 canvas 上，骨架和画面同源，绝不会错位。
  togglePlay() {
    if (this._playing) { this.stopPlay(); return; }
    if (!this.data.videoPath) { wx.showToast({ title: '先选一个视频', icon: 'none' }); return; }
    if (!(this._track || []).length) { wx.showToast({ title: '先分析一次（要有关键点才能叠加）', icon: 'none' }); return; }
    this.startPlay();
  },

  toggleIdx() { this.setData({ showIdx: !this.data.showIdx }); },

  // 点"最值得看的瞬间"→ 解码到那一帧并画出画面+骨架（不连续播放，直接停住）
  seekTo(e) {
    const n = Number(e.currentTarget.dataset.n);
    if (!isFinite(n) || n < 0) return;
    if (!this.data.videoPath) return;
    this.stopPlay();
    this._needMeasure = true;      // 重新测画布（实测 rect，防旋转/布局变化后沿用旧宽高）
    this.setData({ seekBusy: true });
    let dec = null;
    try { dec = wx.createVideoDecoder(); } catch (err) { this.setData({ seekBusy: false }); return; }
    let ended = false;
    try { dec.on('ended', () => { ended = true; }); } catch (err) {}
    try { dec.start({ source: this.data.videoPath, mode: 1, abortAudio: true }); }
    catch (err) { this.setData({ seekBusy: false }); return; }
    let i = -1;
    const tick = () => {
      if (!this.data.seekBusy) { try { dec.stop(); dec.remove(); } catch (err) {} return; }
      let f = null;
      try { f = dec.getFrameData(); } catch (err) {}
      if (!f || !f.data) {
        if (ended) { this.setData({ seekBusy: false }); try { dec.stop(); dec.remove(); } catch (err) {} return; }
        setTimeout(tick, 20); return;
      }
      i++;
      if (i >= n) {
        this.drawPlayFrame(f, i, this._track || []);
        this.setData({ seekBusy: false, playTime: (i / Math.max(1, this._fps || 30)).toFixed(1) + 's' });
        try { dec.stop(); dec.remove(); } catch (err) {}
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  },

  toggleAdv() { this.setData({ advOpen: !this.data.advOpen }); },

  // 恢复自动映射：清掉手工校准的结果
  resetCalib() {
    wx.showModal({
      title: '恢复自动映射',
      content: '清掉手工记录的关节对应关系，改用内置标准映射（COCO 顺序）。之后不用再点关节。',
      confirmText: '恢复',
      success: r => {
        if (!r.confirm) return;
        try { store.save(store.KEYS.poseMap, null); } catch (e) {}
        this._map = null;
        this.setData({ calibrated: false });
        wx.showToast({ title: '已恢复自动映射', icon: 'none' });
      }
    });
  },

  stopPlay() {
    this._playing = false;
    this.setData({ playing: false });
    try { if (this._pdec) { this._pdec.stop(); this._pdec.remove(); } } catch (e) {}
    this._pdec = null;
  },

  startPlay() {
    let dec = null;
    try { dec = wx.createVideoDecoder(); } catch (e) {
      wx.showToast({ title: '解码器不可用', icon: 'none' }); return;
    }
    this._pdec = dec;
    let ended = false;
    try { dec.on('ended', () => { ended = true; }); } catch (e) {}
    try { dec.start({ source: this.data.videoPath, mode: 1, abortAudio: true }); } catch (e) {
      wx.showToast({ title: '启动解码失败', icon: 'none' }); return;
    }
    this._playing = true;
    this._needMeasure = true;      // 重新测画布（实测 rect，不依赖 CSS 比例）
    this.setData({ playing: true, playPct: 0, playTime: '0.0s' });
    const track = this._track || [];
    const total = Math.max(1, (this._fps || 30) * (this._durSec || 20));
    let n = -1;
    const tick = () => {
      if (!this._playing) return;
      let f = null;
      try { f = dec.getFrameData(); } catch (e) {}
      if (!f || !f.data) {
        if (ended) { this.stopPlay(); this.setData({ playPct: 100 }); return; }
        setTimeout(tick, 25); return;
      }
      n++;
      this.drawPlayFrame(f, n, track);
      const sec = n / Math.max(1, this._fps || 30);
      if (n % 6 === 0) {
        // 画面上的实时数字（照参考产品：时间/帧号/关键点真实坐标）
        let hud = { t: sec.toFixed(2) + 's', n: String(n) };
        const hCm = Number(this.data.heightCm) || 0;
        let near = null, best = 1e9;
        (track || []).forEach(it => { const d = Math.abs(it.n - n); if (d < best) { best = d; near = it; } });
        if (near && best <= 8) {
          const map = this.getMap();
          const at = k => { const i = map[k]; return (i != null && near.pts && near.pts[i]) ? near.pts[i] : null; };
          const head = at('head'), ankL = at('ankL'), ankR = at('ankR');
          const hipL = at('hipL'), hipR = at('hipR');
          if (head && ankL && ankR && hipL && hipR) {
            const bodyH = Math.abs(head.y - Math.max(ankL.y, ankR.y));
            const lowAnk = Math.max(ankL.y, ankR.y);
            const hipY = (hipL.y + hipR.y) / 2;
            const hipH = bodyH > 0.01 ? (lowAnk - hipY) / bodyH : 0;
            if (bodyH > 0.05) {
              hud.hip = hCm ? (Math.round(hipH * hCm) + ' cm') : (Math.round(hipH * 100) + '%');
              hud.leg = Math.round(Math.abs(ankL.y - ankR.y) / bodyH * 100) + '%';
            } else {
              hud.hip = '—'; hud.leg = '—';
            }
            const oneFoot = Math.abs(ankL.y - ankR.y) / Math.max(0.01, bodyH) > 0.08;
            hud.foot = oneFoot ? '单足' : '双足';
          }
        }
        this.setData({ playPct: Math.min(100, Math.round(sec / (total / (this._fps || 30)) * 100)), playTime: sec.toFixed(1) + 's', hud: hud });
      }
      setTimeout(tick, 0);
    };
    tick();
  },

  drawPlayFrame(f, n, track) {
    const prep = this.prepareFrame(f);
    const fw = prep.width, fh = prep.height;
    const draw = (canvas, cw, ch) => {
      if (!canvas || !cw || !ch) return;
      let dpr = 2;
      try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) {}
      const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, cw, ch);
      // **唯一的一套坐标**：画面和骨架都用这个 box（letterbox，按实际画布尺寸算）
      const box = this.fitRect(cw, ch, fw, fh);
      try {
        const c = this._w1;
        if (c) {
          if (c.width !== fw || c.height !== fh) { c.width = fw; c.height = fh; }
          const x1 = c.getContext('2d');
          const img = x1.createImageData(fw, fh);
          img.data.set(new Uint8ClampedArray(prep.data, 0, fw * fh * 4));
          x1.putImageData(img, 0, 0);
          ctx.drawImage(c, 0, 0, fw, fh, box.x, box.y, box.w, box.h);
        }
      } catch (e) {}
      let near = null, best = 1e9;
      (track || []).forEach(it => { const d = Math.abs(it.n - n); if (d < best) { best = d; near = it; } });
      if (!near || best > 8) return;
      const map = this.getMap();
      const P = {};
      (near.pts || []).forEach((p, i) => { if (p) P[i] = { x: box.x + p.x * box.w, y: box.y + p.y * box.h }; });
      const SEG = [['head', 'neck'], ['neck', 'hipL'], ['neck', 'hipR'], ['hipL', 'hipR'],
                   ['hipL', 'kneeL'], ['kneeL', 'ankL'], ['hipR', 'kneeR'], ['kneeR', 'ankR'],
                   ['neck', 'shL'], ['neck', 'shR'], ['shL', 'hipL'], ['shR', 'hipR']];
      ctx.strokeStyle = 'rgba(56,189,248,.95)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      SEG.forEach(pair => {
        const ia = map[pair[0]], ib = map[pair[1]];
        if (ia == null || ib == null) return;
        const A = P[ia], B = P[ib];
        if (!A || !B) return;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      });
      ctx.fillStyle = 'rgba(250,204,21,.95)';
      Object.keys(P).forEach(k => { const p = P[k]; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill(); });
      if (this.data.showIdx) {
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '10px sans-serif';
        Object.keys(P).forEach(k => { const p = P[k]; ctx.fillText(k, p.x + 3, p.y - 3); });
      }
    };
    // 画布尺寸：每次都实测（旋转/布局变化都能跟上），缓存只用于"同一轮连续播放"
    if (this._playerCv && this._cw && !this._needMeasure) { draw(this._playerCv, this._cw, this._ch); return; }
    wx.createSelectorQuery().in(this).select('#player').boundingClientRect(rect => {
      if (!rect || !rect.width || !rect.height) return;
      wx.createSelectorQuery().in(this).select('#player').fields({ node: true }).exec(r => {
        const q = r && r[0];
        if (!q || !q.node) return;
        this._playerCv = q.node; this._cw = rect.width; this._ch = rect.height; this._needMeasure = false;
        draw(q.node, rect.width, rect.height);
      });
    }).exec();
  },

  switchChart(e) {
    const k = e.currentTarget.dataset.k;
    const map = { legGap: '浮足高度差（按身高归一 · 已平滑）', kneeL: '左膝角（度 · 已平滑）', trunk: '上身前倾（度 · 已平滑）', cog: '重心前后偏移（按身高归一）' };
    this.setData({ chartKey: k, chartTitle: map[k] || '' });
    this._chartKey = k;
    this.drawChart();
  },

  drawChart() {
    const key = this._chartKey || 'legGap';
    const C = this._clean;
    if (!C) return;
    wx.createSelectorQuery().in(this).select('#chart').fields({ node: true, size: true }).exec(res => {
      const r = res && res[0];
      if (!r || !r.node) return;
      const canvas = r.node;
      let dpr = 2;
      try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) {}
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const W = r.width, H = r.height;
      ctx.clearRect(0, 0, W, H);
      const series = C[key] || [];
      const vals = series.filter(v => typeof v === 'number' && isFinite(v));
      if (vals.length < 2) { ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif'; ctx.fillText('数据不足', 10, 20); return; }
      const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      const pad = 22, plotW = W - pad * 2, plotH = H - pad * 2;
      const X = i => pad + (series.length < 2 ? 0 : (i / (series.length - 1)) * plotW);
      const Y = v => pad + plotH - ((v - mn) / (mx - mn || 1)) * plotH;
      // 网格
      ctx.strokeStyle = 'rgba(148,163,184,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, pad + plotH); ctx.lineTo(pad + plotW, pad + plotH); ctx.stroke();
      // 曲线
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath();
      let started = false;
      series.forEach((v, i) => {
        if (typeof v !== 'number' || !isFinite(v)) { started = false; return; }
        if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
      });
      ctx.stroke();
      // 中位线
      const med = pose.median(vals);
      ctx.strokeStyle = 'rgba(250,204,21,.85)'; ctx.setLineDash([5, 4]); ctx.beginPath();
      ctx.moveTo(pad, Y(med)); ctx.lineTo(pad + plotW, Y(med)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif';
      ctx.fillText('max ' + (Math.round(mx * 1000) / 1000), pad + 4, pad - 8);
      ctx.fillText('min ' + (Math.round(mn * 1000) / 1000), pad + 4, pad + plotH + 14);
      this._canvas = canvas;
    });
  },

  // ---------- 校准（在首帧点上依次点选） ----------
  startCalib() {
    if (!this._firstPts) { wx.showToast({ title: '先分析一次，取得首帧关键点', icon: 'none' }); return; }
    this._newMap = {};
    this.setData({ calibrating: true, calibIdx: 0, calibText: '请点选：' + POSE_JOINTS[0].n }, () => this.drawCalib());
  },
  cancelCalib() { this.setData({ calibrating: false, calibText: '', calibIdx: 0 }); this._newMap = {}; },
  onCanvasTap(e) {
    if (!this.data.calibrating || !this._firstPts) return;
    wx.createSelectorQuery().in(this).select('#calib').boundingClientRect(rect => {
      if (!rect) return;
      // tap 的坐标在部分基础库上是"画布内坐标"，在另一些上是"页面坐标"——
      // 原来一律当成页面坐标去减 rect.left，如果是画布内坐标就会变成负数，于是"怎么点都点不中"。
      // 这里两种都兼容：先取两个候选值，谁落在画布范围内就用谁。
      const dx = e.detail && e.detail.x, dy = e.detail && e.detail.y;
      const cand = [
        { x: dx - rect.left, y: dy - rect.top },     // 页面坐标
        { x: dx, y: dy }                             // 画布内坐标
      ];
      const inCanvas = cand.filter(c => c.x >= -2 && c.y >= -2 && c.x <= rect.width + 2 && c.y <= rect.height + 2);
      const pick = inCanvas.length ? inCanvas[inCanvas.length - 1] : cand[0];
      const box = this._calibBox || { x: 0, y: 0, w: rect.width, h: rect.height };
      const view = this._view || { x0: 0, y0: 0, x1: 1, y1: 1 };
      // 屏幕坐标 → 首帧图内部归一化坐标（跟关键点同一个坐标系）
      const x = view.x0 + ((pick.x - box.x) / (box.w || 1)) * (view.x1 - view.x0);
      const y = view.y0 + ((pick.y - box.y) / (box.h || 1)) * (view.y1 - view.y0);

      // 先找 HIT_R 以内的；没有就退一步取最近的（人小的时候点很难精确定位）
      let best = -1, bd = HIT_R;
      this._firstPts.forEach((p, i) => {
        if (!p) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) {
        let bd2 = 1e9, b2 = -1;
        this._firstPts.forEach((p, i) => {
          if (!p) return;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd2) { bd2 = d; b2 = i; }
        });
        if (b2 >= 0 && bd2 < 0.45) { best = b2; bd = bd2; }
      }
      if (best < 0) { wx.showToast({ title: '没点到点，靠近再点', icon: 'none' }); return; }
      this._newMap[POSE_JOINTS[this.data.calibIdx].k] = best;
      const next = this.data.calibIdx + 1;
      if (next >= POSE_JOINTS.length) {
        store.save(store.KEYS.poseMap, this._newMap);
        this._map = this._newMap;
        this.setData({ calibrating: false, calibrated: true, calibText: '' });
        wx.showToast({ title: '校准完成，正在重新分析…', icon: 'none' });
        setTimeout(() => { this.analyze(); }, 700);
      } else {
        this.setData({ calibIdx: next, calibText: '请点选：' + POSE_JOINTS[next].n });
      }
    }).exec();
  },
  drawCalib() {
    wx.createSelectorQuery().in(this).select('#calib').fields({ node: true, size: true }).exec(res => {
      const r = res && res[0];
      if (!r || !r.node || !this._firstPts) return;
      const canvas = r.node;
      let dpr = 2;
      try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) {}
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, r.width, r.height);

      // ① 先把首帧画面画上去（等比，留黑边）—— 否则只有一堆黄点，根本看不出哪个是头
      const fw = this._frameW, fh = this._frameH;
      const view = this._view || { x0: 0, y0: 0, x1: 1, y1: 1 };
      this._calibAspect = r.width / Math.max(1, r.height);
      const box = this.fitRect(r.width, r.height, (view.x1 - view.x0) * fw, (view.y1 - view.y0) * fh);
      this._calibBox = box;
      if (this._frameCv && fw && fh) {
        // 正常：按裁剪框绘制。少数机型对"离屏画布 + 裁剪参数"支持不好会抛错/静默失败，
        // 兜底：退回整幅绘制（宁可不放大，也不要一片空白），并把原因写进 diag。
        let drew = false;
        try {
          ctx.drawImage(this._frameCv,
            view.x0 * fw, view.y0 * fh, (view.x1 - view.x0) * fw, (view.y1 - view.y0) * fh,
            box.x, box.y, box.w, box.h);
          drew = true;
        } catch (e) { drew = false; }
        if (!drew) {
          try {
            ctx.drawImage(this._frameCv, 0, 0, fw, fh, box.x, box.y, box.w, box.h);
            this.setData({ diag: (this.data.diag || []).concat(['⚠️ 本机不支持裁剪绘制，"放大"暂时用不了']) });
          } catch (e2) {}
        }
      } else {
        ctx.fillStyle = '#64748B'; ctx.font = '12px sans-serif';
        ctx.fillText('没有首帧画面（重新分析一次即可）', 12, 20);
      }

      // ② 关键点画在同一个矩形里（和点选的坐标换算一致）
      this._firstPts.forEach((p, i) => {
        if (!p) return;
        const x = box.x + ((p.x - view.x0) / (view.x1 - view.x0)) * box.w;
        const y = box.y + ((p.y - view.y0) / (view.y1 - view.y0)) * box.h;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(250,204,21,.95)'; ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(String(i), x + 7, y - 6);
      });
    });
  },
  // 人小的时候点全挤在一起、根本点不准 —— 一键放大到人物
  //
  // 上一版用"去掉两端 10%"来剔离群点，但**一个跑偏的点就能把包围盒撑到整幅**
  // （检测偶尔会在画面另一头冒一个孤立点），于是"放大"看起来毫无变化。
  // 现在改用中位数 + MAD 剔除，并按画布比例收紧、强制至少放大 2 倍。
  zoomBody() {
    if (!this._firstPts || !this._firstPts.length) { wx.showToast({ title: '先分析一次', icon: 'none' }); return; }
    if (this._view) { this._view = null; this.setData({ zoomed: false, zoomText: '' }); this.drawCalib(); return; }
    const pts = this._firstPts.filter(p => p && isFinite(p.x) && isFinite(p.y));
    if (pts.length < 6) { wx.showToast({ title: '关键点太少，无法放大', icon: 'none' }); return; }

    // 视野必须**包含所有关键点** —— 否则放大后有的点跑到画布外，就"点不到"了。
    // 代价是：如果有个别离群点，放大幅度会被它拖小；所以把放大上限定在 3 倍，两边都照顾。
    let x0 = Math.min.apply(null, pts.map(p => p.x)), x1 = Math.max.apply(null, pts.map(p => p.x));
    let y0 = Math.min.apply(null, pts.map(p => p.y)), y1 = Math.max.apply(null, pts.map(p => p.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

    // ① 按画布比例扩张（避免出现黑边，同时让画面填满）
    const aspect = this._calibAspect || 1.25;
    let w = Math.max(0.06, x1 - x0), h = Math.max(0.06, y1 - y0);
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    // ② 四周留 20% 边
    w *= 1.2; h *= 1.2;
    // ③ 放大上限 3 倍（w ≥ 0.33）：既看得出"确实放大了"，又不至于把边上的点挤出视野
    const MINW = 0.33, MINH = MINW / aspect;
    if (w > 1) { h /= w; w = 1; }
    if (w > MINW) { h *= MINW / w; w = MINW; }
    if (h > MINH) { w *= MINH / h; h = MINH; }
    if (w > 1) { w = 1; h = aspect; }
    if (h > 1) { h = 1; w = aspect; }
    // 兜底：视野不小于所有点的范围
    const spanX = Math.max.apply(null, pts.map(p => p.x)) - Math.min.apply(null, pts.map(p => p.x));
    const spanY = Math.max.apply(null, pts.map(p => p.y)) - Math.min.apply(null, pts.map(p => p.y));
    if (w < spanX) w = Math.min(1, spanX);
    if (h < spanY) h = Math.min(1, spanY);

    x0 = Math.max(0, Math.min(1 - w, cx - w / 2));
    y0 = Math.max(0, Math.min(1 - h, cy - h / 2));
    this._view = { x0: x0, y0: y0, x1: x0 + w, y1: y0 + h };
    const factor = Math.round(1 / w * 10) / 10;
    this.setData({ zoomed: true, zoomText: ' ×' + factor });
    this.drawCalib();
  },

  setHeight(e) {
    const cm = Math.max(0, Math.min(220, Number(e.detail.value) || 0));
    const meta = store.load(store.KEYS.meta) || {};
    meta.heightCm = cm;
    store.save(store.KEYS.meta, meta);
    this.setData({ heightCm: cm });
  }
});
