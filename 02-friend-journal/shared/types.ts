// 共享类型定义，前后端都可以使用

export type AIPersonality = 'gentle' | 'humorous' | 'rational';

export interface JournalContent {
  title: string;
  text: string;
  events: string[];
  emotions: string[];
}

export interface JournalLayout {
  template: string;
  colors: string[];
  decorations: Decoration[];
}

export interface Decoration {
  type: 'sticker' | 'border' | 'pattern';
  position: { x: number; y: number };
  data: string;
}

export interface EmotionData {
  date: string;
  emotion: string;
  intensity: number;
}



