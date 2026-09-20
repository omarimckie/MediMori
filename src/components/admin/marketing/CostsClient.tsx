"use client";

import { useEffect, useState } from "react";
import { Card, StatusPill } from "./ui";

type Ops = {
  estimatedCostUsd: number;
  operations: Array<{
    id: string;
    operation: string;
    provider: string;
    modelOrService: string | null;
    estimatedCostUsd: number;
    success: boolean;
    durationMs: number | null;
    createdAt: string;
  }>;
};

export function CostsClient() {
  const [data, setData] = useState<Ops | null>(null);

  useEffect(() => {
    void fetch("/api/admin/marketing/operations")
      .then((res) => res.json())
      .then(setData);
  }, []);

  if (!data) return <p>Loading cost log…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-bold uppercase text-brand-green-deep">Estimated operations cost</p>
        <p className="mt-2 font-display text-4xl text-brand-navy">${data.estimatedCostUsd.toFixed(4)}</p>
        <p className="mt-2 text-sm text-brand-charcoal/70">
          Mock mode records $0. Live estimates are internal only — not a billing system.
        </p>
      </Card>
      {data.operations.map((item) => (
        <Card key={item.id}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.success ? "published" : "failed"} />
            <span className="font-bold">{item.operation}</span>
          </div>
          <p className="mt-2 text-sm">
            {item.provider}
            {item.modelOrService ? ` · ${item.modelOrService}` : ""} · ${item.estimatedCostUsd.toFixed(4)}
            {item.durationMs != null ? ` · ${item.durationMs}ms` : ""}
          </p>
          <p className="text-xs text-brand-charcoal/55">{new Date(item.createdAt).toLocaleString()}</p>
        </Card>
      ))}
    </div>
  );
}
