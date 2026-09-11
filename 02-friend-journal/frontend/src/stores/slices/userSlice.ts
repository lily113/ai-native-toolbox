import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { User, AIPersonality } from '@/types';

interface UserState {
  user: User | null;
  aiPersonality: AIPersonality;
  isLoading: boolean;
}

const initialState: UserState = {
  user: null,
  aiPersonality: 'gentle', // gentle, humorous, rational
  isLoading: false,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
    },
    setAIPersonality: (state, action: PayloadAction<AIPersonality>) => {
      state.aiPersonality = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const { setUser, setAIPersonality, setLoading } = userSlice.actions;
export default userSlice.reducer;



