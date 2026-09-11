import { Link, useLocation } from 'react-router-dom';

export default function Navbar() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="text-2xl font-bold text-purple-600">
            朋友型电子手账
          </Link>
          <div className="flex gap-4">
            <Link
              to="/"
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('/') ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              首页
            </Link>
            <Link
              to="/chat"
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('/chat') ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              聊天
            </Link>
            <Link
              to="/journal"
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('/journal') ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              手账
            </Link>
            <Link
              to="/summary"
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('/summary') ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              总结
            </Link>
            <Link
              to="/settings"
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('/settings') ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              设置
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}



