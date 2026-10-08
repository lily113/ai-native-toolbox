#!/bin/bash
# 编译人体关键点提取工具（macOS 自带 Vision 框架，无需第三方依赖）
set -e
cd "$(dirname "$0")"
clang -fobjc-arc -framework Foundation -framework AVFoundation -framework Vision \
      -framework AppKit -framework CoreMedia -framework CoreGraphics -framework ImageIO \
      -framework CoreVideo -o vid vid.m 2>&1 | grep -E "error:" || true
[ -x ./vid ] && echo "✅ 编译完成: $(pwd)/vid" || { echo "❌ 编译失败"; exit 1; }
