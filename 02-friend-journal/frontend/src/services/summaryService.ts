import api from './api';
import type { Summary } from '@/types';

export interface GenerateSummaryRequest {
  userId: string;
  type: 'week' | 'month' | 'year';
  periodStart: string;
  periodEnd: string;
}

export const summaryService = {
  async generateSummary(data: GenerateSummaryRequest): Promise<Summary> {
    const response = await api.post<Summary>('/summary/generate', data);
    return response.data;
  },

  async getSummaries(userId: string, type?: 'week' | 'month' | 'year', limit?: number): Promise<Summary[]> {
    const response = await api.get<Summary[]>(`/summary/user/${userId}`, {
      params: { type, limit },
    });
    return response.data;
  },

  async getSummary(id: string): Promise<Summary> {
    const response = await api.get<Summary>(`/summary/${id}`);
    return response.data;
  },
};



