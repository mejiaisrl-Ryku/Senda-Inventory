-- Migration: Add SUPER_ADMIN role and make restaurantId nullable on users
-- Run against your Railway Postgres DB (paste into Railway DB console, or:
--   railway connect postgres  →  then \i prisma/migrations/add_super_admin.sql)

-- 1. Add SUPER_ADMIN to the Role enum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- 2. Make restaurantId nullable (SUPER_ADMIN accounts have no restaurant)
ALTER TABLE "users" ALTER COLUMN "restaurantId" DROP NOT NULL;

-- To create your first SUPER_ADMIN account, run:
--   INSERT INTO "users" (id, name, email, password, role, "restaurantId", "updatedAt")
--   VALUES (gen_random_uuid(), 'Super Admin', 'super@kyruadvisory.com',
--           '<bcrypt-hash>', 'SUPER_ADMIN', NULL, now());
-- Generate the bcrypt hash with: node -e "require('bcryptjs').hash('yourpassword',12).then(console.log)"
