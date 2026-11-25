import { useState } from 'react';
import { Percent, Plus, Save, TicketPercent, Trash2 } from 'lucide-react';
import type { DiscountRule, PromoCode, UserRole } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { formatAmount, formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';

/** Percentages are stored x100 so 5.5% survives the round trip. */
const toPercent = (x100: number) => (x100 / 100).toFixed(x100 % 100 === 0 ? 0 : 1);
const fromPercent = (percent: number) => Math.round(percent * 100);

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Owner / admin',
  manager: 'Manager',
  cashier: 'Cashier',
};

const EMPTY_PROMO: Omit<PromoCode, 'id' | 'uses'> = {
  code: '',
  kind: 'percent',
  value: 0,
  minOrder: 0,
  validFrom: null,
  validTo: null,
  maxUses: null,
  active: true,
};

/**
 * Discount rules and promo codes (feature 3.C).
 *
 * Rules are the ceiling each role may give on its own; anything above the
 * "needs approval" line requires a manager's password at the till. This screen
 * changes policy, so it is admin-only — the main process enforces that too.
 */
export function DiscountsCard({ canWrite }: { canWrite: boolean }) {
  const rules = useAsync(async () => unwrap(await getApi().discounts.rules()), []);
  const promos = useAsync(async () => unwrap(await getApi().discounts.listPromos()), []);

  const [draft, setDraft] = useState<Record<number, DiscountRule>>({});
  const [savedRules, setSavedRules] = useState<DiscountRule[] | null>(null);
  const [savedPromos, setSavedPromos] = useState<PromoCode[] | null>(null);
  const [promoDraft, setPromoDraft] = useState(EMPTY_PROMO);
  const [deleteTarget, setDeleteTarget] = useState<PromoCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingRuleId, setSavingRuleId] = useState<number | null>(null);
  const [isSavingPromo, setIsSavingPromo] = useState(false);

  const rows = savedRules ?? rules.data ?? [];
  const promoRows = savedPromos ?? promos.data ?? [];
  const ruleFor = (rule: DiscountRule) => draft[rule.id] ?? rule;

  const editRule = (rule: DiscountRule, patch: Partial<DiscountRule>) => {
    setDraft((current) => ({ ...current, [rule.id]: { ...ruleFor(rule), ...patch } }));
  };

  const saveRule = async (rule: DiscountRule) => {
    setError(null);
    setSavingRuleId(rule.id);
    try {
      const saved = unwrap(await getApi().discounts.saveRule(ruleFor(rule)));
      setDraft((current) => {
        const next = { ...current };
        delete next[rule.id];
        return next;
      });
      setSavedRules((current) =>
        (current ?? rules.data ?? []).map((row) => (row.id === saved.id ? saved : row)),
      );
      toast.success(`${ROLE_LABELS[saved.role]} rule saved`);
    } catch (saveError) {
      setError(errorMessage(saveError, 'The rule could not be saved'));
    } finally {
      setSavingRuleId(null);
    }
  };

  const savePromo = async () => {
    setError(null);
    setIsSavingPromo(true);
    try {
      const saved = unwrap(
        await getApi().discounts.savePromo({
          ...promoDraft,
          code: promoDraft.code.trim().toUpperCase(),
        }),
      );
      setSavedPromos((current) => [
        ...(current ?? promos.data ?? []).filter((row) => row.id !== saved.id),
        saved,
      ]);
      setPromoDraft(EMPTY_PROMO);
      toast.success(`Promo ${saved.code} saved`);
    } catch (saveError) {
      setError(errorMessage(saveError, 'The promo code could not be saved'));
    } finally {
      setIsSavingPromo(false);
    }
  };

  const deletePromo = async () => {
    if (!deleteTarget) return;
    try {
      unwrap(await getApi().discounts.deletePromo(deleteTarget.id));
      setSavedPromos((current) =>
        (current ?? promos.data ?? []).filter((row) => row.id !== deleteTarget.id),
      );
      toast.success(`Promo ${deleteTarget.code} removed`);
    } catch (deleteError) {
      setError(errorMessage(deleteError, 'The promo code could not be removed'));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeading
          title="Discount rules"
          subtitle="What each role may give on its own. Above the approval line, a manager's password is needed at the till."
        />

        {error && (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {rows.map((rule) => {
            const value = ruleFor(rule);
            const isDirty = JSON.stringify(value) !== JSON.stringify(rule);

            return (
              <div key={rule.id} className="rounded-control border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-button">{ROLE_LABELS[rule.role]}</span>
                  <label className="flex items-center gap-2 text-caption text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={value.active}
                      disabled={!canWrite}
                      onChange={(event) => editRule(rule, { active: event.target.checked })}
                    />
                    Active
                  </label>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Input
                    label="Max discount %"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={!canWrite}
                    value={toPercent(value.maxPercentX100)}
                    onChange={(event) =>
                      editRule(rule, {
                        maxPercentX100: fromPercent(Number(event.target.value) || 0),
                      })
                    }
                  />
                  <Input
                    label="Needs approval above %"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={!canWrite}
                    hint="0 means never"
                    value={toPercent(value.requiresApprovalAbovePercentX100)}
                    onChange={(event) =>
                      editRule(rule, {
                        requiresApprovalAbovePercentX100: fromPercent(
                          Number(event.target.value) || 0,
                        ),
                      })
                    }
                  />
                </div>

                {isDirty && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      disabled={!canWrite}
                      isLoading={savingRuleId === rule.id}
                      onClick={() => void saveRule(rule)}
                    >
                      <Save aria-hidden className="h-4 w-4" />
                      Save rule
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {!rules.isLoading && rows.length === 0 && (
            <p className="text-caption text-text-secondary">No discount rules are set up yet.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Promo codes"
          subtitle="A promo code replaces the manual discount. Customers type it at the till."
        />

        <div className="flex flex-col gap-3">
          {promoRows.map((promo) => (
            <div
              key={promo.id}
              className="flex items-center justify-between gap-3 rounded-control border border-border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-button">
                  <TicketPercent aria-hidden className="h-4 w-4 text-primary" />
                  {promo.code}
                  {!promo.active && <span className="text-caption">(off)</span>}
                </p>
                <p className="text-caption text-text-secondary">
                  {promo.kind === 'percent'
                    ? `${toPercent(promo.value)}% off`
                    : `${formatAmount(promo.value)} off`}
                  {promo.minOrder > 0 && ` · min ${formatAmount(promo.minOrder)}`}
                  {promo.maxUses !== null && ` · used ${promo.uses}/${promo.maxUses}`}
                  {promo.validTo && ` · until ${formatDateTime(`${promo.validTo} 00:00:00`)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={!canWrite}
                onClick={() => setDeleteTarget(promo)}
                aria-label={`Remove promo ${promo.code}`}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {!promos.isLoading && promoRows.length === 0 && (
            <p className="text-caption text-text-secondary">No promo codes yet.</p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <Input
            label="New promo code"
            value={promoDraft.code}
            placeholder="EID15"
            disabled={!canWrite}
            onChange={(event) =>
              setPromoDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
          <Select
            label="Type"
            value={promoDraft.kind}
            disabled={!canWrite}
            options={[
              { value: 'percent', label: 'Percent off' },
              { value: 'fixed', label: 'Fixed amount off' },
            ]}
            onChange={(event) =>
              setPromoDraft((current) => ({
                ...current,
                kind: event.target.value as PromoCode['kind'],
              }))
            }
          />
          <Input
            label={promoDraft.kind === 'percent' ? 'Percent' : 'Amount'}
            type="number"
            min={0}
            disabled={!canWrite}
            hint={promoDraft.kind === 'percent' ? 'Percent x100 is stored internally' : undefined}
            value={
              promoDraft.kind === 'percent'
                ? toPercent(promoDraft.value)
                : (promoDraft.value / 100).toString()
            }
            onChange={(event) => {
              const raw = Number(event.target.value) || 0;
              setPromoDraft((current) => ({
                ...current,
                value: current.kind === 'percent' ? fromPercent(raw) : Math.round(raw * 100),
              }));
            }}
          />
          <Input
            label="Minimum order"
            type="number"
            min={0}
            disabled={!canWrite}
            value={promoDraft.minOrder / 100}
            onChange={(event) =>
              setPromoDraft((current) => ({
                ...current,
                minOrder: Math.round((Number(event.target.value) || 0) * 100),
              }))
            }
          />
          <Input
            label="Valid from"
            type="date"
            disabled={!canWrite}
            value={promoDraft.validFrom ?? ''}
            onChange={(event) =>
              setPromoDraft((current) => ({ ...current, validFrom: event.target.value || null }))
            }
          />
          <Input
            label="Valid to"
            type="date"
            disabled={!canWrite}
            value={promoDraft.validTo ?? ''}
            onChange={(event) =>
              setPromoDraft((current) => ({ ...current, validTo: event.target.value || null }))
            }
          />

          <div className="sm:col-span-2 flex justify-end">
            <Button
              disabled={!canWrite || !promoDraft.code || promoDraft.value <= 0}
              isLoading={isSavingPromo}
              onClick={() => void savePromo()}
            >
              <Plus aria-hidden className="h-4 w-4" />
              Add promo code
            </Button>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1 text-caption text-text-secondary">
          <Percent aria-hidden className="h-3.5 w-3.5" />A promo code and a manual discount cannot
          be used together on one order.
        </p>
      </Card>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Remove this promo code?"
        message={
          deleteTarget
            ? `${deleteTarget.code} will stop working at the till. Past orders keep their discount.`
            : ''
        }
        confirmLabel="Remove"
        onClose={() => setDeleteTarget(null)}
        onConfirm={deletePromo}
      />
    </>
  );
}
