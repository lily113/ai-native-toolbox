import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-purple-600 mb-4">
            🌸 朋友型电子手账
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            与AI朋友倾诉，自动生成精美手账
          </p>
          <p className="text-sm text-gray-500">
            让AI陪伴你的每一天，记录生活的美好瞬间
          </p>
        </header>

        <div className="max-w-5xl mx-auto">
          {/* 功能卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="text-4xl mb-4">💬</div>
              <h3 className="text-xl font-semibold mb-2">AI陪伴聊天</h3>
              <p className="text-gray-600 text-sm">
                与温柔的AI朋友分享你的心情、想法和日常
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="text-4xl mb-4">📝</div>
              <h3 className="text-xl font-semibold mb-2">自动生成手账</h3>
              <p className="text-gray-600 text-sm">
                AI自动整理聊天内容，生成精美的手账页面
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="text-4xl mb-4">📊</div>
              <h3 className="text-xl font-semibold mb-2">情绪回顾</h3>
              <p className="text-gray-600 text-sm">
                查看周/月/年总结，了解自己的情绪变化
              </p>
            </div>
          </div>

          {/* 今日手账预览 */}
          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold mb-4">今日手账预览</h2>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400 bg-gray-50">
              <p className="mb-2">还没有今日手账</p>
              <p className="text-sm">去和AI朋友聊天，然后生成你的第一份手账吧！</p>
            </div>
          </div>

          {/* 快速操作 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              to="/chat"
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-4 px-6 rounded-lg text-center transition-colors shadow-lg hover:shadow-xl"
            >
              💬 开始聊天
            </Link>
            <Link
              to="/journal"
              className="bg-pink-500 hover:bg-pink-600 text-white font-semibold py-4 px-6 rounded-lg text-center transition-colors shadow-lg hover:shadow-xl"
            >
              ✨ 快速生成手账
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

