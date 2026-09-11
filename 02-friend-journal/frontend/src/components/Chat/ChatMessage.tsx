import { ChatMessage as ChatMessageType } from '@/types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isAI = message.isAI;

  return (
    <div className={`flex ${isAI ? 'justify-start' : 'justify-end'} mb-4`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 ${
          isAI
            ? 'bg-purple-100 text-gray-800'
            : 'bg-purple-600 text-white'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          {isAI && <span className="text-xs font-semibold">AI朋友</span>}
          {!isAI && <span className="text-xs font-semibold">我</span>}
          {message.emotion && (
            <span className="text-xs opacity-70">💭 {message.emotion}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        <div className="text-xs opacity-70 mt-1">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}



