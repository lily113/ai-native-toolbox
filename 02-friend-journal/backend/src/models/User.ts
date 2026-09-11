import pool from '../db/connection.js';
import type { AIPersonality } from '../../shared/types.js';

export interface User {
  id: string;
  username: string;
  email?: string;
  passwordHash?: string;
  aiPersonality: AIPersonality;
  journalPreferences?: Record<string, any>;
  generationTime?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  username: string;
  email?: string;
  passwordHash?: string;
  aiPersonality?: AIPersonality;
}

export class UserModel {
  static async create(data: CreateUserData): Promise<User> {
    const query = `
      INSERT INTO users (username, email, password_hash, ai_personality)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [data.username, data.email || null, data.passwordHash || null, data.aiPersonality || 'gentle'];
    const result = await pool.query(query, values);
    return this.mapRowToUser(result.rows[0]);
  }

  static async findById(id: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRowToUser(result.rows[0]) : null;
  }

  static async findByUsername(username: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE username = $1';
    const result = await pool.query(query, [username]);
    return result.rows.length > 0 ? this.mapRowToUser(result.rows[0]) : null;
  }

  static async updateAIPersonality(userId: string, personality: AIPersonality): Promise<User> {
    const query = `
      UPDATE users
      SET ai_personality = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [personality, userId]);
    return this.mapRowToUser(result.rows[0]);
  }

  static async updateGenerationTime(userId: string, time: string): Promise<User> {
    const query = `
      UPDATE users
      SET generation_time = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [time, userId]);
    return this.mapRowToUser(result.rows[0]);
  }

  private static mapRowToUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      aiPersonality: row.ai_personality,
      journalPreferences: row.journal_preferences || {},
      generationTime: row.generation_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}



