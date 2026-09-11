import { useState } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
}

export default function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSend(message.trim());
      setMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4 bg-white">
      <div className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="输入你想说的话..."
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !message.trim()}
          className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '发送中...' : '发送'}
        </button>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className="text-sm text-gray-500 hover:text-purple-600"
          onClick={() => {
            // TODO: 图片上传功能
            alert('图片上传功能开发中...');
          }}
        >
          📷 图片
        </button>
        <button
          type="button"
          className="text-sm text-gray-500 hover:text-purple-600"
          onClick={() => {
            // TODO: 语音输入功能
            alert('语音输入功能开发中...');
          }}
        >
          🎤 语音
        </button>
      </div>
    </form>
  );
}



