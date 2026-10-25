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
function yuvToRgba(data, w, h, layout) {
  const px = w * h;
  const src = (data instanceof Uint8Array) ? data : new Uint8Array(data);
  const out = new Uint8ClampedArray(px * 4);
  const lay = layout || 'nv12';
  const hw = w >> 1, hh = h >> 1;

  for (let y = 0; y < h; y++) {
    const uvRow = (y >> 1) * hw;
    const rowY = y * w;
    for (let x = 0; x < w; x++) {
      const yi = rowY + x;
      const Y = src[yi];
      const q = uvRow + (x >> 1);
      let U, V;
      if (lay === 'i420') {
        U = src[px + q];
        V = src[px + (px >> 2) + q];
      } else if (lay === 'nv21') {
        V = src[px + q * 2];
        U = src[px + q * 2 + 1];
      } else {                       // nv12
        U = src[px + q * 2];
        V = src[px + q * 2 + 1];
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

module.exports = { yuvToRgba, grayToRgba, sniff };
