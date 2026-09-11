import { Router, Request, Response } from 'express';
import { createShareVersion } from '../services/shareService.js';
import { createError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * 创建分享版手账
 */
router.post('/create', async (req: Request, res: Response, next) => {
  try {
    const { journalId, filterOptions } = req.body;

    if (!journalId) {
      throw createError('手账ID不能为空', 400);
    }

    const shareJournal = await createShareVersion(journalId, filterOptions || {});
    res.json(shareJournal);
  } catch (error) {
    next(error);
  }
});

export default router;



