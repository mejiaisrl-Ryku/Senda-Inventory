import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dopamina = await prisma.client.upsert({
    where: { slug: "dopamina" },
    update: {},
    create: { name: "Dopamina", slug: "dopamina", contactEmail: "hola@dopamina.mx" },
  });

  const milagrosa = await prisma.client.upsert({
    where: { slug: "la-milagrosa" },
    update: {},
    create: { name: "La Milagrosa", slug: "la-milagrosa", contactEmail: "hola@lamilagrosa.mx" },
  });

  await prisma.inventoryItem.createMany({
    skipDuplicates: true,
    data: [
      { name: "Playera básica", sku: "DOP-001", quantity: 50, unit: "pzas", clientId: dopamina.id },
      { name: "Pantalón slim", sku: "DOP-002", quantity: 30, unit: "pzas", clientId: dopamina.id },
      { name: "Bolsa artesanal", sku: "MIL-001", quantity: 20, unit: "pzas", clientId: milagrosa.id },
      { name: "Aretes de plata", sku: "MIL-002", quantity: 100, unit: "pzas", clientId: milagrosa.id },
    ],
  });

  console.log("Seed complete: Dopamina & La Milagrosa loaded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
