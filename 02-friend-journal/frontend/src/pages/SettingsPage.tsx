import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/stores/store';
import { setAIPersonality } from '@/stores/slices/userSlice';
import type { AIPersonality } from '@/types';

export default function SettingsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { aiPersonality } = useSelector((state: RootState) => state.user);
  const [selectedPersonality, setSelectedPersonality] = useState<AIPersonality>(aiPersonality);

  useEffect(() => {
    setSelectedPersonality(aiPersonality);
  }, [aiPersonality]);

  const handlePersonalityChange = (personality: AIPersonality) => {
    setSelectedPersonality(personality);
    dispatch(setAIPersonality(personality));
    // 这里可以调用API保存到后端
    alert('AI人格已更新');
  };

  const personalities: Array<{ value: AIPersonality; label: string; description: string }> = [
    { value: 'gentle', label: '温柔型', description: '温柔体贴，善解人意，给予温暖的情感支持' },
    { value: 'humorous', label: '幽默型', description: '风趣幽默，乐观积极，用轻松方式化解烦恼' },
    { value: 'rational', label: '理性型', description: '理性客观，逻辑清晰，提供专业的建议分析' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold text-purple-600 mb-8">设置</h1>

        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">AI朋友人格设置</h2>
          <p className="text-gray-600 mb-6">
            选择你喜欢的AI朋友人格，它会以对应的方式与你交流
          </p>

          <div className="space-y-4">
            {personalities.map((personality) => (
              <label
                key={personality.value}
                className={`block p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedPersonality === personality.value
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300'
                }`}
              >
                <div className="flex items-start">
                  <input
                    type="radio"
                    name="personality"
                    value={personality.value}
                    checked={selectedPersonality === personality.value}
                    onChange={() => handlePersonalityChange(personality.value)}
                    className="mt-1 mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-lg mb-1">{personality.label}</div>
                    <div className="text-gray-600 text-sm">{personality.description}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">关于</h2>
          <div className="text-gray-600 space-y-2">
            <p>
              <strong>朋友型电子手账</strong>是一款以AI陪伴为核心的电子手账应用。
            </p>
            <p>版本：1.0.0</p>
            <p>开发团队：AI编码课程小组</p>
          </div>
        </div>
      </div>
    </div>
  );
}

