-- Migration: BAR department, new Unit values, purveyor + invoiceDate on products
-- Run against your Railway Postgres DB:
--   Paste into the Railway DB console, or connect via psql and \i this file.

-- 1. Add BAR to Department enum
ALTER TYPE "Department" ADD VALUE 'BAR';

-- 2. Add new Unit enum values
ALTER TYPE "Unit" ADD VALUE 'LB';
ALTER TYPE "Unit" ADD VALUE 'OZ';
ALTER TYPE "Unit" ADD VALUE 'G';
ALTER TYPE "Unit" ADD VALUE 'EA';
ALTER TYPE "Unit" ADD VALUE 'DOZ';

-- 3. Add purveyor and invoiceDate columns to products
ALTER TABLE "products" ADD COLUMN "purveyor" TEXT;
ALTER TABLE "products" ADD COLUMN "invoiceDate" DATE;
