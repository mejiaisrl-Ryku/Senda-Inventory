-- CreateEnum
CREATE TYPE "CountDepartment" AS ENUM ('KITCHEN', 'BAR', 'FOH', 'ALL');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "Department" AS ENUM ('BOH', 'FOH', 'BOTH', 'BAR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipeDepartment" AS ENUM ('KITCHEN', 'BAR');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF', 'SUPER_ADMIN', 'KYRU_MANAGER', 'OWNER_SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "SalesCategory" AS ENUM ('BEER', 'LIQUOR', 'WINE', 'FOOD', 'NON_ALCOHOLIC', 'EVENTS', 'DELIVERY', 'BUYOUTS');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('RECEIVED', 'USED', 'ADJUSTED', 'WASTE');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('KG', 'LITERS', 'PIECES', 'LB', 'OZ', 'G', 'EA', 'DOZ', 'CS');

-- CreateTable
CREATE TABLE "cogs_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cogs_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_entries" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "actualQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "variance" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "varianceValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_sessions" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "department" "CountDepartment" NOT NULL DEFAULT 'ALL',
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_entries" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "fohLabor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bohLabor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "management" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_budgets" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "ownerAccountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "revenueTarget" DOUBLE PRECISION NOT NULL,
    "laborPctTarget" DOUBLE PRECISION NOT NULL,
    "primeCostTarget" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "productName" TEXT,
    "sku" TEXT,
    "unit" TEXT,
    "cogsCategoryId" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "department" TEXT,
    "invoiceDate" DATE,
    "invoiceNumber" TEXT,
    "purveyor" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "partner_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" "Unit" NOT NULL DEFAULT 'PIECES',
    "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimumStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "department" "Department" NOT NULL DEFAULT 'BOH',
    "invoiceDate" DATE,
    "purveyor" TEXT,
    "cogsCategoryId" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "conversionFactor" DOUBLE PRECISION,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" "RecipeDepartment" NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" TIMESTAMP(3),
    "logo" TEXT,
    "onboardingDismissed" BOOLEAN NOT NULL DEFAULT false,
    "locationCount" INTEGER NOT NULL DEFAULT 1,
    "ownerAccountId" TEXT,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_entries" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" "SalesCategory" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_logs" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousQuantity" DOUBLE PRECISION NOT NULL,
    "newQuantity" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION NOT NULL,
    "reason" "StockReason" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "notes" TEXT,
    "unitCost" DOUBLE PRECISION,

    CONSTRAINT "stock_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "restaurantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cogs_categories_ownerAccountId_idx" ON "cogs_categories"("ownerAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cogs_categories_ownerAccountId_name_key" ON "cogs_categories"("ownerAccountId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "count_entries_productId_idx" ON "count_entries"("productId" ASC);

-- CreateIndex
CREATE INDEX "count_entries_sessionId_idx" ON "count_entries"("sessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "count_entries_sessionId_productId_key" ON "count_entries"("sessionId" ASC, "productId" ASC);

-- CreateIndex
CREATE INDEX "count_sessions_restaurantId_date_idx" ON "count_sessions"("restaurantId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "count_sessions_restaurantId_idx" ON "count_sessions"("restaurantId" ASC);

-- CreateIndex
CREATE INDEX "count_sessions_restaurantId_status_idx" ON "count_sessions"("restaurantId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "labor_entries_restaurantId_date_idx" ON "labor_entries"("restaurantId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "labor_entries_restaurantId_idx" ON "labor_entries"("restaurantId" ASC);

-- CreateIndex
CREATE INDEX "location_budgets_ownerAccountId_idx" ON "location_budgets"("ownerAccountId" ASC);

-- CreateIndex
CREATE INDEX "location_budgets_restaurantId_idx" ON "location_budgets"("restaurantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "location_budgets_restaurantId_year_month_key" ON "location_budgets"("restaurantId" ASC, "year" ASC, "month" ASC);

-- CreateIndex
CREATE INDEX "order_items_cogsCategoryId_idx" ON "order_items"("cogsCategoryId" ASC);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId" ASC);

-- CreateIndex
CREATE INDEX "order_items_orderId_productName_idx" ON "order_items"("orderId" ASC, "productName" ASC);

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId" ASC);

-- CreateIndex
CREATE INDEX "orders_restaurantId_createdAt_idx" ON "orders"("restaurantId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "orders_restaurantId_idx" ON "orders"("restaurantId" ASC);

-- CreateIndex
CREATE INDEX "owner_accounts_email_idx" ON "owner_accounts"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "owner_accounts_email_key" ON "owner_accounts"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "partner_invites_email_key" ON "partner_invites"("email" ASC);

-- CreateIndex
CREATE INDEX "partner_invites_token_idx" ON "partner_invites"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "partner_invites_token_key" ON "partner_invites"("token" ASC);

-- CreateIndex
CREATE INDEX "products_cogsCategoryId_idx" ON "products"("cogsCategoryId" ASC);

-- CreateIndex
CREATE INDEX "products_restaurantId_idx" ON "products"("restaurantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku" ASC);

-- CreateIndex
CREATE INDEX "recipe_ingredients_productId_idx" ON "recipe_ingredients"("productId" ASC);

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipeId_idx" ON "recipe_ingredients"("recipeId" ASC);

-- CreateIndex
CREATE INDEX "recipes_restaurantId_idx" ON "recipes"("restaurantId" ASC);

-- CreateIndex
CREATE INDEX "recipes_restaurantId_name_idx" ON "recipes"("restaurantId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "restaurants_ownerAccountId_idx" ON "restaurants"("ownerAccountId" ASC);

-- CreateIndex
CREATE INDEX "sales_entries_restaurantId_date_idx" ON "sales_entries"("restaurantId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "sales_entries_restaurantId_idx" ON "sales_entries"("restaurantId" ASC);

-- CreateIndex
CREATE INDEX "stock_logs_productId_idx" ON "stock_logs"("productId" ASC);

-- CreateIndex
CREATE INDEX "stock_logs_userId_idx" ON "stock_logs"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_ownerAccountId_idx" ON "users"("ownerAccountId" ASC);

-- CreateIndex
CREATE INDEX "users_restaurantId_idx" ON "users"("restaurantId" ASC);

-- AddForeignKey
ALTER TABLE "cogs_categories" ADD CONSTRAINT "cogs_categories_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_sessions" ADD CONSTRAINT "count_sessions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_budgets" ADD CONSTRAINT "location_budgets_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_budgets" ADD CONSTRAINT "location_budgets_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_cogsCategoryId_fkey" FOREIGN KEY ("cogsCategoryId") REFERENCES "cogs_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_cogsCategoryId_fkey" FOREIGN KEY ("cogsCategoryId") REFERENCES "cogs_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_entries" ADD CONSTRAINT "sales_entries_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

