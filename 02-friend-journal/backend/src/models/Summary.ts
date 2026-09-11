import pool from '../db/connection.js';
import type { EmotionData } from '../../shared/types.js';

export type SummaryType = 'week' | 'month' | 'year';

export interface Summary {
  id: string;
  userId: string;
  type: SummaryType;
  periodStart: Date;
  periodEnd: Date;
  journalIds: string[];
  highlights: string[];
  emotionAnalysis: EmotionData[];
  content: Record<string, any>;
  createdAt: Date;
}

export interface CreateSummaryData {
  userId: string;
  type: SummaryType;
  periodStart: Date;
  periodEnd: Date;
  journalIds: string[];
  highlights?: string[];
  emotionAnalysis?: EmotionData[];
  content: Record<string, any>;
}

export class SummaryModel {
  static async create(data: CreateSummaryData): Promise<Summary> {
    const query = `
      INSERT INTO summaries (user_id, type, period_start, period_end, journal_ids, highlights, emotion_analysis, content)
      VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8)
      RETURNING *
    `;
    const values = [
      data.userId,
      data.type,
      data.periodStart,
      data.periodEnd,
      data.journalIds,
      data.highlights || [],
      JSON.stringify(data.emotionAnalysis || []),
      JSON.stringify(data.content),
    ];
    const result = await pool.query(query, values);
    return this.mapRowToSummary(result.rows[0]);
  }

  static async findByUserId(userId: string, type?: SummaryType, limit: number = 20): Promise<Summary[]> {
    let query = `
      SELECT * FROM summaries
      WHERE user_id = $1
    `;
    const values: any[] = [userId];
    
    if (type) {
      query += ' AND type = $2';
      values.push(type);
      query += ' ORDER BY period_end DESC LIMIT $3';
      values.push(limit);
    } else {
      query += ' ORDER BY period_end DESC LIMIT $2';
      values.push(limit);
    }
    
    const result = await pool.query(query, values);
    return result.rows.map((row) => this.mapRowToSummary(row));
  }

  static async findByPeriod(
    userId: string,
    type: SummaryType,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Summary | null> {
    const query = `
      SELECT * FROM summaries
      WHERE user_id = $1
      AND type = $2
      AND period_start = $3
      AND period_end = $4
      LIMIT 1
    `;
    const result = await pool.query(query, [userId, type, periodStart, periodEnd]);
    return result.rows.length > 0 ? this.mapRowToSummary(result.rows[0]) : null;
  }

  static async findById(id: string): Promise<Summary | null> {
    const query = 'SELECT * FROM summaries WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRowToSummary(result.rows[0]) : null;
  }

  private static mapRowToSummary(row: any): Summary {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      journalIds: row.journal_ids || [],
      highlights: row.highlights || [],
      emotionAnalysis: row.emotion_analysis || [],
      content: row.content,
      createdAt: row.created_at,
    };
  }
}

