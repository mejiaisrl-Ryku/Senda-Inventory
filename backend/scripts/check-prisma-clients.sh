#!/bin/sh
# Guard: prismaAdmin (BYPASSRLS) may only be imported by bypass-role modules.
# Tenant controllers must use prismaT; pre-auth paths may use the base prisma
# client only for non-RLS tables. See src/lib/prisma.ts header.
set -e

ALLOWED="src/controllers/superAdminController.ts
src/controllers/ownerController.ts
src/controllers/phase6Controller.ts
src/controllers/budgetController.ts
src/lib/prisma.ts
src/lib/audit.ts"

VIOLATIONS=$(grep -rlnE "import .*prismaAdmin.* from" src --include="*.ts" | grep -v "__tests__" | while read -r f; do
  echo "$ALLOWED" | grep -qx "$f" || echo "$f"
done)

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: prismaAdmin (BYPASSRLS) imported outside the allowlist:"
  echo "$VIOLATIONS"
  echo "Tenant code must use prismaT. If this import is legitimate, add the file to scripts/check-prisma-clients.sh"
  exit 1
fi

echo "OK: prismaAdmin only used in allowlisted bypass-role modules."
