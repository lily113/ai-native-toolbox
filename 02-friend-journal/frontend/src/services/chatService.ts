import api from './api';
import type { ChatMessage } from '@/types';

export interface SendMessageRequest {
  userId: string;
  message: string;
  type?: 'text' | 'image' | 'voice';
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  aiMessage: ChatMessage;
}

export const chatService = {
  async sendMessage(data: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await api.post<SendMessageResponse>('/chat/message', data);
    return response.data;
  },

  async getChatHistory(userId: string, limit?: number): Promise<ChatMessage[]> {
    const response = await api.get<ChatMessage[]>(`/chat/history/${userId}`, {
      params: { limit },
    });
    return response.data;
  },

  async getChatHistoryByRange(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<ChatMessage[]> {
    const response = await api.get<ChatMessage[]>(`/chat/history/${userId}/range`, {
      params: { startDate, endDate },
    });
    return response.data;
  },
};



