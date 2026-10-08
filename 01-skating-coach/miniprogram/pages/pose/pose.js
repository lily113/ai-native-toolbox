const store = require('../../utils/store');
const pose = require('../../utils/pose');
const { POSE_JOINTS } = require('../../utils/const');

// 姿态自查（视频分析）：
//   选相册视频 → VideoDecoder 逐帧解码 → VKSession.detectBody（静态图片模式）→ 关键点序列
//   → 离线平滑 + 离群剔除 → 客观指标 + 动作检查项
// 视频不上传、不保存；帧数据用完即丢。基础库要求：VideoDecoder ≥2.11.0，人体检测 ≥2.28.0
const MIN_SDK_BODY = '2.28.0';
const MIN_SDK_DEC = '2.11.0';
const HIT_R = 0.12;              // 点选校准命中半径（归一化）

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
    let sdk = '0';
    try { sdk = wx.getSystemInfoSync().SDKVersion || '0'; } catch (e) {}
    let tip = '';
    if (typeof wx.createVKSession !== 'function') tip = '当前环境不支持人体检测（VisionKit）：请用真机预览，开发者工具不支持';
    else if (cmpVer(sdk, MIN_SDK_BODY) < 0) tip = '需要基础库 ≥ ' + MIN_SDK_BODY + '（当前 ' + sdk + '）';
    else if (typeof wx.createVideoDecoder !== 'function') tip = '当前环境不支持视频逐帧解码（需基础库 ≥ ' + MIN_SDK_DEC + '）';
    this._sdk = sdk; this._platform = platform;
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
      const combos = [
        { th: 0.5, st: 1 }, { th: 0.5, st: 0 }, { th: 0.3, st: 1 }
      ];
      const cfg = { n: '默认版本', v: undefined, opt: {} };
      const r = await this.tryConfig(cfg.n, cfg.v, null);
      const session = r.session;
      diag.push('【' + cfg.n + '】state=' + r.out.state + (r.out.err ? ' · ' + r.out.err : ''));
      if (session) {
        let got = 0;
        for (const cb of combos) {
          let pts = 0;
          for (let k = 0; k < 3; k++) {
            const one = await this.detectOnce(session, f, cb.th, cb.st);
            if (one > 0) { pts = one; break; }
          }
          diag.push('  阈值 ' + cb.th + ' · sourceType ' + cb.st + ' → 关键点 ' + pts + (pts > 0 ? ' ✅' : ''));
          if (pts > 0) { got = pts; break; }
        }
        if (got > 0) working = { name: cfg.n, version: cfg.v, session: session };
        else { try { session.destroy(); } catch (e) {} }
      }
      try { if (working && working.session) working.session.destroy(); } catch (e) {}
      this.cleanup();
      const okLine = working ? ('✅ 可用配置：' + working.name + '（分析将使用它）') : '❌ 两种配置都没拿到关键点：本机可能不支持「静态图片人体检测」';
      this.setData({
        analyzing: false,
        diag: diag.concat([okLine]),
        cfgName: working ? working.name : '',
        cfgVersion: working ? (working.version || '') : '',
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

  copyDiag() {
    const t = (this.data.diag || []).join('\n') + '\n— 基础库 ' + (this._sdk || '?') + ' · ' + (this._platform || '?');
    wx.setClipboardData({ data: t });
  },

  toggleDownscale() { this.setData({ downscale: !this.data.downscale }); },

  // 高分辨率帧先降采样（减少内存与耗时；检测模型本身也会缩放）
  prepareFrame(f) {
    const maxSide = this.data.maxSide || 640;
    if (!this.data.downscale || Math.max(f.width, f.height) <= maxSide) {
      return { data: f.data, width: f.width, height: f.height };
    }
    try {
      const c1 = this._w1, c2 = this._w2;
      if (!c1 || !c2) return { data: f.data, width: f.width, height: f.height };
      const scale = maxSide / Math.max(f.width, f.height);
      const w2 = Math.max(2, Math.round(f.width * scale)), h2 = Math.max(2, Math.round(f.height * scale));
      const ctx1 = c1.getContext('2d'), ctx2 = c2.getContext('2d');
      const px = f.width * f.height;
      if ((f.data.byteLength || f.data.length) < px * 4) return { data: f.data, width: f.width, height: f.height };
      const img = ctx1.createImageData(f.width, f.height);
      img.data.set(new Uint8ClampedArray(f.data, 0, px * 4));
      ctx1.putImageData(img, 0, 0);
      ctx2.clearRect(0, 0, w2, h2);
      ctx2.drawImage(c1, 0, 0, f.width, f.height, 0, 0, w2, h2);
      const out = ctx2.getImageData(0, 0, w2, h2);
      return { data: out.data.buffer, width: w2, height: h2 };
    } catch (e) {
      return { data: f.data, width: f.width, height: f.height };
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
    const buf = f.data;
    const w = f.width, h = f.height;
    const px = w * h;
    const bytes = buf.byteLength || buf.length || 0;
    let frameBuffer = buf;
    if (!this.data.formatNote) {
      if (Math.abs(bytes - px * 4) < px * 0.1) this.setData({ formatNote: '像素格式：RGBA（' + w + '×' + h + '，每像素 4 字节）✅ 与检测接口匹配' });
      else if (Math.abs(bytes - px * 1.5) < px * 0.2) this.setData({ formatNote: '⚠️ 像素格式疑似 YUV420（' + bytes + ' 字节 / ' + px + ' 像素）——检测接口需要 RGBA，若检测始终为 0，请把这条发我' });
      else this.setData({ formatNote: '像素格式未知：' + bytes + ' 字节 / ' + w + '×' + h + ' 像素（若检测为 0，请把这条发我）' });
    }
    const anchors = new Promise(resolve => {
      this._pending = resolve;
      setTimeout(() => { if (this._pending === resolve) { this._pending = null; resolve(null); } }, 400);
    });
    try {
      this._session.detectBody({ frameBuffer: frameBuffer, width: w, height: h, scoreThreshold: 0.8, sourceType: 0 });
    } catch (e) {
      this._pending = null;
      return;
    }
    anchors.then(list => {
      const arr = Array.isArray(list) ? list : [];
      const body = arr.filter(a => a && a.type === 5 && a.points && a.points.length)[0];
      if (body) this._detCount = (this._detCount || 0) + 1;
      if (!body) return;
      if (!this._firstPts) this._firstPts = body.points;
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
    if (!S.legGap || S.legGap.length < 5) {
      wx.showModal({
        title: '没拿到足够数据',
        content: '检测到的有效帧太少（' + (S.legGap ? S.legGap.length : 0) + ' 帧）。请确认：① 视频里主体清晰、占画面够大；② 已校准关键点；③ 基础库 ≥ 2.28.0。' + (this.data.formatNote ? '\n' + this.data.formatNote : ''),
        showCancel: false
      });
      return;
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
      const x = (e.detail.x - rect.left) / rect.width;
      const y = (e.detail.y - rect.top) / rect.height;
      let best = -1, bd = HIT_R;
      this._firstPts.forEach((p, i) => {
        if (!p) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = i; }
      });
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
      this._firstPts.forEach((p, i) => {
        if (!p) return;
        const x = p.x * r.width, y = p.y * r.height;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(250,204,21,.95)'; ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(String(i), x + 7, y - 6);
      });
    });
  },
  setHeight(e) {
    const cm = Math.max(0, Math.min(220, Number(e.detail.value) || 0));
    const meta = store.load(store.KEYS.meta) || {};
    meta.heightCm = cm;
    store.save(store.KEYS.meta, meta);
    this.setData({ heightCm: cm });
  }
});
