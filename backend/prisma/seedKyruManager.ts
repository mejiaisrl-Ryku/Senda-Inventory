import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email    = "manager@kyruadvisory.com";
  const plainPw  = "TestManager2026!";
  const hashed   = await bcrypt.hash(plainPw, 10);

  await prisma.user.upsert({
    where:  { email },
    update: { password: hashed, role: "KYRU_MANAGER", name: "Test Manager" },
    create: {
      email,
      password: hashed,
      role:     "KYRU_MANAGER",
      name:     "Test Manager",
    },
  });

  const masked = plainPw.slice(0, 4) + "*".repeat(plainPw.length - 4);
  console.log("KYRU_MANAGER test user created");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${masked}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
