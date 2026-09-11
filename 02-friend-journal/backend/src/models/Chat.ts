import pool from '../db/connection.js';

export type ChatType = 'text' | 'image' | 'voice';

export interface Chat {
  id: string;
  userId: string;
  type: ChatType;
  content: string;
  isAI: boolean;
  emotion?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface CreateChatData {
  userId: string;
  type: ChatType;
  content: string;
  isAI: boolean;
  emotion?: string;
  metadata?: Record<string, any>;
}

export class ChatModel {
  static async create(data: CreateChatData): Promise<Chat> {
    const query = `
      INSERT INTO chats (user_id, type, content, is_ai, emotion, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      data.userId,
      data.type,
      data.content,
      data.isAI,
      data.emotion || null,
      JSON.stringify(data.metadata || {}),
    ];
    const result = await pool.query(query, values);
    return this.mapRowToChat(result.rows[0]);
  }

  static async findByUserId(userId: string, limit: number = 50): Promise<Chat[]> {
    const query = `
      SELECT * FROM chats
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows.map((row) => this.mapRowToChat(row)).reverse();
  }

  static async findByDateRange(userId: string, startDate: Date, endDate: Date): Promise<Chat[]> {
    const query = `
      SELECT * FROM chats
      WHERE user_id = $1
      AND created_at >= $2
      AND created_at <= $3
      ORDER BY created_at ASC
    `;
    const result = await pool.query(query, [userId, startDate, endDate]);
    return result.rows.map((row) => this.mapRowToChat(row));
  }

  static async findByIds(chatIds: string[]): Promise<Chat[]> {
    if (chatIds.length === 0) return [];
    const query = `SELECT * FROM chats WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`;
    const result = await pool.query(query, [chatIds]);
    return result.rows.map((row) => this.mapRowToChat(row));
  }

  private static mapRowToChat(row: any): Chat {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      content: row.content,
      isAI: row.is_ai,
      emotion: row.emotion,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    };
  }
}



