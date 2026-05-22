-- Migration: add BUYOUTS to SalesCategory enum
-- Run against your Railway Postgres DB via the Railway console or psql.

ALTER TYPE "SalesCategory" ADD VALUE IF NOT EXISTS 'BUYOUTS';
