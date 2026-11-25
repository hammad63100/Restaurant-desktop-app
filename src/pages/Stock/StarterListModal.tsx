import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Loader2, Square } from 'lucide-react';
import type { StarterCatalogueGroup } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { BASE_UNIT_SHORT } from '../../utils/units';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

interface StarterListModalProps {
  isOpen: boolean;
  /** Names that are already in the stock list, so they can be shown as present. */
  existingNames: Set<string>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/**
 * "Load starter list" — the fast-food stock the owner does not have to type.
 * Nothing is created until he presses Add; names already present are skipped.
 */
export function StarterListModal({
  isOpen,
  existingNames,
  onClose,
  onSaved,
}: StarterListModalProps) {
  const [groups, setGroups] = useState<StarterCatalogueGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    // The loading flag is set inside the promise callback, not synchronously in the
    // effect body, so React sees a real async change (no cascading render).
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        // Nothing ticked by default: the owner chooses what his kitchen uses.
        setSelected(new Set());
        setIsLoading(true);
        setError(null);
        return getApi().stock.starterCatalogue();
      })
      .then((result) => {
        if (!cancelled && result) setGroups(unwrap(result));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const availableCount = useMemo(
    () =>
      groups.reduce(
        (total, group) =>
          total +
          group.items.filter((item) => !existingNames.has(item.name.toLowerCase())).length,
        0,
      ),
    [groups, existingNames],
  );

  const toggle = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleCategory = (group: StarterCatalogueGroup) => {
    const names = group.items
      .filter((item) => !existingNames.has(item.name.toLowerCase()))
      .map((item) => item.name);
    const allSelected = names.every((name) => selected.has(name));

    setSelected((current) => {
      const next = new Set(current);
      for (const name of names) {
        if (allSelected) next.delete(name);
        else next.add(name);
      }
      return next;
    });
  };

  const submit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = unwrap(
        await getApi().stock.loadStarterList({ names: Array.from(selected) }),
      );
      toast.success(
        result.skipped > 0
          ? `${result.created} ingredient(s) added, ${result.skipped} already there`
          : `${result.created} ingredient(s) added`,
      );
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Load starter list"
      description="Tick what your kitchen uses. You can rename or change any of it later."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="mr-auto text-caption text-text-secondary">
            {selected.size} selected
          </span>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={isSaving} disabled={selected.size === 0}>
            Add {selected.size > 0 ? selected.size : ''} ingredient
            {selected.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the list…
        </div>
      )}

      {!isLoading && availableCount === 0 && (
        <Alert tone="info">Every starter ingredient is already in your stock list.</Alert>
      )}

      {!isLoading && (
        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
          {groups.map((group) => {
            const fresh = group.items.filter(
              (item) => !existingNames.has(item.name.toLowerCase()),
            );
            if (fresh.length === 0) return null;

            const allSelected = fresh.every((item) => selected.has(item.name));

            return (
              <section key={group.category}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-card-title text-text-primary">{group.category}</h3>
                  <button
                    type="button"
                    onClick={() => toggleCategory(group)}
                    className="text-caption font-medium text-primary hover:underline"
                  >
                    {allSelected ? 'Clear' : 'Select all'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {fresh.map((item) => {
                    const isSelected = selected.has(item.name);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => toggle(item.name)}
                        className={`flex items-center gap-2 rounded-control border px-2 py-1.5 text-left text-body transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5 text-text-primary'
                            : 'border-border text-text-secondary hover:bg-background'
                        }`}
                      >
                        {isSelected ? (
                          <CheckSquare aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Square aria-hidden className="h-4 w-4 shrink-0" />
                        )}
                        <span className="flex-1 truncate">{item.name}</span>
                        <span className="text-caption text-text-secondary">
                          {BASE_UNIT_SHORT[item.baseUnit]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
