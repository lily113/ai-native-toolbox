import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Friend Journal API is running' });
});

// API Routes
import chatRoutes from './routes/chatRoutes.js';
import journalRoutes from './routes/journalRoutes.js';
import shareRoutes from './routes/shareRoutes.js';
import summaryRoutes from './routes/summaryRoutes.js';
app.use('/api/chat', chatRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/summary', summaryRoutes);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

