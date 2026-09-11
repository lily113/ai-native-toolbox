import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ChatContainer from '@/components/Chat/ChatContainer';
import { useSelector } from 'react-redux';
import type { RootState } from '@/stores/store';

export default function ChatPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string>('');
  
  // 如果没有用户ID，使用临时ID（实际应用中应该有用户认证）
  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (storedUserId) {
      setUserId(storedUserId);
    } else {
      // 创建临时用户ID
      const tempUserId = `temp_${Date.now()}`;
      localStorage.setItem('userId', tempUserId);
      setUserId(tempUserId);
    }
  }, []);

  if (!userId) {
    return <div>加载中...</div>;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <ChatContainer userId={userId} />
    </div>
  );
}

