import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { summaryService } from '@/services/summaryService';
import EmotionChart from '@/components/Summary/EmotionChart';
import type { Summary } from '@/types';

export default function SummaryPage() {
  const navigate = useNavigate();
  const [userId] = useState(() => localStorage.getItem('userId') || '');
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summaryType, setSummaryType] = useState<'week' | 'month' | 'year'>('week');

  useEffect(() => {
    if (userId) {
      loadSummaries();
    }
  }, [userId, summaryType]);

  const loadSummaries = async () => {
    try {
      const data = await summaryService.getSummaries(userId, summaryType);
      setSummaries(data);
      if (data.length > 0) {
        setSelectedSummary(data[0]);
      }
    } catch (error) {
      console.error('Failed to load summaries:', error);
    }
  };

  const handleGenerateSummary = async () => {
    if (!userId) return;

    setIsGenerating(true);
    try {
      const today = new Date();
      let periodStart: Date;
      let periodEnd = today;

      if (summaryType === 'week') {
        periodStart = new Date(today);
        periodStart.setDate(today.getDate() - 7);
      } else if (summaryType === 'month') {
        periodStart = new Date(today);
        periodStart.setMonth(today.getMonth() - 1);
      } else {
        periodStart = new Date(today);
        periodStart.setFullYear(today.getFullYear() - 1);
      }

      const summary = await summaryService.generateSummary({
        userId,
        type: summaryType,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      });

      setSelectedSummary(summary);
      await loadSummaries();
    } catch (error: any) {
      alert(error.response?.data?.message || '生成总结失败');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!userId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">请先登录</p>
          <button
            onClick={() => navigate('/')}
            className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-purple-600">回顾总结</h1>
        </div>

        <div className="mb-6 flex gap-4">
          <select
            value={summaryType}
            onChange={(e) => setSummaryType(e.target.value as 'week' | 'month' | 'year')}
            className="border border-gray-300 rounded-lg px-4 py-2"
          >
            <option value="week">周总结</option>
            <option value="month">月总结</option>
            <option value="year">年总结</option>
          </select>
          <button
            onClick={handleGenerateSummary}
            disabled={isGenerating}
            className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {isGenerating ? '生成中...' : '生成总结'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 总结列表 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg p-4">
              <h2 className="text-lg font-semibold mb-4">总结列表</h2>
              {summaries.length === 0 ? (
                <p className="text-gray-400 text-sm">还没有总结，快去生成一个吧！</p>
              ) : (
                <div className="space-y-2">
                  {summaries.map((summary) => (
                    <div
                      key={summary.id}
                      onClick={() => setSelectedSummary(summary)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedSummary?.id === summary.id
                          ? 'bg-purple-100 border-2 border-purple-500'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="font-medium text-sm">
                        {summary.type === 'week' ? '周' : summary.type === 'month' ? '月' : '年'}
                        总结
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(summary.periodStart).toLocaleDateString('zh-CN')} -{' '}
                        {new Date(summary.periodEnd).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 总结详情 */}
          <div className="lg:col-span-2">
            {selectedSummary ? (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4">
                  {selectedSummary.type === 'week' ? '周' : selectedSummary.type === 'month' ? '月' : '年'}
                  总结
                </h2>
                <div className="text-gray-600 mb-6">
                  {new Date(selectedSummary.periodStart).toLocaleDateString('zh-CN')} -{' '}
                  {new Date(selectedSummary.periodEnd).toLocaleDateString('zh-CN')}
                </div>

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">总结内容</h3>
                  <p className="text-gray-700">
                    {(selectedSummary.content as any)?.summary || '暂无总结内容'}
                  </p>
                </div>

                {selectedSummary.highlights.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">高光事件</h3>
                    <ul className="list-disc list-inside space-y-1">
                      {selectedSummary.highlights.map((highlight, index) => (
                        <li key={index} className="text-gray-700">
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedSummary.emotionAnalysis.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-4">情绪变化</h3>
                    <EmotionChart emotionData={selectedSummary.emotionAnalysis} />
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                <p className="text-gray-400 text-lg mb-4">
                  选择一个总结查看，或生成新的总结
                </p>
                <button
                  onClick={handleGenerateSummary}
                  className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
                >
                  生成总结
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

