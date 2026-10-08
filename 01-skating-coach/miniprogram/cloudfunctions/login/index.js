const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// OWNER_OPENID（云函数环境变量）= 开发者本人的 openid。
// 只有它匹配时，客户端才会显示 AI 教练入口；真正的兜底在 deepseek 云函数里。
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const owner = String(process.env.OWNER_OPENID || '').trim();
  // 打日志是为了配 OWNER_OPENID 时能直接从「云函数 → 日志」里看到并复制这个 openid
  console.log('[login] OPENID=' + OPENID + ' ownerConfigured=' + (!!owner) + ' isOwner=' + (!!owner && OPENID === owner));
  return {
    openid: OPENID,
    isOwner: !!owner && OPENID === owner,
    ownerConfigured: !!owner
  };
};
