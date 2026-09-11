import pool from '../db/connection.js';
import type { JournalContent, JournalLayout } from '../../shared/types.js';

export interface Journal {
  id: string;
  userId: string;
  chatIds: string[];
  content: JournalContent;
  layout: JournalLayout;
  images: string[];
  tags: string[];
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJournalData {
  userId: string;
  chatIds: string[];
  content: JournalContent;
  layout: JournalLayout;
  images?: string[];
  tags?: string[];
  isShared?: boolean;
}

export class JournalModel {
  static async create(data: CreateJournalData): Promise<Journal> {
    const query = `
      INSERT INTO journals (user_id, chat_ids, content, layout, images, tags, is_shared)
      VALUES ($1, $2::uuid[], $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      data.userId,
      data.chatIds,
      JSON.stringify(data.content),
      JSON.stringify(data.layout),
      data.images || [],
      data.tags || [],
      data.isShared || false,
    ];
    const result = await pool.query(query, values);
    return this.mapRowToJournal(result.rows[0]);
  }

  static async findById(id: string): Promise<Journal | null> {
    const query = 'SELECT * FROM journals WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRowToJournal(result.rows[0]) : null;
  }

  static async findByUserId(userId: string, limit: number = 50): Promise<Journal[]> {
    const query = `
      SELECT * FROM journals
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows.map((row) => this.mapRowToJournal(row));
  }

  static async findByDateRange(userId: string, startDate: Date, endDate: Date): Promise<Journal[]> {
    const query = `
      SELECT * FROM journals
      WHERE user_id = $1
      AND created_at >= $2
      AND created_at <= $3
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId, startDate, endDate]);
    return result.rows.map((row) => this.mapRowToJournal(row));
  }

  static async updateShareStatus(id: string, isShared: boolean): Promise<Journal> {
    const query = `
      UPDATE journals
      SET is_shared = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [isShared, id]);
    return this.mapRowToJournal(result.rows[0]);
  }

  private static mapRowToJournal(row: any): Journal {
    return {
      id: row.id,
      userId: row.user_id,
      chatIds: row.chat_ids || [],
      content: row.content,
      layout: row.layout,
      images: row.images || [],
      tags: row.tags || [],
      isShared: row.is_shared,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}



