import { useState } from 'react';
import { shareService, ShareFilterOptions } from '@/services/shareService';
import type { Journal } from '@/types';

interface ShareModalProps {
  journal: Journal;
  onClose: () => void;
  onShared: (shareJournal: Journal) => void;
}

export default function ShareModal({ journal, onClose, onShared }: ShareModalProps) {
  const [filterOptions, setFilterOptions] = useState<ShareFilterOptions>({
    hideEmotions: false,
    hideEvents: false,
    hidePersonalDetails: true,
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleShare = async () => {
    setIsCreating(true);
    try {
      const shareJournal = await shareService.createShareVersion({
        journalId: journal.id,
        filterOptions,
      });
      onShared(shareJournal);
      onClose();
    } catch (error) {
      console.error('Failed to create share version:', error);
      alert('创建分享版失败，请重试');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-4">生成分享版手账</h2>
        <p className="text-gray-600 mb-6">
          选择要隐藏的内容，生成适合分享的手账版本
        </p>

        <div className="space-y-4 mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={filterOptions.hidePersonalDetails}
              onChange={(e) =>
                setFilterOptions({ ...filterOptions, hidePersonalDetails: e.target.checked })
              }
              className="mr-2"
            />
            <span>隐藏个人信息</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={filterOptions.hideEmotions}
              onChange={(e) =>
                setFilterOptions({ ...filterOptions, hideEmotions: e.target.checked })
              }
              className="mr-2"
            />
            <span>隐藏情绪信息</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={filterOptions.hideEvents}
              onChange={(e) =>
                setFilterOptions({ ...filterOptions, hideEvents: e.target.checked })
              }
              className="mr-2"
            />
            <span>隐藏事件详情</span>
          </label>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
          >
            取消
          </button>
          <button
            onClick={handleShare}
            disabled={isCreating}
            className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {isCreating ? '生成中...' : '生成分享版'}
          </button>
        </div>
      </div>
    </div>
  );
}



