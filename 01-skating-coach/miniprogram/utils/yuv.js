// YUV → RGBA（纯本地计算：不上传、不联网、不消耗任何 token）
//
// 为什么需要它：小程序的 VideoDecoder 在不同机型/基础库上给出的帧格式不一样
//   · RGBA      宽×高×4 字节      ← 人体检测接口要的就是这个
//   · YUV420   宽×高×1.5 字节     ← 大多数机型给的是这个
// 而 VKSession.detectBody 只认 RGBA。把 YUV 当 RGBA 传进去，检测器看到的是一张噪点图，
// **结果就是 0 个关键点，而且不报错** —— 这就是之前"手机上出不来点"最可能的原因。
//
// 两种 YUV420 布局都要支持（字节数完全一样，只能靠试）：
//   nv12 / nv21：Y 平面之后是【交织】的 UV（UVUVUV…），nv21 只是 U/V 顺序相反
//   i420       ：Y 平面之后是【分开】的 U 平面、V 平面
//
// 用 BT.601 有限范围（16–235 / 16–240）换算，和摄像头/视频解码的默认口径一致。

function clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

// layout: 'nv12' | 'nv21' | 'i420'
// stride: Y 平面每行占多少**字节**（默认为宽度 w）。很多解码器会把每行对齐到 16/32 字节，
//         这时总字节数会比 w*h*1.5 略大 —— 如果还按 stride=w 去读，后面每一行都会错位，
//         检测器看到的就是"斜着撕裂的画面" → 0 个关键点。这是"有的视频能、有的不能"的常见原因。
function yuvToRgba(data, w, h, layout, stride) {
  const px = w * h;
  const src = (data instanceof Uint8Array) ? data : new Uint8Array(data);
  const out = new Uint8ClampedArray(px * 4);
  const lay = layout || 'nv12';
  const yStride = Math.max(w, Math.floor(stride || w));
  const yPlane = yStride * h;
  const uvStride = (lay === 'i420') ? Math.max(w >> 1, Math.floor(yStride / 2)) : yStride;
  const uvH = h >> 1;

  for (let y = 0; y < h; y++) {
    const rowY = y * yStride;
    const uvRow = (y >> 1) * uvStride;
    for (let x = 0; x < w; x++) {
      const yi = rowY + x;
      const Y = src[yi];
      const q = (x >> 1);
      let U, V;
      if (lay === 'i420') {
        U = src[yPlane + uvRow + q];
        V = src[yPlane + uvStride * uvH + uvRow + q];
      } else if (lay === 'nv21') {
        V = src[yPlane + uvRow + q * 2];
        U = src[yPlane + uvRow + q * 2 + 1];
      } else {                       // nv12
        U = src[yPlane + uvRow + q * 2];
        V = src[yPlane + uvRow + q * 2 + 1];
      }
      const c = Y - 16, d = U - 128, e = V - 128;
      const o = yi * 4;
      out[o]     = clamp8((298 * c + 409 * e + 128) >> 8);
      out[o + 1] = clamp8((298 * c - 100 * d - 208 * e + 128) >> 8);
      out[o + 2] = clamp8((298 * c + 516 * d + 128) >> 8);
      out[o + 3] = 255;
    }
  }
  return out;
}

// 灰度（个别机型只给 Y 平面）：按 Y 复制到 RGB
function grayToRgba(data, w, h) {
  const px = w * h;
  const src = (data instanceof Uint8Array) ? data : new Uint8Array(data);
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const Y = src[i], o = i * 4;
    out[o] = out[o + 1] = out[o + 2] = Y;
    out[o + 3] = 255;
  }
  return out;
}

// 判断一帧是什么格式（按"每像素字节数"区分，这是唯一能从外部看出来的线索）
function sniff(bytes, w, h) {
  const px = w * h;
  const per = bytes / px;
  if (Math.abs(per - 4) < 0.12) return 'rgba';
  if (Math.abs(per - 1.5) < 0.12) return 'yuv420';
  if (Math.abs(per - 1) < 0.08) return 'gray';
  if (Math.abs(per - 2) < 0.12) return 'yuv422';
  return 'unknown';
}

// 更完整的一次判定：格式 + 每行字节数（stride）。
// 除了"刚好等于理论字节数"的正常情况，还兼容"每行对齐了 padding"的情况。
function sniffFrame(bytes, w, h) {
  if (!w || !h || !bytes) return { fmt: 'unknown', stride: w, per: 0 };
  const px = w * h;
  const per = bytes / px;
  if (Math.abs(per - 4) < 0.02) return { fmt: 'rgba', stride: w * 4, per: per };
  if (Math.abs(per - 1.5) < 0.02) return { fmt: 'yuv420', stride: w, per: per };
  if (Math.abs(per - 1) < 0.02) return { fmt: 'gray', stride: w, per: per };
  if (Math.abs(per - 2) < 0.02) return { fmt: 'yuv422', stride: w, per: per };
  // 带 padding 的情况：总字节数能被"行数（或其 1.5 倍）"整除
  if (bytes % (h * 1.5) < 1) {
    const st = Math.round(bytes / (h * 1.5));
    if (st >= w && st <= w * 2) return { fmt: 'yuv420', stride: st, per: per, padded: true };
  }
  if (bytes % h === 0) {
    const st = bytes / h;
    if (st >= w * 4 && st <= w * 8) return { fmt: 'rgba', stride: st, per: per, padded: true };
    if (st >= w && st <= w * 2) return { fmt: 'gray', stride: st, per: per, padded: true };
  }
  return { fmt: 'unknown', stride: w, per: per };
}

module.exports = { yuvToRgba, grayToRgba, sniff, sniffFrame };
