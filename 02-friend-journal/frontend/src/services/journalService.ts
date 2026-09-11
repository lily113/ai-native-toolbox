import api from './api';
import type { Journal } from '@/types';

export interface GenerateJournalRequest {
  userId: string;
  chatIds?: string[];
  images?: string[];
}

export const journalService = {
  async generateJournal(data: GenerateJournalRequest): Promise<Journal> {
    const response = await api.post<Journal>('/journal/generate', data);
    return response.data;
  },

  async getJournals(userId: string, limit?: number): Promise<Journal[]> {
    const response = await api.get<Journal[]>(`/journal/user/${userId}`, {
      params: { limit },
    });
    return response.data;
  },

  async getJournal(id: string): Promise<Journal> {
    const response = await api.get<Journal>(`/journal/${id}`);
    return response.data;
  },

  async updateShareStatus(id: string, isShared: boolean): Promise<Journal> {
    const response = await api.patch<Journal>(`/journal/${id}/share`, { isShared });
    return response.data;
  },
};



