export const INVENTORY_DISCREPANCY_ACKNOWLEDGED = "inventory_discrepancy_acknowledged";

export function inventoryDiscrepancyBlocksShipment(input: {
  inventoryState: "pending" | "processing" | "applied" | "failed";
  attentionFlags: readonly string[];
}): boolean {
  return (
    input.inventoryState === "processing" &&
    !input.attentionFlags.includes(INVENTORY_DISCREPANCY_ACKNOWLEDGED)
  );
}

export function withInventoryDiscrepancyAcknowledged(flags: readonly string[]): string[] {
  if (flags.includes(INVENTORY_DISCREPANCY_ACKNOWLEDGED)) return [...flags];
  return [...flags, INVENTORY_DISCREPANCY_ACKNOWLEDGED];
}
