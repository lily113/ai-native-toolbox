import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type AIPersonality = 'gentle' | 'humorous' | 'rational';

const PERSONALITY_PROMPTS: Record<AIPersonality, string> = {
  gentle: '你是一位温柔、体贴、善解人意的AI朋友。你总是用温暖的话语回应，给予用户情感支持。你的语气柔和，充满关怀。',
  humorous: '你是一位幽默、风趣、乐观的AI朋友。你擅长用轻松的方式化解用户的烦恼，用幽默的话语让对话变得有趣。你的语气轻松愉快。',
  rational: '你是一位理性、客观、冷静的AI朋友。你能够帮助用户理性分析问题，提供逻辑清晰的建议。你的语气专业而平和。',
};

export interface ChatContext {
  personality: AIPersonality;
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userEmotion?: string;
}

/**
 * 生成AI回复
 */
export async function generateAIResponse(
  userMessage: string,
  context: ChatContext
): Promise<{ content: string; emotion?: string }> {
  const systemPrompt = buildSystemPrompt(context.personality);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  // 添加上下文消息
  if (context.recentMessages && context.recentMessages.length > 0) {
    for (const msg of context.recentMessages.slice(-10)) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  // 添加当前用户消息
  messages.push({ role: 'user', content: userMessage });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages,
      temperature: 0.8,
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content || '抱歉，我暂时无法回复。';
    
    // 尝试从回复中提取情绪（可选）
    const emotion = detectEmotion(content);

    return { content, emotion };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate AI response');
  }
}

/**
 * 提取聊天内容中的关键信息用于手账生成
 */
export async function extractJournalContent(
  chatMessages: Array<{ content: string; isAI: boolean; timestamp: Date }>
): Promise<{
  title: string;
  text: string;
  events: string[];
  emotions: string[];
}> {
  const userMessages = chatMessages.filter((m) => !m.isAI).map((m) => m.content).join('\n');

  const prompt = `你是一个内容提取专家。请从以下用户聊天记录中提取关键信息，用于生成手账。

用户聊天记录：
${userMessages}

请以JSON格式返回提取的内容，包含以下字段：
- title: 今日手账的标题（简短、有吸引力，不超过20字）
- text: 主要内容摘要（200-300字，温馨、有温度）
- events: 关键事件列表（数组，每个事件不超过30字）
- emotions: 情绪关键词列表（数组，如：开心、焦虑、平静等）

只返回JSON，不要其他文字说明。`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const extracted = JSON.parse(content);

    return {
      title: extracted.title || '今日手账',
      text: extracted.text || '',
      events: Array.isArray(extracted.events) ? extracted.events : [],
      emotions: Array.isArray(extracted.emotions) ? extracted.emotions : [],
    };
  } catch (error) {
    console.error('Failed to extract journal content:', error);
    // 返回默认值
    return {
      title: '今日手账',
      text: '今天是很特别的一天。',
      events: [],
      emotions: [],
    };
  }
}

/**
 * 生成手账排版建议
 */
export async function generateLayoutSuggestion(
  content: { title: string; text: string; events: string[]; emotions: string[] },
  userPreferences?: Record<string, any>
): Promise<{
  template: string;
  colors: string[];
  decorations: Array<{ type: string; position: { x: number; y: number }; data: string }>;
}> {
  const prompt = `你是一个手账设计专家。请根据以下内容，生成手账的排版设计方案。

内容：
- 标题：${content.title}
- 正文：${content.text}
- 事件数量：${content.events.length}
- 情绪：${content.emotions.join('、')}

请以JSON格式返回设计方案，包含：
- template: 模板类型（如：classic, modern, minimalist, decorative）
- colors: 配色方案（数组，3-5个颜色代码，如：["#FFB6C1", "#FFE4E1", "#F0E68C"]）
- decorations: 装饰建议（数组，包含type、position、data字段）

只返回JSON，不要其他文字说明。`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const content_text = completion.choices[0]?.message?.content || '{}';
    const layout = JSON.parse(content_text);

    return {
      template: layout.template || 'classic',
      colors: Array.isArray(layout.colors) ? layout.colors : ['#FFB6C1', '#FFE4E1', '#F0E68C'],
      decorations: Array.isArray(layout.decorations) ? layout.decorations : [],
    };
  } catch (error) {
    console.error('Failed to generate layout suggestion:', error);
    return {
      template: 'classic',
      colors: ['#FFB6C1', '#FFE4E1', '#F0E68C'],
      decorations: [],
    };
  }
}

/**
 * 分析情绪并生成总结
 */
export async function analyzeEmotions(
  journals: Array<{ content: { emotions: string[] }; createdAt: Date }>
): Promise<Array<{ date: string; emotion: string; intensity: number }>> {
  const emotionData = journals.map((j) => ({
    date: j.createdAt.toISOString().split('T')[0],
    emotions: j.content.emotions || [],
  }));

  const prompt = `请分析以下日期和情绪数据，生成情绪曲线数据。

情绪数据：
${JSON.stringify(emotionData, null, 2)}

请以JSON格式返回，格式为：
{
  "emotions": [
    {"date": "2024-01-01", "emotion": "开心", "intensity": 0.8}
  ]
}

每个日期对应一个主要情绪和强度（0-1之间）。`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);

    return Array.isArray(result.emotions) ? result.emotions : [];
  } catch (error) {
    console.error('Failed to analyze emotions:', error);
    return [];
  }
}

function buildSystemPrompt(personality: AIPersonality): string {
  const basePrompt = PERSONALITY_PROMPTS[personality];
  return `${basePrompt}

你的任务是：
1. 倾听用户的心声，给予情感支持
2. 用符合你人格特点的方式回应
3. 适当引导用户表达更多想法和感受
4. 记住用户提到的重要信息，在后续对话中自然提及

记住：你是一位真实的朋友，而不仅仅是回答问题。`;
}

function detectEmotion(text: string): string | undefined {
  const emotionKeywords: Record<string, string[]> = {
    开心: ['开心', '高兴', '快乐', '愉快', '兴奋'],
    难过: ['难过', '伤心', '沮丧', '失落', '失望'],
    焦虑: ['焦虑', '担心', '紧张', '不安'],
    平静: ['平静', '放松', '安心', '舒适'],
  };

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return emotion;
    }
  }

  return undefined;
}



