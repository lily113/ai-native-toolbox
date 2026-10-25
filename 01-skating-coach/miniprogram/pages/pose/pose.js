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
    cfgYuv: '',
    diag: [],                 // 诊断信息（可复制）
    downscale: true,          // 高分辨率视频先降采样再检测
    cfgName: '',              // 实际生效的 VisionKit 配置
    // 结果
    rangeStart: '',
    rangeEnd: '',
    checks: [],               // 动作检查项
    stats: [],                // 指标统计
    chartKey: 'legGap',
    chartTitle: '',
    legend: []
  },

  onLoad() {
    const map = store.load(store.KEYS.poseMap);
    const calibrated = !!(map && POSE_JOINTS.every(j => typeof map[j.k] === 'number'));
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
    this.setData({ analyzing: true, progress: 0, decoded: 0, detected: 0, checks: [], stats: [], formatNote: '', diag: ['开始分析…'] });
    this._series = { t: [], legGap: [], kneeL: [], kneeR: [], trunkTilt: [], cogOffset: [], oneFoot: [], bodyH: [] };
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
        if (n % step === 0) this.detectOne(f, n);
        if (n % 8 === 0) this.flushProgress(n);
        i++;
      }
      this.flushProgress(idx);
      setTimeout(next, 0);
    };
    next();
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
    // ⚠️ 这里以前直接拿 f.data（原厂帧）去检测 —— 如果是 YUV 就是 0 个关键点。
    // 现在统一走 prepareFrame：先判格式、YUV/灰度转 RGBA、再按需缩放。
    const prep = this.prepareFrame(f);
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
        this.captureFrame(this._lastPrep);          // 留一张首帧图，校准画布当背景
      }
      if (this.data.calibrating) return;                       // 校准中只取首帧
      const map = this._map || store.load(store.KEYS.poseMap) || {};
      const m = pose.frameMetrics(body.points, map);
      if (!m.ok) { if (m.lowConf) this._lowConf = (this._lowConf || 0) + 1; return; }
      const S = this._series;
      S.t.push(n); S.legGap.push(m.legGap); S.kneeL.push(m.kneeL); S.kneeR.push(m.kneeR);
      S.trunkTilt.push(m.trunkTilt); S.cogOffset.push(m.cogOffset); S.oneFoot.push(m.oneFoot ? 1 : 0);
      S.bodyH.push(m.bodyH);
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
    const decodedN = this._frames || this.data.decoded || 0;
    const detN = this._detCount || 0;
    const rate = decodedN ? Math.round(detN / decodedN * 100) : 0;
    // 检出率诊断：解释"为什么这个视频不行"，而不是只丢一句"帧太少"
    const why = [];
    if (detN === 0) {
      why.push(this.data.formatNote || '');
      why.push('这个视频一帧都没检出。常见原因：① 人在画面里太小（建议占画面高度 ≥ 1/3）；');
      why.push('② 手机竖拍但视频是横的（人侧躺着）；③ 逆光/过曝/剪影；④ 只拍到局部（只有腿或只有上半身）。');
    } else if (rate < 25) {
      why.push('检出率偏低（' + detN + '/' + decodedN + ' 帧 = ' + rate + '%），指标可能不稳。');
      why.push('建议：让主体在画面里更大、正侧面、光线均匀，再试一次。');
    }
    if (!S.legGap || S.legGap.length < 5) {
      wx.showModal({
        title: detN ? '有效帧太少' : '这个视频没检出人体',
        content: (detN ? ('检出 ' + detN + ' 帧，但可用于计算的只有 ' + (S.legGap ? S.legGap.length : 0) + ' 帧。'
                        + '可能是没校准关键点（先「开始分析」再「校准关键点」）。\n')
                      : '')
          + why.filter(Boolean).join('\n'),
        showCancel: false
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
    const stats = [
      { name: '有效帧', value: String(legGap.filter(v => v != null).length) + ' / ' + S.legGap.length },
      { name: '关键点质量', value: (S.legGap.length ? Math.round(legGap.filter(v => v != null).length / S.legGap.length * 100) : 0) + '%' +
          (this._lowConf ? '（低置信丢弃 ' + this._lowConf + ' 帧）' : '') },
      { name: '视频帧率 / 采样', value: (this._fps || '?') + ' fps · 每 ' + this.data.step + ' 帧取 1' },
      { name: '单足最长保持', value: holdMax.frames ? (Math.round(holdMax.sec * 10) / 10) + ' s' : '—' },
      { name: '右膝角中位', value: k2 ? Math.round(k2.median) + '°' : '—' },
      { name: '单足帧占比', value: Math.round(S.oneFoot.filter(v => v).length / S.oneFoot.length * 100) + '%' }
    ];

    this._clean = { t: S.t, legGap: legGap, kneeL: kneeL, kneeR: kneeR, trunk: trunk, cog: cog };
    this.setData({ checks: checks, stats: stats, chartKey: 'legGap', chartTitle: '浮足高度差（按身高归一 · 已平滑）' });
    this.drawChart();
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
        wx.showModal({ title: '校准完成', content: '已保存关键点映射。再点一次「开始分析」即可出指标。', showCancel: false });
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
      const box = this.fitRect(r.width, r.height, (view.x1 - view.x0) * fw, (view.y1 - view.y0) * fh);
      this._calibBox = box;
      if (this._frameCv && fw && fh) {
        try {
          ctx.drawImage(this._frameCv,
            view.x0 * fw, view.y0 * fh, (view.x1 - view.x0) * fw, (view.y1 - view.y0) * fh,
            box.x, box.y, box.w, box.h);
        } catch (e) {}
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
  // 人小的时候点全挤在一起、根本点不准 —— 一键放大到"关键点的包围盒"
  zoomBody() {
    if (!this._firstPts || !this._firstPts.length) { wx.showToast({ title: '先分析一次', icon: 'none' }); return; }
    if (this._view) { this._view = null; this.setData({ zoomed: false }); this.drawCalib(); return; }
    const xs = [], ys = [];
    this._firstPts.forEach(p => { if (p) { xs.push(p.x); ys.push(p.y); } });
    if (xs.length < 4) { wx.showToast({ title: '关键点太少，无法放大', icon: 'none' }); return; }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    // 去掉两端 10% 的离群点（检测偶尔会在别处冒一个孤立点）
    const lo = Math.floor(xs.length * 0.1), hi = Math.ceil(xs.length * 0.9) - 1;
    let x0 = xs[lo], x1 = xs[hi], y0 = ys[lo], y1 = ys[hi];
    const m = 0.25;                                  // 四周留 25% 边
    const w = Math.max(0.05, x1 - x0), h = Math.max(0.05, y1 - y0);
    x0 = Math.max(0, x0 - w * m); x1 = Math.min(1, x1 + w * m);
    y0 = Math.max(0, y0 - h * m); y1 = Math.min(1, y1 + h * m);
    this._view = { x0: x0, y0: y0, x1: x1, y1: y1 };
    this.setData({ zoomed: true });
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
