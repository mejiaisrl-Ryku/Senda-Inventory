import { prismaT as prisma } from "./prisma";

/**
 * Cascade a preparation's allergens onto a recipe it's linked to.
 *
 * Insert-only: if the recipe already has a row for an allergen (whether it
 * was cascaded earlier or set explicitly), this leaves it untouched —
 * cascading never overwrites an existing recipe_allergens row.
 *
 * Best-effort: errors are logged, not thrown, so a cascade failure never
 * blocks the prep-linking request that triggered it.
 */
export async function cascadeAllergensToRecipe(recipeId: string, prepId: number): Promise<void> {
  try {
    const prepAllergens = await prisma.preparationAllergen.findMany({
      where: { preparationId: prepId },
      select: { allergenId: true },
    });

    for (const { allergenId } of prepAllergens) {
      const existing = await prisma.recipeAllergen.findUnique({
        where: { recipeId_allergenId: { recipeId, allergenId } },
      });
      if (existing) continue;

      await prisma.recipeAllergen.create({
        data: { recipeId, allergenId, isPresent: true, manuallyOverridden: false },
      });
    }
  } catch (err) {
    console.error(`[cascadeAllergensToRecipe] prep ${prepId} -> recipe ${recipeId}:`, err);
  }
}

/** Cascade a preparation's (possibly just-updated) allergens to every recipe currently linked to it. */
export async function cascadeAllergensFromPrepToLinkedRecipes(prepId: number): Promise<void> {
  try {
    const links = await prisma.recipePreparation.findMany({
      where: { preparationId: prepId },
      select: { recipeId: true },
    });
    for (const { recipeId } of links) {
      await cascadeAllergensToRecipe(recipeId, prepId);
    }
  } catch (err) {
    console.error(`[cascadeAllergensFromPrepToLinkedRecipes] prep ${prepId}:`, err);
  }
}
