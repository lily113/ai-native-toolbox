-- 数据库初始化迁移脚本
-- 运行方式：psql -U postgres -d friend_journal -f backend/src/db/migrations/001_initial_schema.sql

-- 启用UUID扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 执行schema.sql中的表结构
\i backend/src/db/schema.sql



