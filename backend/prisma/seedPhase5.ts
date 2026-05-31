/**
 * Phase 5 test seed — Trompas Restaurant Group (3 locations)
 *
 * USAGE (requires public Railway DATABASE_URL):
 *   cd backend
 *   DATABASE_URL='postgresql://...' npx ts-node prisma/seedPhase5.ts
 *
 * Safe to run multiple times — entities are upserted, time-series data
 * for the last 30 days is deleted and re-created on each run.
 *
 * DO NOT commit this file. DO NOT push to git.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Deterministic-ish "random" within [min, max] seeded by day offset + salt. */
function rand(min: number, max: number, seed: number): number {
  // Simple LCG to avoid crypto dependency while staying deterministic
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  const r = s - Math.floor(s);
  return Math.round((min + r * (max - min)) * 100) / 100;
}

/** Returns a Date object for `daysAgo` days before today, at midnight UTC. */
function dateAgo(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const DAYS = 90;

const GM_PASSWORD_PLAIN    = "TrompasGM2026!";
const OWNER_PASSWORD_PLAIN = "TrompasOwner2026!";

const SALES_SPLITS = { FOOD: 0.60, BEER: 0.15, LIQUOR: 0.15, WINE: 0.10 } as const;

type RestaurantConfig = {
  name:    string;
  address: string;
  salesMin: number;
  salesMax: number;
  labor: { fohMin: number; fohMax: number; bohMin: number; bohMax: number; mgmtMin: number; mgmtMax: number };
};

const RESTAURANT_CONFIGS: RestaurantConfig[] = [
  {
    name:     "Trompas Miami",
    address:  "123 Ocean Dr, Miami, FL",
    salesMin: 4000, salesMax: 6000,
    labor:    { fohMin: 800,  fohMax: 1000, bohMin: 600, bohMax: 800, mgmtMin: 300, mgmtMax: 400 },
  },
  {
    name:     "Trompas DC",
    address:  "456 K St NW, Washington, DC",
    salesMin: 3000, salesMax: 4500,
    labor:    { fohMin: 700,  fohMax: 900,  bohMin: 500, bohMax: 700, mgmtMin: 250, mgmtMax: 350 },
  },
  {
    name:     "Trompas NYC",
    address:  "789 Broadway, New York, NY",
    salesMin: 5000, salesMax: 7500,
    labor:    { fohMin: 900,  fohMax: 1100, bohMin: 700, bohMax: 900, mgmtMin: 350, mgmtMax: 450 },
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌱 Phase 5 seed — Trompas Restaurant Group\n");

  const [ownerHash, gmHash] = await Promise.all([
    bcrypt.hash(OWNER_PASSWORD_PLAIN, 10),
    bcrypt.hash(GM_PASSWORD_PLAIN,    10),
  ]);

  // ── 1. OwnerAccount ──────────────────────────────────────────────────────────
  const ownerAccount = await prisma.ownerAccount.upsert({
    where:  { email: "owner@trompasgroup.com" },
    update: { name: "Trompas Restaurant Group", active: true },
    create: { name: "Trompas Restaurant Group", email: "owner@trompasgroup.com" },
  });
  console.log(`✓ OwnerAccount: ${ownerAccount.name} (${ownerAccount.id})`);

  // ── 2. Restaurants ───────────────────────────────────────────────────────────
  const restaurants: Array<{ id: string; name: string; cfg: RestaurantConfig }> = [];

  for (const cfg of RESTAURANT_CONFIGS) {
    // Find existing or create — no unique constraint on name, so check first
    let restaurant = await prisma.restaurant.findFirst({
      where: { name: cfg.name, ownerAccountId: ownerAccount.id },
    });

    if (!restaurant) {
      restaurant = await prisma.restaurant.create({
        data: {
          name:           cfg.name,
          address:        cfg.address,
          ownerAccountId: ownerAccount.id,
          locationCount:  1,
        },
      });
    } else {
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data:  { address: cfg.address, ownerAccountId: ownerAccount.id },
      });
    }

    restaurants.push({ id: restaurant.id, name: restaurant.name, cfg });
    console.log(`✓ Restaurant: ${restaurant.name} (${restaurant.id})`);
  }

  // ── 3. Users ─────────────────────────────────────────────────────────────────
  const ownerUser = await prisma.user.upsert({
    where:  { email: "carlos@trompasgroup.com" },
    update: {
      name:           "Carlos Mendez",
      password:       ownerHash,
      role:           "OWNER_SUPER_ADMIN",
      ownerAccountId: ownerAccount.id,
      restaurantId:   null,
    },
    create: {
      name:           "Carlos Mendez",
      email:          "carlos@trompasgroup.com",
      password:       ownerHash,
      role:           "OWNER_SUPER_ADMIN",
      ownerAccountId: ownerAccount.id,
      restaurantId:   null,
    },
  });
  console.log(`✓ User: ${ownerUser.name} (${ownerUser.role})`);

  const gmConfigs = [
    { name: "Ana Rivera",     email: "ana@trompasmiami.com",  restaurantName: "Trompas Miami" },
    { name: "Marcus Johnson", email: "marcus@trompasdc.com",  restaurantName: "Trompas DC"   },
    { name: "Sofia Chen",     email: "sofia@trompasnyc.com",  restaurantName: "Trompas NYC"  },
  ];

  for (const gm of gmConfigs) {
    const rest = restaurants.find((r) => r.name === gm.restaurantName)!;
    const user = await prisma.user.upsert({
      where:  { email: gm.email },
      update: { name: gm.name, password: gmHash, role: "ADMIN", restaurantId: rest.id },
      create: { name: gm.name, email: gm.email, password: gmHash, role: "ADMIN", restaurantId: rest.id },
    });
    console.log(`✓ User: ${user.name} (ADMIN → ${rest.name})`);
  }

  // ── 4. Sales entries (delete last 30 days, then re-create) ──────────────────
  console.log("\n📊 Seeding sales data…");
  const salesCounts: Record<string, number> = {};

  for (const { id: restaurantId, name, cfg } of restaurants) {
    // Wipe existing entries for this restaurant in the window
    await prisma.salesEntry.deleteMany({
      where: { restaurantId, date: { gte: dateAgo(DAYS) } },
    });

    const entries: Prisma.SalesEntryCreateManyInput[] = [];

    for (let day = DAYS; day >= 1; day--) {
      const date  = dateAgo(day);
      const total = rand(cfg.salesMin, cfg.salesMax, day * 17 + RESTAURANT_CONFIGS.indexOf(cfg));

      for (const [category, split] of Object.entries(SALES_SPLITS) as [keyof typeof SALES_SPLITS, number][]) {
        const jitter = rand(0.92, 1.08, day * 7 + category.charCodeAt(0));
        entries.push({
          restaurantId,
          date,
          category: category as any,
          amount:   Math.round(total * split * jitter * 100) / 100,
        });
      }
    }

    await prisma.salesEntry.createMany({ data: entries });
    salesCounts[name] = entries.length;
    console.log(`  ✓ ${name}: ${entries.length} sales entries (${DAYS} days × 4 categories)`);
  }

  // ── 5. Labor entries (delete last 30 days, then re-create) ──────────────────
  console.log("\n👷 Seeding labor data…");
  const laborCounts: Record<string, number> = {};

  for (const { id: restaurantId, name, cfg } of restaurants) {
    await prisma.laborEntry.deleteMany({
      where: { restaurantId, date: { gte: dateAgo(DAYS) } },
    });

    const entries: Prisma.LaborEntryCreateManyInput[] = [];
    const idx = RESTAURANT_CONFIGS.indexOf(cfg);

    for (let day = DAYS; day >= 1; day--) {
      const date       = dateAgo(day);
      const fohLabor   = rand(cfg.labor.fohMin,  cfg.labor.fohMax,  day * 3 + idx);
      const bohLabor   = rand(cfg.labor.bohMin,  cfg.labor.bohMax,  day * 5 + idx);
      const management = rand(cfg.labor.mgmtMin, cfg.labor.mgmtMax, day * 11 + idx);
      const total      = Math.round((fohLabor + bohLabor + management) * 100) / 100;

      entries.push({ restaurantId, date, fohLabor, bohLabor, management, total });
    }

    await prisma.laborEntry.createMany({ data: entries });
    laborCounts[name] = entries.length;
    console.log(`  ✓ ${name}: ${entries.length} labor entries (${DAYS} days)`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Phase 5 Seed — Summary                       ║
╠═══════════════════════════════════════════════════════════╣
║ Owner Account  Trompas Restaurant Group                   ║
╠═══════════════════════════════════════════════════════════╣
║ Restaurants    Trompas Miami                              ║
║                Trompas DC                                 ║
║                Trompas NYC                                ║
╠═══════════════════════════════════════════════════════════╣
║ Users          Carlos Mendez      (OWNER_SUPER_ADMIN)     ║
║                Ana Rivera         (ADMIN → Miami)         ║
║                Marcus Johnson     (ADMIN → DC)            ║
║                Sofia Chen         (ADMIN → NYC)           ║
╠═══════════════════════════════════════════════════════════╣`);

  for (const [name, count] of Object.entries(salesCounts)) {
    console.log(`║ Sales          ${name.padEnd(18)} ${String(count).padStart(3)} entries             ║`);
  }
  for (const [name, count] of Object.entries(laborCounts)) {
    console.log(`║ Labor          ${name.padEnd(18)} ${String(count).padStart(3)} entries             ║`);
  }
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log("✅ Phase 5 seed complete.\n");
}

main()
  .catch((err) => {
    console.error("\n❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
