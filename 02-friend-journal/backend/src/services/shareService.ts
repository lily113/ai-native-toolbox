import { JournalModel } from '../models/Journal.js';
import type { Journal, JournalContent } from '../../shared/types.js';

/**
 * 过滤敏感内容，生成分享版手账内容
 */
export function filterSensitiveContent(
  journal: Journal,
  options: {
    hideEmotions?: boolean;
    hideEvents?: boolean;
    hidePersonalDetails?: boolean;
  } = {}
): JournalContent {
  const { hideEmotions = false, hideEvents = false, hidePersonalDetails = false } = options;

  let filteredContent: JournalContent = {
    title: journal.content.title,
    text: journal.content.text,
    events: [...journal.content.events],
    emotions: [...journal.content.emotions],
  };

  // 隐藏情绪信息
  if (hideEmotions) {
    filteredContent.emotions = [];
    // 从文本中移除情绪相关的内容（简单处理）
    filteredContent.text = filteredContent.text.replace(/[开心难过焦虑平静]+\s*/g, '');
  }

  // 隐藏事件详情
  if (hideEvents) {
    filteredContent.events = [];
  }

  // 隐藏个人信息（可以进一步细化，比如替换姓名、地址等）
  if (hidePersonalDetails) {
    // 简单的关键词过滤（实际应用中可以更复杂）
    const personalKeywords = ['电话', '地址', '姓名', '公司'];
    personalKeywords.forEach((keyword) => {
      const regex = new RegExp(keyword + '[^。，！？]*[。，！？]?', 'gi');
      filteredContent.text = filteredContent.text.replace(regex, '');
    });
  }

  return filteredContent;
}

/**
 * 生成分享版手账
 */
export async function createShareVersion(
  journalId: string,
  filterOptions: {
    hideEmotions?: boolean;
    hideEvents?: boolean;
    hidePersonalDetails?: boolean;
  }
): Promise<Journal> {
  const journal = await JournalModel.findById(journalId);
  if (!journal) {
    throw new Error('手账不存在');
  }

  const filteredContent = filterSensitiveContent(journal, filterOptions);

  // 创建分享版手账（复制原手账但使用过滤后的内容）
  const shareJournal = await JournalModel.create({
    userId: journal.userId,
    chatIds: journal.chatIds, // 可以留空，因为分享版不需要关联原始聊天
    content: filteredContent,
    layout: journal.layout, // 保持相同的布局
    images: journal.images, // 可以进一步过滤图片
    tags: hideEmotions ? [] : journal.tags,
    isShared: true,
  });

  return shareJournal;
}



