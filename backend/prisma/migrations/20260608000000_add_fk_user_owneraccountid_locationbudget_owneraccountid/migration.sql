-- AddForeignKey: enforce referential integrity for User.ownerAccountId → owner_accounts
-- Previously a bare String with no DB-level constraint; dangling references were undetected.
ALTER TABLE "users" ADD CONSTRAINT "users_ownerAccountId_fkey"
  FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: enforce referential integrity for LocationBudget.ownerAccountId → owner_accounts
-- Previously a bare String with no DB-level constraint.
ALTER TABLE "location_budgets" ADD CONSTRAINT "location_budgets_ownerAccountId_fkey"
  FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
