import api from './api';
import type { Journal } from '@/types';

export interface ShareFilterOptions {
  hideEmotions?: boolean;
  hideEvents?: boolean;
  hidePersonalDetails?: boolean;
}

export interface CreateShareRequest {
  journalId: string;
  filterOptions?: ShareFilterOptions;
}

export const shareService = {
  async createShareVersion(data: CreateShareRequest): Promise<Journal> {
    const response = await api.post<Journal>('/share/create', data);
    return response.data;
  },
};



