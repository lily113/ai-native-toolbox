import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '@/stores/store';
import { setCurrentJournal, setJournals, addJournal, setLoading, setError } from '@/stores/slices/journalSlice';
import { journalService } from '@/services/journalService';
import JournalCanvas from '@/components/Journal/JournalCanvas';

export default function JournalPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { journals, currentJournal, isLoading, error } = useSelector(
    (state: RootState) => state.journal
  );
  const [userId] = useState(() => localStorage.getItem('userId') || '');

  useEffect(() => {
    if (userId) {
      loadJournals();
    }
  }, [userId]);

  const loadJournals = async () => {
    try {
      dispatch(setLoading(true));
      const data = await journalService.getJournals(userId);
      dispatch(setJournals(data));
      if (data.length > 0 && !currentJournal) {
        dispatch(setCurrentJournal(data[0]));
      }
    } catch (err: any) {
      dispatch(setError(err.response?.data?.message || '加载手账失败'));
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleGenerateJournal = async () => {
    if (!userId) {
      alert('请先登录');
      return;
    }

    try {
      dispatch(setLoading(true));
      dispatch(setError(null));
      const journal = await journalService.generateJournal({ userId });
      dispatch(addJournal(journal));
      dispatch(setCurrentJournal(journal));
    } catch (err: any) {
      dispatch(setError(err.response?.data?.message || '生成手账失败'));
      alert('生成手账失败，请确保有聊天记录');
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleJournalClick = (journal: typeof journals[0]) => {
    dispatch(setCurrentJournal(journal));
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
          <h1 className="text-3xl font-bold text-purple-600">我的手账</h1>
          <button
            onClick={handleGenerateJournal}
            disabled={isLoading}
            className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {isLoading ? '生成中...' : '✨ 生成新手账'}
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 手账列表 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg p-4">
              <h2 className="text-lg font-semibold mb-4">手账列表</h2>
              {journals.length === 0 ? (
                <p className="text-gray-400 text-sm">还没有手账，快去生成一个吧！</p>
              ) : (
                <div className="space-y-2">
                  {journals.map((journal) => (
                    <div
                      key={journal.id}
                      onClick={() => handleJournalClick(journal)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        currentJournal?.id === journal.id
                          ? 'bg-purple-100 border-2 border-purple-500'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="font-medium text-sm">{journal.content.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(journal.createdAt).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 手账预览 */}
          <div className="lg:col-span-3">
            {currentJournal ? (
              <JournalCanvas
                journal={currentJournal}
                layout={currentJournal.layout}
                onExport={(format) => {
                  console.log(`Exported as ${format}`);
                }}
              />
            ) : (
              <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                <p className="text-gray-400 text-lg mb-4">选择一个手账查看，或生成新的手账</p>
                <button
                  onClick={handleGenerateJournal}
                  className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
                >
                  生成新手账
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


