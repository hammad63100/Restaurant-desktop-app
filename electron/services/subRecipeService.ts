import type {
  BatchRecipe,
  BatchRecipeLine,
  Ingredient,
  MadeBatch,
  MadeIngredientRow,
  SaveBatchRecipeInput,
  SubRecipeOverview,
} from '../../src/types/api';
import type { SubRecipeRepository } from '../db/repositories/subRecipeRepository';
import { lineCostPaisa, deductQty } from '../db/repositories/recipeRepository';
import type { InventoryRepository } from '../db/repositories/inventoryRepository';
import { AppError } from '../utils/errors';
import { toSqlDate } from '../utils/datetime';
import { logInfo } from './logger';

/**
 * Sub-recipes (Roadmap 4.I) — house-made ingredients.
 *
 * The client's answer to §15 Q4: some things the kitchen makes itself. Before
 * this, a house sauce had to be faked with a guessed purchase price — a number
 * that would then be wrong forever, silently, and would never tell the owner when
 * the price of oil went up.
 *
 * The rules that make the numbers honest:
 *
 *   * **The cost is derived, never typed.** Cost per base unit is
 *     Σ(line cost) ÷ batch yield, where the line cost uses each component's LIVE
 *     average. Ask "what does a kilo of my mayo cost today?" and the answer moves
 *     with the price of oil, because it should.
 *   * **Making a batch takes components off the shelf and puts the product back
 *     on** at that computed cost, so the product's weighted average follows the
 *     real prices of what it is made of.
 *   * **A batch is frozen once made.** The line cost is snapshotted onto the batch,
 *     so a price rise tomorrow never rewrites what last week's batch cost.
 *   * **One level only.** A sub-recipe cannot contain another sub-recipe. A
 *     fast-food kitchen has one level (sauce from oil+egg), and refusing the second
 *     keeps the cost a single pass with no recursion to get subtly wrong — a
 *     recursive cost that disagrees with the ledger is much worse than a clear
 *     "not supported".
 */
export function createSubRecipeService(deps: {
  subRecipes: SubRecipeRepository;
  inventory: InventoryRepository;
}) {
  const { subRecipes, inventory } = deps;

  function ensureReady(): void {
    if (!subRecipes.isReady) {
      throw new AppError(
        'CONFLICT',
        'House-made ingredients are not available in this database yet. Restart the app to finish the update.',
      );
    }
  }

  function ingredientOrFail(id: number): Ingredient {
    const ingredient = inventory.findIngredient(id);
    if (!ingredient) throw new AppError('NOT_FOUND', 'That ingredient does not exist');
    return ingredient;
  }

  /** Cost of one batch's components, using live average costs. */
  function batchCostOf(ingredientId: number): { lines: BatchRecipeLine[]; total: number } {
    const lines: BatchRecipeLine[] = subRecipes.linesFor(ingredientId).map((row) => ({
      id: row.id,
      componentId: row.component_id,
      componentName: row.component_name,
      baseUnit: row.base_unit,
      qtyBase: row.qty_base,
      wastePercentX100: row.waste_percent_x100,
      unitCostMilli: row.avg_cost_milli,
      lineCost: lineCostPaisa(row.qty_base, row.avg_cost_milli),
      isMade: row.is_made === 1,
      onHand: row.qty_on_hand,
    }));

    return { lines, total: lines.reduce((sum, line) => sum + line.lineCost, 0) };
  }

  function buildBatchRecipe(ingredientId: number): BatchRecipe {
    const ingredient = ingredientOrFail(ingredientId);
    const { lines, total } = batchCostOf(ingredientId);
    const made = ingredient.batchYieldBase > 0;

    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      baseUnit: ingredient.baseUnit,
      batchYieldBase: ingredient.batchYieldBase,
      lines,
      batchCost: total,
      // What one base unit costs to make. Null when the yield is unknown — a
      // division by zero shown as "Rs 0" would look like free mayo.
      unitCostMilli:
        made && ingredient.batchYieldBase > 0
          ? Math.round((total * 1000) / ingredient.batchYieldBase)
          : null,
      isMade: made,
      /** True when this ingredient is itself a component of something else. */
      usedInRecipes: false,
    };
  }

  return {
    /** Everything the "House-made" tab needs: what is made, and what it costs. */
    overview(): SubRecipeOverview {
      ensureReady();

      const rows: MadeIngredientRow[] = inventory
        .listIngredients()
        .filter((ingredient) => ingredient.batchYieldBase > 0)
        .map((ingredient) => {
          const { lines, total } = batchCostOf(ingredient.id);
          const unitCostMilli =
            ingredient.batchYieldBase > 0
              ? Math.round((total * 1000) / ingredient.batchYieldBase)
              : 0;

          return {
            ingredientId: ingredient.id,
            name: ingredient.name,
            baseUnit: ingredient.baseUnit,
            qtyOnHand: ingredient.qtyOnHand,
            batchYieldBase: ingredient.batchYieldBase,
            lineCount: lines.length,
            batchCost: total,
            madeUnitCostMilli: unitCostMilli,
            // The number that matters: is making it cheaper than the price the
            // supplier quoted? Positive = the kitchen makes money by making it.
            comparedToBoughtMilli:
              ingredient.avgCostMilli > 0
                ? ingredient.avgCostMilli - unitCostMilli
                : null,
            canMakeBatches: lines.length === 0 ? 0 : batchesPossible(lines),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        rows,
        madeCount: rows.length,
        missingRecipeCount: rows.filter((row) => row.lineCount === 0).length,
        recentBatches: subRecipes.recentBatches(10).map((batch) => ({
          id: batch.id,
          batchNo: batch.batch_no,
          ingredientId: batch.ingredient_id,
          ingredientName: batch.ingredient_name,
          baseUnit: batch.base_unit,
          qtyBase: batch.qty_base,
          totalCost: batch.total_cost,
          unitCostMilli: batch.unit_cost_milli,
          madeOn: batch.made_on,
          createdByName: batch.created_by_name,
        })),
      };
    },

    recipe(ingredientId: number): BatchRecipe {
      ensureReady();
      const recipe = buildBatchRecipe(ingredientId);
      if (!recipe.isMade && recipe.lines.length === 0) {
        throw new AppError(
          'NOT_FOUND',
          'That ingredient is not made in-house. Set how much one batch produces to start.',
        );
      }
      return recipe;
    },

    /**
     * Saves the batch recipe and its yield.
     *
     * `batchYieldBase: 0` turns the ingredient back into a bought one and clears
     * the components — the honest way to undo a mistake, since leaving components
     * on a bought ingredient would let two prices disagree with nothing to settle
     * the argument.
     */
    saveRecipe(input: SaveBatchRecipeInput): BatchRecipe {
      ensureReady();

      const ingredient = ingredientOrFail(input.ingredientId);

      if (input.batchYieldBase === 0) {
        subRecipes.transaction(() => {
          subRecipes.replaceLines(ingredient.id, []);
          subRecipes.setYield(ingredient.id, 0);
        });
        logInfo(`Sub-recipe cleared: ${ingredient.name} is bought again`);
        return buildBatchRecipe(ingredient.id);
      }

      if (input.lines.length === 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Add at least one ingredient that goes into this batch',
        );
      }

      const seen = new Set<number>();

      for (const line of input.lines) {
        const component = ingredientOrFail(line.componentId);

        if (component.id === ingredient.id) {
          throw new AppError(
            'VALIDATION_ERROR',
            `${ingredient.name} cannot be made from itself`,
          );
        }
        if (component.batchYieldBase > 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `${component.name} is also made in-house. A house-made ingredient cannot go into another house-made one — add its raw ingredients to this recipe instead.`,
          );
        }
        if (!component.active) {
          throw new AppError('CONFLICT', `${component.name} is no longer an active ingredient`);
        }
        if (seen.has(component.id)) {
          throw new AppError('VALIDATION_ERROR', `${component.name} is on two lines`);
        }
        seen.add(component.id);

        if (!Number.isInteger(line.qtyBase) || line.qtyBase <= 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `Enter a whole quantity for ${component.name} (grams, ml or pieces)`,
          );
        }
      }

      subRecipes.transaction(() => {
        subRecipes.replaceLines(ingredient.id, input.lines);
        subRecipes.setYield(ingredient.id, input.batchYieldBase);
      });

      logInfo(
        `Sub-recipe saved for ${ingredient.name}: ${input.lines.length} line(s), ` +
          `yield ${input.batchYieldBase} ${ingredient.baseUnit}`,
      );

      return buildBatchRecipe(ingredient.id);
    },

    /**
     * Makes a batch: take the components off the shelf, put the product on.
     *
     * The whole thing is one transaction. Each component movement names the batch
     * in `reason` and the product movement carries `ref_batch_id`, so the ledger
     * can always answer "where did this mayo come from?".
     *
     * The product's cost is frozen on the batch first and then applied to the shelf
     * through the normal `applyMovement` path, which is what recalculates the
     * weighted average and keeps the cache honest.
     */
    makeBatch(input: { ingredientId: number; batches: number; madeOn?: string; notes?: string }, createdBy: number): MadeBatch {
      ensureReady();

      const ingredient = ingredientOrFail(input.ingredientId);
      if (ingredient.batchYieldBase <= 0) {
        throw new AppError(
          'CONFLICT',
          `${ingredient.name} is a bought ingredient. Set a batch yield and its recipe first.`,
        );
      }
      if (!Number.isInteger(input.batches) || input.batches <= 0) {
        throw new AppError('VALIDATION_ERROR', 'Make at least one batch');
      }

      const madeOn = input.madeOn || toSqlDate();
      if (madeOn > toSqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'A batch cannot be dated in the future');
      }

      const { lines, total } = batchCostOf(ingredient.id);
      if (lines.length === 0) {
        throw new AppError(
          'CONFLICT',
          `${ingredient.name} has no recipe yet, so there is no cost to give the batch.`,
        );
      }

      const batchCount = input.batches;
      const producedQty = ingredient.batchYieldBase * batchCount;
      const totalCost = total * batchCount;
      const unitCostMilli = Math.round((totalCost * 1000) / producedQty);

      const batchId = subRecipes.transaction(() => {
        const id = subRecipes.createBatch({
          batchNo: subRecipes.nextBatchNo(),
          ingredientId: ingredient.id,
          qtyBase: producedQty,
          totalCost,
          unitCostMilli,
          madeOn,
          notes: (input.notes ?? '').trim(),
          createdBy,
        });

        // Take each component off the shelf, at the price it was that day.
        for (const line of lines) {
          // The trim allowance is what the kitchen actually uses up, so it is what
          // leaves the shelf — same rule as a menu item's deduction (4.D).
          const consumed = deductQty(line.qtyBase, line.wastePercentX100) * batchCount;
          const lineCost = lineCostPaisa(consumed, line.unitCostMilli);

          subRecipes.addBatchLine({
            batchId: id,
            componentId: line.componentId,
            qtyBase: consumed,
            unitCostMilli: line.unitCostMilli,
            cost: lineCost,
          });

          inventory.applyMovement({
            ingredientId: line.componentId,
            kind: 'sub_recipe_make',
            qty: -consumed,
            unitCostMilli: line.unitCostMilli,
            reason: `Used in batch ${subRecipes.findBatch(id)?.batch_no ?? ''} of ${ingredient.name}`,
            refBatchId: id,
            createdBy,
          });
        }

        // Put the product on the shelf at the computed cost.
        inventory.applyMovement({
          ingredientId: ingredient.id,
          kind: 'sub_recipe_make',
          qty: producedQty,
          unitCostMilli,
          reason: `Made ${batchCount} batch${batchCount === 1 ? '' : 'es'} (cost ${totalCost} paisa)`,
          refBatchId: id,
          createdBy,
        });

        return id;
      });

      logInfo(
        `Batch ${subRecipes.findBatch(batchId)?.batch_no}: ${producedQty} ${ingredient.baseUnit} of ` +
          `${ingredient.name} at ${unitCostMilli} milli-paisa per unit`,
      );

      return this.batch(batchId);
    },

    batch(batchId: number): MadeBatch {
      ensureReady();
      const batch = subRecipes.findBatch(batchId);
      if (!batch) throw new AppError('NOT_FOUND', 'That batch does not exist');

      return {
        id: batch.id,
        batchNo: batch.batch_no,
        ingredientId: batch.ingredient_id,
        ingredientName: batch.ingredient_name,
        baseUnit: batch.base_unit,
        qtyBase: batch.qty_base,
        totalCost: batch.total_cost,
        unitCostMilli: batch.unit_cost_milli,
        madeOn: batch.made_on,
        notes: batch.notes,
        createdByName: batch.created_by_name,
        lines: subRecipes.linesOfBatch(batchId).map((line) => ({
          id: line.id,
          componentId: line.component_id,
          componentName: line.component_name,
          baseUnit: line.base_unit,
          qtyBase: line.qty_base,
          unitCostMilli: line.unit_cost_milli,
          cost: line.cost,
        })),
      };
    },

    batchesFor(ingredientId: number): MadeBatch[] {
      ensureReady();
      return subRecipes.batchesFor(ingredientId, 20).map((batch) => this.batch(batch.id));
    },
  };

  /** How many whole batches the shelf can supply right now. */
  function batchesPossible(lines: BatchRecipeLine[]): number {
    if (lines.length === 0) return 0;

    let smallest = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      const perBatch = Math.max(deductQty(line.qtyBase, line.wastePercentX100), 1);
      smallest = Math.min(smallest, Math.floor(line.onHand / perBatch));
    }

    return Number.isFinite(smallest) ? Math.max(smallest, 0) : 0;
  }
}

export type SubRecipeService = ReturnType<typeof createSubRecipeService>;
