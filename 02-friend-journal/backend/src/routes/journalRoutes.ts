import { Router, Request, Response } from 'express';
import { JournalModel, CreateJournalData } from '../models/Journal.js';
import { ChatModel } from '../models/Chat.js';
import { extractJournalContent, generateLayoutSuggestion } from '../services/openaiService.js';
import { createError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * 生成手账
 */
router.post('/generate', async (req: Request, res: Response, next) => {
  try {
    const { userId, chatIds, images = [] } = req.body;

    if (!userId) {
      throw createError('用户ID不能为空', 400);
    }

    // 如果没有提供chatIds，使用今天的所有聊天记录
    let targetChatIds = chatIds;
    if (!targetChatIds || targetChatIds.length === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayChats = await ChatModel.findByDateRange(userId, today, tomorrow);
      targetChatIds = todayChats.map((chat) => chat.id);
    }

    if (targetChatIds.length === 0) {
      throw createError('没有可用的聊天记录生成手账', 400);
    }

    // 获取聊天记录
    const chats = await ChatModel.findByIds(targetChatIds);
    const chatMessages = chats.map((chat) => ({
      content: chat.content,
      isAI: chat.isAI,
      timestamp: chat.createdAt,
    }));

    // 使用AI提取手账内容
    const journalContent = await extractJournalContent(chatMessages);

    // 使用AI生成排版建议
    const layout = await generateLayoutSuggestion(journalContent);

    // 创建手账
    const journal = await JournalModel.create({
      userId,
      chatIds: targetChatIds,
      content: journalContent,
      layout: {
        template: layout.template,
        colors: layout.colors,
        decorations: layout.decorations,
      },
      images,
      tags: journalContent.emotions,
    });

    res.json(journal);
  } catch (error) {
    next(error);
  }
});

/**
 * 获取用户的所有手账
 */
router.get('/user/:userId', async (req: Request, res: Response, next) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const journals = await JournalModel.findByUserId(userId, limit);
    res.json(journals);
  } catch (error) {
    next(error);
  }
});

/**
 * 获取单个手账
 */
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const journal = await JournalModel.findById(id);

    if (!journal) {
      throw createError('手账不存在', 404);
    }

    res.json(journal);
  } catch (error) {
    next(error);
  }
});

/**
 * 更新手账分享状态
 */
router.patch('/:id/share', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const { isShared } = req.body;

    const journal = await JournalModel.updateShareStatus(id, isShared);
    res.json(journal);
  } catch (error) {
    next(error);
  }
});

export default router;



