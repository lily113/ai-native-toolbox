import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/stores/store';
import { addMessage, setLoading, setError } from '@/stores/slices/chatSlice';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { chatService } from '@/services/chatService';

interface ChatContainerProps {
  userId: string;
}

export default function ChatContainer({ userId }: ChatContainerProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { messages, isLoading, error } = useSelector((state: RootState) => state.chat);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 加载聊天历史
    loadChatHistory();
  }, [userId]);

  useEffect(() => {
    // 自动滚动到底部
    scrollToBottom();
  }, [messages]);

  const loadChatHistory = async () => {
    try {
      dispatch(setLoading(true));
      const history = await chatService.getChatHistory(userId, 50);
      history.forEach((msg) => {
        dispatch(addMessage(msg));
      });
    } catch (err) {
      dispatch(setError('加载聊天记录失败'));
      console.error(err);
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleSendMessage = async (message: string) => {
    try {
      dispatch(setLoading(true));
      dispatch(setError(null));

      // 添加用户消息到UI（立即显示）
      const userMessage: typeof messages[0] = {
        id: Date.now().toString(),
        userId,
        type: 'text',
        content: message,
        isAI: false,
        timestamp: new Date().toISOString(),
      };
      dispatch(addMessage(userMessage));

      // 发送消息并获取AI回复
      const response = await chatService.sendMessage({
        userId,
        message,
        type: 'text',
      });

      // 添加AI回复
      dispatch(addMessage({
        ...response.aiMessage,
        id: response.aiMessage.id || Date.now().toString(),
        userId,
        timestamp: response.aiMessage.timestamp || new Date().toISOString(),
      }));
    } catch (err: any) {
      dispatch(setError(err.response?.data?.message || '发送消息失败'));
      console.error(err);
    } finally {
      dispatch(setLoading(false));
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white shadow-sm px-4 py-3 border-b">
        <h2 className="text-xl font-semibold text-purple-600">与AI朋友聊天</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-gray-400 mt-8">
            <p className="text-lg mb-2">开始与AI朋友聊天吧！</p>
            <p className="text-sm">分享你的心情、想法，或者只是聊聊日常</p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isLoading && messages.length > 0 && (
          <div className="flex justify-start mb-4">
            <div className="bg-purple-100 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
    </div>
  );
}



