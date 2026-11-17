import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Minus, Plus, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import type { DeliveryBoy, MenuItem, OrderStatus, OrderType, Waiter } from '../../types/api';
import { ORDER_TYPE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useSettings } from '../../store/settingsStore';
import { formatAmount, todayIso } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Select } from '../../components/Select';
import { PageHeader } from '../../components/PageHeader';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';

interface CartLine {
  item: MenuItem;
  qty: number;
}

/**
 * New Order screen (design.md section 8): menu grid on the left (~65%),
 * the running order and totals on the right (~35%). Keyboard friendly:
 * Enter on the search box adds the first match.
 */
export function NewOrderPage() {
  const navigate = useNavigate();
  const settings = useSettings((state) => state);
  const currency = settings.currency;

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [waiterId, setWaiterId] = useState<string>('');
  const [deliveryBoyId, setDeliveryBoyId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState<number | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('pending');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useAsync(async () => unwrap(await getApi().menu.listCategories()), []);
  const items = useAsync(async () => unwrap(await getApi().menu.listItems()), []);
  const waiters = useAsync(async () => unwrap(await getApi().staff.listWaiters()), []);
  const riders = useAsync(async () => unwrap(await getApi().staff.listDeliveryBoys()), []);

  // The shop's default tax is used until the cashier types their own value.
  const effectiveTaxPercent = taxPercent ?? settings.taxPercent;

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      const matchesCategory = categoryId === 'all' || item.categoryId === categoryId;
      const matchesSearch = !term || item.name.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [items.data, categoryId, search]);

  const subtotal = cart.reduce((total, line) => total + line.item.price * line.qty, 0);
  const safeDiscount = Math.min(discount, subtotal);
  const tax = Math.round(((subtotal - safeDiscount) * effectiveTaxPercent) / 100);
  const total = subtotal - safeDiscount + tax;

  const addItem = (item: MenuItem) => {
    if (!item.available) {
      toast.error(`${item.name} is marked sold out`);
      return;
    }

    setCart((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) =>
          line.item.id === item.id ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [...current, { item, qty: 1 }];
    });
  };

  const changeQty = (itemId: number, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.item.id === itemId ? { ...line, qty: Math.max(0, line.qty + delta) } : line,
        )
        .filter((line) => line.qty > 0),
    );
  };

  const clearCart = () => setCart([]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = visibleItems[0];
    if (first) {
      addItem(first);
      setSearch('');
    }
  };

  const save = async (thenPrint: boolean) => {
    setError(null);

    if (cart.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }

    setIsSaving(true);
    try {
      const created = unwrap(
        await getApi().orders.create({
          type: orderType,
          status: orderStatus,
          customerName,
          customerPhone,
          customerAddress,
          waiterId: waiterId ? Number(waiterId) : null,
          deliveryBoyId: deliveryBoyId ? Number(deliveryBoyId) : null,
          discount,
          taxPercent: effectiveTaxPercent,
          notes,
          items: cart.map((line) => ({ itemId: line.item.id, qty: line.qty, notes: '' })),
        }),
      );

      toast.success(`Order ${created.orderNo} saved`);
      navigate(`/invoice/${created.id}`, { state: { autoPrint: thenPrint } });
    } catch (saveError) {
      setError(errorMessage(saveError, 'The order could not be saved'));
      setIsSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="New order"
        subtitle="Pick items, choose the order type, then save and print."
        actions={
          <Button variant="secondary" onClick={() => navigate('/orders')}>
            <X aria-hidden className="h-4 w-4" />
            Close
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[65%_35%]">
        {/* ------------------------------ Menu ------------------------------ */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search an item, press Enter to add the first match"
                aria-label="Search the menu"
                className="h-control-lg w-full rounded-control border border-border bg-surface pl-9 pr-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategoryId('all')}
              className={`h-8 rounded-full border px-3 text-caption font-medium ${
                categoryId === 'all'
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-text-secondary'
              }`}
            >
              All
            </button>
            {(categories.data ?? []).map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={`h-8 rounded-full border px-3 text-caption font-medium ${
                  categoryId === category.id
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-surface text-text-secondary'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {items.isLoading && <p className="text-body text-text-secondary">Loading the menu…</p>}

          {!items.isLoading && visibleItems.length === 0 && (
            <Card>
              <p className="text-body font-medium">No items found</p>
              <p className="mt-1 text-caption text-text-secondary">
                Add items on the Menu page, or change the search.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleItems.map((item) => {
              const inCart = cart.find((line) => line.item.id === item.id)?.qty ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addItem(item)}
                  disabled={!item.available}
                  className={`card relative flex min-h-[104px] flex-col justify-between p-3 text-left transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${
                    inCart > 0 ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  {inCart > 0 && (
                    <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-caption font-semibold text-white">
                      {inCart}
                    </span>
                  )}
                  <p className="pr-6 font-medium text-text-primary">{item.name}</p>
                  <div>
                    <p className="text-card-title text-primary">{formatAmount(item.price)}</p>
                    <p className="text-caption text-text-secondary">
                      {item.available ? item.categoryName : 'Sold out'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ------------------------------ Cart ------------------------------ */}
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeading title="Order detail" />

            <div className="mb-3 grid grid-cols-3 gap-1">
              {(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  className={`h-control rounded-control border text-button ${
                    orderType === type
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-surface text-text-secondary'
                  }`}
                >
                  {ORDER_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              {orderType === 'dine_in' && (
                <Select
                  label="Waiter"
                  placeholder="Choose the waiter"
                  options={(waiters.data ?? []).map((waiter: Waiter) => ({
                    value: String(waiter.id),
                    label: waiter.name,
                  }))}
                  value={waiterId}
                  onChange={(event) => setWaiterId(event.target.value)}
                />
              )}

              {orderType === 'delivery' && (
                <>
                  <Select
                    label="Delivery boy"
                    placeholder="Choose the rider"
                    options={(riders.data ?? []).map((boy: DeliveryBoy) => ({
                      value: String(boy.id),
                      label: boy.vehiclePlate ? `${boy.name} · ${boy.vehiclePlate}` : boy.name,
                    }))}
                    value={deliveryBoyId}
                    onChange={(event) => setDeliveryBoyId(event.target.value)}
                  />
                  <Input
                    label="Delivery address"
                    value={customerAddress}
                    onChange={(event) => setCustomerAddress(event.target.value)}
                    placeholder="House, street, area"
                  />
                </>
              )}

              {orderType !== 'dine_in' && (
                <>
                  <Input
                    label="Customer name"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Optional"
                  />
                  <Input
                    label="Phone"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder="Optional, used to find old orders"
                  />
                </>
              )}

              <Select
                label="Status"
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'preparing', label: 'Preparing' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'delivered', label: 'Delivered (paid)' },
                ]}
                value={orderStatus}
                onChange={(event) => setOrderStatus(event.target.value as OrderStatus)}
                hint="Use “Ready” or “Delivered (paid)” to bill a takeaway immediately."
              />
            </div>
          </Card>

          <Card>
            <CardHeading
              title="Current order"
              subtitle={cart.length === 0 ? 'No items yet' : `${cart.length} item(s)`}
              action={
                cart.length > 0 ? (
                  <Button variant="ghost" onClick={clearCart}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                    Clear
                  </Button>
                ) : undefined
              }
            />

            {cart.length === 0 ? (
              <div className="py-8 text-center">
                <ShoppingBag aria-hidden className="mx-auto mb-2 h-8 w-8 text-text-secondary/50" />
                <p className="text-caption text-text-secondary">
                  Tap a menu item to start the order.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {cart.map((line) => (
                  <li key={line.item.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{line.item.name}</p>
                      <p className="text-caption text-text-secondary">
                        {formatAmount(line.item.price)} each
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Remove one ${line.item.name}`}
                        onClick={() => changeQty(line.item.id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-control border border-border hover:bg-background"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-body font-semibold tabular">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        aria-label={`Add one ${line.item.name}`}
                        onClick={() => changeQty(line.item.id, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-control border border-border hover:bg-background"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="w-20 text-right text-body font-medium tabular">
                      {formatAmount(line.item.price * line.qty)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
              <MoneyInput label="Discount" value={discount} onChange={setDiscount} />
              <Input
                label="Tax %"
                type="number"
                min={0}
                max={100}
                value={effectiveTaxPercent}
                onChange={(event) =>
                  setTaxPercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
                }
              />
            </div>

            <Input
              label="Order note"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Extra spicy, no onions…"
              className="mt-3"
            />

            <dl className="mt-4 flex flex-col gap-1 text-body">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Subtotal</dt>
                <dd className="tabular">{formatAmount(subtotal)}</dd>
              </div>
              {safeDiscount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Discount</dt>
                  <dd className="tabular text-status-cancelled">-{formatAmount(safeDiscount)}</dd>
                </div>
              )}
              {tax > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Tax ({effectiveTaxPercent}%)</dt>
                  <dd className="tabular">{formatAmount(tax)}</dd>
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
                <dt className="text-card-title">Grand total</dt>
                <dd className="text-section-title tabular text-primary">
                  {currency} {formatAmount(total)}
                </dd>
              </div>
            </dl>

            {error && (
              <div className="mt-3">
                <Alert tone="error">{error}</Alert>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button size="lg" onClick={() => void save(false)} isLoading={isSaving} fullWidth>
                Save order
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => void save(true)}
                disabled={isSaving}
                fullWidth
              >
                Save and open invoice
              </Button>
            </div>

            <p className="mt-2 text-center text-caption text-text-secondary">
              Date: {todayIso()} · Cashier: you
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
