-- Add Department enum and column to products table
-- Run this against your Railway Postgres database:
--   railway run psql -f prisma/migrations/add_department.sql
-- or paste into the Railway DB console.

CREATE TYPE "Department" AS ENUM ('BOH', 'FOH', 'BOTH');
ALTER TABLE "products" ADD COLUMN "department" "Department" NOT NULL DEFAULT 'BOH';
