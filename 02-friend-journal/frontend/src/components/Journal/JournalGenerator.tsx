import { useState } from 'react';
import { journalService } from '@/services/journalService';
import type { Journal } from '@/types';

interface JournalGeneratorProps {
  userId: string;
  onGenerated?: (journal: Journal) => void;
}

export default function JournalGenerator({ userId, onGenerated }: JournalGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const journal = await journalService.generateJournal({ userId });
      onGenerated?.(journal);
    } catch (err: any) {
      setError(err.response?.data?.message || '生成手账失败');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-xl font-semibold mb-4">生成手账</h3>
      <p className="text-gray-600 mb-4">
        基于你今天的聊天记录，AI将自动生成一份精美的手账
      </p>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? '正在生成手账...' : '✨ 立即生成'}
      </button>
    </div>
  );
}



