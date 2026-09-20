"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Card, StatusPill } from "./ui";

type Asset = {
  id: string;
  name: string;
  type: string;
  source: string;
  bookId: string | null;
  characterId: string | null;
  approved: boolean;
  url: string | null;
  usageRestrictions: string | null;
  tags: string[];
};

export function AssetsClient() {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    void fetch("/api/admin/marketing/assets")
      .then((res) => res.json())
      .then((data) => setAssets(data.assets ?? []));
  }, []);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset) => (
        <Card key={asset.id}>
          {asset.url ? (
            <div className="relative mb-3 aspect-square overflow-hidden rounded-2xl bg-cream-deep">
              <Image src={asset.url} alt={asset.name} fill className="object-contain" />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <StatusPill status={asset.approved ? "approved" : "needs_review"} />
            <StatusPill status={asset.type} />
            <StatusPill status={asset.source} />
          </div>
          <h3 className="mt-2 font-extrabold">{asset.name}</h3>
          <p className="mt-1 text-xs text-brand-charcoal/60">
            {asset.bookId ?? "no book"} {asset.characterId ? `· ${asset.characterId}` : ""}
          </p>
          {asset.usageRestrictions ? (
            <p className="mt-2 text-xs">{asset.usageRestrictions}</p>
          ) : null}
        </Card>
      ))}
      {!assets.length ? (
        <p>No assets yet. Generate a week or load demo seed to import catalog covers and character art.</p>
      ) : null}
    </div>
  );
}
