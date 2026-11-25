import type { Purchase } from '../../types/api';
import { formatAmount, formatDate } from '../../utils/format';
import { BASE_UNIT_SHORT, formatUnitCost } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { Alert } from '../../components/Alert';

interface PurchaseDetailModalProps {
  purchase: Purchase | null;
  onClose: () => void;
}

/** Read-only view of one purchase: the supplier's slip, as the app recorded it. */
export function PurchaseDetailModal({ purchase, onClose }: PurchaseDetailModalProps) {
  if (!purchase) return null;

  return (
    <Modal
      isOpen
      title={`Purchase ${purchase.purchaseNo}`}
      description={`${formatDate(purchase.purchasedOn)}${purchase.supplierName ? ` · ${purchase.supplierName}` : ''}${purchase.billNo ? ` · bill ${purchase.billNo}` : ''}`}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {purchase.status === 'void' && (
          <Alert tone="error">
            {`This purchase was voided${purchase.voidReason ? `: ${purchase.voidReason}` : ''}. Its stock was taken back out.`}
          </Alert>
        )}

        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-body">
            <thead className="bg-background">
              <tr>
                <th className="border-b border-border px-3 py-2 text-left text-caption font-semibold uppercase text-text-secondary">
                  Ingredient
                </th>
                <th className="border-b border-border px-3 py-2 text-right text-caption font-semibold uppercase text-text-secondary">
                  Qty
                </th>
                <th className="border-b border-border px-3 py-2 text-right text-caption font-semibold uppercase text-text-secondary">
                  Price
                </th>
                <th className="border-b border-border px-3 py-2 text-right text-caption font-semibold uppercase text-text-secondary">
                  Landed cost
                </th>
                <th className="border-b border-border px-3 py-2 text-right text-caption font-semibold uppercase text-text-secondary">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((line) => (
                <tr key={line.id}>
                  <td className="border-b border-border px-3 py-2 text-text-primary">
                    {line.ingredientName}
                    <span className="ml-1 text-caption text-text-secondary">
                      ({line.qtyBase.toLocaleString()} {BASE_UNIT_SHORT[line.baseUnit]})
                    </span>
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right tabular">
                    {(line.qtyPurchaseMilli / 1000).toLocaleString()}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right tabular">
                    {formatAmount(line.unitPrice)}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right tabular text-caption text-text-secondary">
                    {formatUnitCost(line.landedCostMilli, line.baseUnit)}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right tabular">
                    {formatAmount(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto flex w-full max-w-xs flex-col gap-1 text-body">
          <Row label="Subtotal" value={formatAmount(purchase.subtotal)} />
          <Row label="Extra charges" value={formatAmount(purchase.extraCharges)} />
          <div className="flex justify-between border-t border-border pt-1 font-semibold text-text-primary">
            <span>Total</span>
            <span className="tabular">{formatAmount(purchase.total)}</span>
          </div>
          <Row label="Paid now" value={formatAmount(purchase.paidAmount)} />
          {purchase.total - purchase.paidAmount > 0 && (
            <Row
              label="On credit"
              value={formatAmount(purchase.total - purchase.paidAmount)}
              warning
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
          <Badge tone={purchase.status === 'void' ? 'danger' : 'success'}>
            {purchase.status === 'void' ? 'Void' : 'Posted'}
          </Badge>
          <span>Entered by {purchase.createdByName}</span>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`flex justify-between ${warning ? 'text-[#8a5b00]' : 'text-text-secondary'}`}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
