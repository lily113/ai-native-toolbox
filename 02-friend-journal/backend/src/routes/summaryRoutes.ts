import { Router, Request, Response } from 'express';
import { SummaryModel, SummaryType } from '../models/Summary.js';
import { JournalModel } from '../models/Journal.js';
import { analyzeEmotions } from '../services/openaiService.js';
import { createError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * 生成总结
 */
router.post('/generate', async (req: Request, res: Response, next) => {
  try {
    const { userId, type, periodStart, periodEnd } = req.body;

    if (!userId || !type || !periodStart || !periodEnd) {
      throw createError('参数不完整', 400);
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    // 检查是否已存在总结
    const existing = await SummaryModel.findByPeriod(userId, type as SummaryType, startDate, endDate);
    if (existing) {
      return res.json(existing);
    }

    // 获取该时间段内的手账
    const journals = await JournalModel.findByDateRange(userId, startDate, endDate);

    if (journals.length === 0) {
      throw createError('该时间段内没有手账记录', 400);
    }

    // 分析情绪
    const emotionAnalysis = await analyzeEmotions(
      journals.map((j) => ({
        content: j.content,
        createdAt: j.createdAt,
      }))
    );

    // 提取高光事件（从手账标题和事件中提取）
    const highlights: string[] = [];
    journals.forEach((journal) => {
      if (journal.content.title) {
        highlights.push(journal.content.title);
      }
      if (journal.content.events && journal.content.events.length > 0) {
        highlights.push(...journal.content.events.slice(0, 2)); // 每个手账最多取2个事件
      }
    });

    // 生成总结内容（可以使用AI进一步优化）
    const content = {
      summary: `在${type === 'week' ? '这周' : type === 'month' ? '这个月' : '这一年'}里，你记录了${journals.length}篇手账。`,
      highlights: highlights.slice(0, 10), // 最多10个高光事件
      emotionTrend: emotionAnalysis,
    };

    // 创建总结
    const summary = await SummaryModel.create({
      userId,
      type: type as SummaryType,
      periodStart: startDate,
      periodEnd: endDate,
      journalIds: journals.map((j) => j.id),
      highlights: highlights.slice(0, 10),
      emotionAnalysis,
      content,
    });

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

/**
 * 获取用户的总结列表
 */
router.get('/user/:userId', async (req: Request, res: Response, next) => {
  try {
    const { userId } = req.params;
    const { type, limit } = req.query;

    const summaries = await SummaryModel.findByUserId(
      userId,
      type as SummaryType | undefined,
      parseInt(limit as string) || 20
    );

    res.json(summaries);
  } catch (error) {
    next(error);
  }
});

/**
 * 获取单个总结
 */
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const summary = await SummaryModel.findById(id);
    if (!summary) {
      throw createError('总结不存在', 404);
    }
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;

