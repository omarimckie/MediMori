import { getSql } from "./db";
import { isPhysicalDirectBookId } from "./physical-books";

export async function getPhysicalQuantityOnHand(bookId: string): Promise<number | null> {
  if (!isPhysicalDirectBookId(bookId)) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT quantity_on_hand
    FROM physical_inventory
    WHERE book_id = ${bookId}
    LIMIT 1
  `;
  if (!rows.length) return 0;
  return Number(rows[0]?.quantity_on_hand ?? 0);
}

export async function hasPhysicalInventory(
  bookId: string,
  quantity: number,
): Promise<boolean> {
  if (!isPhysicalDirectBookId(bookId) || quantity < 1) return false;
  const onHand = await getPhysicalQuantityOnHand(bookId);
  return onHand !== null && onHand >= quantity;
}

/**
 * Result of one decrement attempt when quantity_on_hand is known (tests / documentation).
 * Production concurrency is enforced by `decrementPhysicalInventory` SQL:
 * `UPDATE ... WHERE quantity_on_hand >= quantity`.
 */
export function previewInventoryDecrement(
  quantityOnHand: number,
  quantity: number,
): number | null {
  if (quantity < 1 || !Number.isInteger(quantity)) return null;
  if (quantityOnHand < quantity) return null;
  return quantityOnHand - quantity;
}

/**
 * Authoritative inventory decrement. Returns remaining quantity or null if insufficient.
 */
export async function decrementPhysicalInventory(
  bookId: string,
  quantity: number,
): Promise<number | null> {
  if (!isPhysicalDirectBookId(bookId) || quantity < 1) return null;
  const sql = getSql();
  const rows = await sql`
    UPDATE physical_inventory
    SET
      quantity_on_hand = quantity_on_hand - ${quantity},
      updated_at = NOW()
    WHERE book_id = ${bookId}
      AND quantity_on_hand >= ${quantity}
    RETURNING quantity_on_hand
  `;
  if (!rows.length) return null;
  return Number(rows[0]?.quantity_on_hand ?? 0);
}
