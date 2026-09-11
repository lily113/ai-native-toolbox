import { configureStore } from '@reduxjs/toolkit';
import chatReducer from './slices/chatSlice';
import journalReducer from './slices/journalSlice';
import userReducer from './slices/userSlice';

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    journal: journalReducer,
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;



