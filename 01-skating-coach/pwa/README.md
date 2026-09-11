# 花样滑冰训练计划 · 使用与维护说明

一个纯前端的花样滑冰训练计划工具：日历记录、动作库、训练回顾、智能导入、数据备份，支持 PWA（可安装到手机/电脑桌面、离线使用）。

## 一、文件结构

```
figure-skating/
├── index.html          # 主程序（所有功能都在这一个文件里）
├── manifest.json       # PWA 配置（应用名、图标、启动方式）
├── sw.js               # Service Worker（离线缓存）
├── icons/              # 应用图标
└── README.md           # 本说明
```

> 日常「改功能」只需编辑 `index.html`。`manifest.json`、`sw.js`、`icons/` 一般不用动。

## 二、本地运行（开发/测试）

在 `figure-skating` 文件夹里启动一个静态服务器：

```bash
cd figure-skating
python3 -m http.server 8000
```

浏览器打开：`http://localhost:8000`

> ⚠️ 直接双击 `index.html`（file:// 协议）也能用，但 **PWA 的"添加到主屏幕 / 离线"功能不生效**（Service Worker 需要 http(s)）。测试 PWA 请务必用本地服务器或线上部署。

## 三、部署到 Netlify（上线）

1. 注册并登录 [netlify.com](https://netlify.com)
2. 打开站点后台 → 左侧 **Deploys**
3. 把整个 **`figure-skating` 文件夹** 拖进上传区
4. 等部署完成，得到网址，例如 `https://skating-planner.netlify.app`

> 第一次部署后，可在「Site configuration → General」里改站点名（即改网址），并关掉右下角「Powered by Netlify」徽章（General → Badge）。

## 四、安装成 App（PWA）

- **电脑（Chrome/Edge）**：打开线上网址 → 地址栏右侧「安装」图标（或菜单 → 安装）
- **iPhone**：Safari 打开 → 分享 →「添加到主屏幕」
- **安卓**：浏览器菜单 →「安装应用 / 添加到主屏幕」

安装后图标会出现在桌面/主屏，可离线打开。**务必从线上网址安装，不要从 `localhost` 安装**（本地服务器关了就打不开）。

## 五、数据存储与备份（重要）

- **数据保存在浏览器 localStorage**，四个 key：`records`（记录）、`moves`（动作库）、`templates`（模板）、`meta`（设置）。
- **不联网、不云同步、单设备**：手机和电脑各存各的。
- **可能丢数据的情况**：清除浏览器数据 / 无痕模式 / iOS 长期不用回收 / 存储空间满。
- **建议**：定期点「目标与数据 → 导出备份」下载 JSON；换设备用「导入 JSON」恢复。
- App 内已内置保护：写入失败会弹红色警示条；超过 30 天未备份会有提醒。

## 六、更新流程（改完代码后）

1. 编辑 `index.html`（或 `sw.js` 等）
2. 到 Netlify **Deploys** 页，把 `figure-skating` 文件夹**重新拖进去**
3. 桌面/手机应用：
   - **电脑**：关闭应用窗口 → 重新打开（或按 Ctrl+Shift+R 强刷）
   - **手机**：关掉页面重新打开，或用无痕窗口验证

> 页面导航已设为「网络优先」，在线时刷新一次通常就能拿到最新版。

## 七、常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `localhost:8000` 打不开 | 本地服务器没启动 | 跑 `python3 -m http.server 8000`，或改用线上网址 |
| 改了代码但页面没变 | 部署没更新 / Service Worker 旧缓存 | 重新部署 + 关闭重开 + 强刷（Ctrl+Shift+R） |
| 右下角有 "Powered by Netlify" 遮挡 | 免费站点默认徽章 | Site configuration → General → Badge 关掉 |
| 底部标签栏被遮挡（手机） | Netlify 徽章 | 同上，关掉徽章 |
| 数据不见了 | 清了浏览器数据 / 换了设备 | 用之前导出的 JSON 在「导入 JSON」恢复 |

## 八、使用帮助

应用右上角有「?」按钮，内含快速上手说明（月/周/列表/回顾/动作库、添加训练、智能导入、备份等）。
