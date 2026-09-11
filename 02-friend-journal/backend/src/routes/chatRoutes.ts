import { Router, Request, Response } from 'express';
import { ChatModel, CreateChatData } from '../models/Chat.js';
import { generateAIResponse } from '../services/openaiService.js';
import { UserModel } from '../models/User.js';
import { createError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * 发送消息并获取AI回复
 */
router.post('/message', async (req: Request, res: Response, next) => {
  try {
    const { userId, message, type = 'text' } = req.body;

    if (!userId || !message) {
      throw createError('用户ID和消息内容不能为空', 400);
    }

    // 获取用户信息（包括AI人格设置）
    const user = await UserModel.findById(userId);
    if (!user) {
      throw createError('用户不存在', 404);
    }

    // 保存用户消息
    const userChat = await ChatModel.create({
      userId,
      type: type as 'text' | 'image' | 'voice',
      content: message,
      isAI: false,
    });

    // 获取最近的对话上下文（用于AI回复）
    const recentChats = await ChatModel.findByUserId(userId, 10);
    const recentMessages = recentChats
      .slice(-5)
      .map((chat) => ({
        role: chat.isAI ? ('assistant' as const) : ('user' as const),
        content: chat.content,
      }));

    // 生成AI回复
    const aiResponse = await generateAIResponse(message, {
      personality: user.aiPersonality,
      recentMessages,
    });

    // 保存AI回复
    const aiChat = await ChatModel.create({
      userId,
      type: 'text',
      content: aiResponse.content,
      isAI: true,
      emotion: aiResponse.emotion,
    });

    res.json({
      userMessage: userChat,
      aiMessage: aiChat,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 获取用户的聊天记录
 */
router.get('/history/:userId', async (req: Request, res: Response, next) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const chats = await ChatModel.findByUserId(userId, limit);
    res.json(chats);
  } catch (error) {
    next(error);
  }
});

/**
 * 获取指定日期范围的聊天记录
 */
router.get('/history/:userId/range', async (req: Request, res: Response, next) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw createError('开始日期和结束日期不能为空', 400);
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    const chats = await ChatModel.findByDateRange(userId, start, end);
    res.json(chats);
  } catch (error) {
    next(error);
  }
});

export default router;



