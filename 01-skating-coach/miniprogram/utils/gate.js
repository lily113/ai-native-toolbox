// 「开发者功能」的统一闸门
//
// 为什么要有这个东西：AI 教练 / AI 识别导入 属于"生成式人工智能服务"，
// 同门小队会把训练汇总给他人看（隐私指引要单独声明"向第三方提供"）。
// 这两类功能对外发布时一律关闭 —— 审核员看到的应该是一个干净的训练记录工具。
//
// 用法：页面里 gate.open('ai') / gate.open('team')。
// 想开放时只改 utils/const.js 里的 OWNER_ONLY，不用动任何页面。
const { OWNER_ONLY } = require('./const');

function isOwner() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.isOwner);
  } catch (e) { return false; }
}

// name 没配置 = 人人都能用；配置成 true = 只有开发者本人
function open(name) {
  const v = OWNER_ONLY && OWNER_ONLY[name];
  return v ? isOwner() : true;
}

module.exports = { isOwner, open };
