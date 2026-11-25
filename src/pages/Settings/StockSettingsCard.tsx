import { useState } from 'react';
import type { StockSettings } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * The stock rules that used to be reachable only from code.
 *
 * Three decisions the owner has to make, and none of them is obvious:
 *
 *   * **Allow negative stock** — on (default): the till never argues with a customer,
 *     and the shelf goes negative until the purchase is entered. Off: a sale that the
 *     ingredients cannot cover is refused with a list of what is missing. A shop that
 *     enters purchases promptly should turn this OFF; a busy counter that enters them
 *     at night should leave it ON.
 *   * **Auto sold-out** — off (default): an empty shelf never stops a cashier, because
 *     the owner may know there is more in the freezer. On: an item switches itself off
 *     when it cannot be made, and the menu stays honest without anyone watching.
 *   * **Margin floor** — items whose profit margin falls below this are flagged on the
 *     Menu page. It is a warning, never a block.
 *
 * Everything here needs `settings:write`, which only the owner has.
 */
export function StockSettingsCard({ canWrite }: { canWrite: boolean }) {
  const settings = useAsync(async () => unwrap(await getApi().recipes.stockSettings()), []);

  if (settings.isLoading) {
    return (
      <Card>
        <CardHeading title="Stock rules" />
        <p className="mt-2 text-caption text-text-secondary">Loading…</p>
      </Card>
    );
  }

  if (!settings.data) {
    return (
      <Card>
        <CardHeading title="Stock rules" />
        <Alert tone="error">Could not read the stock settings.</Alert>
      </Card>
    );
  }

  return (
    <StockSettingsForm
      canWrite={canWrite}
      // Re-keyed on the saved values, so the form always starts from what the
      // database says without resetting its own state from an effect.
      key={`${settings.data.allowNegativeStock}-${settings.data.autoSoldOut}-${settings.data.marginAlertPercentX100}`}
      initial={settings.data}
      onSaved={() => settings.reload()}
    />
  );
}

function StockSettingsForm({
  canWrite,
  initial,
  onSaved,
}: {
  canWrite: boolean;
  initial: StockSettings;
  onSaved: () => Promise<void> | void;
}) {
  const [allowNegative, setAllowNegative] = useState(initial.allowNegativeStock);
  const [autoSoldOut, setAutoSoldOut] = useState(initial.autoSoldOut);
  const [marginFloor, setMarginFloor] = useState(
    Math.round(initial.marginAlertPercentX100 / 100),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setIsSaving(true);
    setError(null);

    try {
      unwrap(
        await getApi().recipes.saveStockSettings({
          allowNegativeStock: allowNegative,
          autoSoldOut,
          marginAlertPercentX100: Math.round(marginFloor * 100),
        }),
      );

      toast.success('Stock rules saved');
      await onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeading
        title="Stock rules"
        subtitle="How the app behaves when a recipe asks for more than the shelf holds."
      />

      <div className="mt-3 flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={allowNegative}
            disabled={!canWrite}
            onChange={(event) => setAllowNegative(event.target.checked)}
          />
          <span>
            <span className="font-medium">
              Still take the order when the ingredients are short
            </span>
            <span className="block text-caption text-text-secondary">
              On: the sale goes through and the shelf goes negative until you enter the
              purchase — the till never stops. Off: the sale is refused with a list of what
              is missing.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={autoSoldOut}
            disabled={!canWrite}
            onChange={(event) => setAutoSoldOut(event.target.checked)}
          />
          <span>
            <span className="font-medium">Switch an item off when it cannot be made</span>
            <span className="block text-caption text-text-secondary">
              Off: a cashier can sell it anyway (there may be more in the freezer). On: the
              menu keeps itself honest, and a cashier can still switch it back on by hand.
            </span>
          </span>
        </label>

        <div className="w-40">
          <Input
            label="Margin warning %"
            type="number"
            min={0}
            max={99}
            step={1}
            value={marginFloor}
            disabled={!canWrite}
            onChange={(event) => setMarginFloor(Number(event.target.value))}
            hint="Items below this are flagged red."
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-caption text-text-secondary">
            These rules apply from the next sale.
          </p>
          <Button onClick={() => void save()} isLoading={isSaving} disabled={!canWrite}>
            Save stock rules
          </Button>
        </div>
      </div>
    </Card>
  );
}
