import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Journal } from '@/types';

interface JournalState {
  journals: Journal[];
  currentJournal: Journal | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: JournalState = {
  journals: [],
  currentJournal: null,
  isLoading: false,
  error: null,
};

const journalSlice = createSlice({
  name: 'journal',
  initialState,
  reducers: {
    setJournals: (state, action: PayloadAction<Journal[]>) => {
      state.journals = action.payload;
    },
    setCurrentJournal: (state, action: PayloadAction<Journal | null>) => {
      state.currentJournal = action.payload;
    },
    addJournal: (state, action: PayloadAction<Journal>) => {
      state.journals.push(action.payload);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const { setJournals, setCurrentJournal, addJournal, setLoading, setError } =
  journalSlice.actions;
export default journalSlice.reducer;



