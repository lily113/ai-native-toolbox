export type AIPersonality = 'gentle' | 'humorous' | 'rational';

export interface User {
  id: string;
  username: string;
  email?: string;
  aiPersonality: AIPersonality;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  type: 'text' | 'image' | 'voice';
  content: string;
  isAI: boolean;
  timestamp: string;
  emotion?: string;
}

export interface Journal {
  id: string;
  userId: string;
  chatIds: string[];
  content: JournalContent;
  layout: JournalLayout;
  images: string[];
  tags: string[];
  createdAt: string;
  isShared: boolean;
}

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

export interface Summary {
  id: string;
  userId: string;
  type: 'week' | 'month' | 'year';
  period: string;
  journals: string[];
  highlights: string[];
  emotionAnalysis: EmotionData[];
  createdAt: string;
}

export interface EmotionData {
  date: string;
  emotion: string;
  intensity: number;
}



