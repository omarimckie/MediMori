"use client";

import { useEffect, useState } from "react";
import { Card, StatusPill } from "./ui";

type Brain = {
  brain: {
    brand: { displayName: string; tagline: string; voice: string[]; missionHeadline: string };
    books: Array<{ id: string; title: string; tagline: string | null; priceEbook: string | null }>;
    characters: Array<{ id: string; name: string; tagline: string }>;
    audiences: Array<{ id: string; name: string; priority: string; description: string }>;
    approvedClaims: Array<{ id: string; body: string }>;
    restrictedClaims: string[];
    promotionalRules: string[];
  };
  preferences: Array<{
    id: string;
    category: string;
    statement: string;
    source: string;
    ownerConfirmed: boolean;
    strength: string;
  }>;
  templates: Array<{ id: string; name: string; category: string }>;
};

export function BrainClient() {
  const [data, setData] = useState<Brain | null>(null);

  useEffect(() => {
    void fetch("/api/admin/marketing/brain")
      .then((res) => res.json())
      .then(setData);
  }, []);

  if (!data) return <p>Loading marketing brain…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-bold uppercase text-brand-green-deep">{data.brain.brand.displayName}</p>
        <h2 className="font-display text-3xl text-brand-navy">{data.brain.brand.tagline}</h2>
        <p className="mt-2">{data.brain.brand.missionHeadline}</p>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {data.brain.brand.voice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Books / products</h3>
        <ul className="mt-3 space-y-2">
          {data.brain.books.map((book) => (
            <li key={book.id}>
              <p className="font-bold">{book.title}</p>
              <p className="text-sm text-brand-charcoal/70">
                {book.tagline} {book.priceEbook ? `· eBook ${book.priceEbook}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Audiences</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {data.brain.audiences.map((audience) => (
            <li key={audience.id}>
              <strong>{audience.name}</strong> ({audience.priority}) — {audience.description}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Characters</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {data.brain.characters.map((character) => (
            <li key={character.id}>
              <strong>{character.name}</strong> — {character.tagline}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Approved claims</h3>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {data.brain.approvedClaims.map((claim) => (
            <li key={claim.id}>{claim.body}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Restricted claims</h3>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {data.brain.restrictedClaims.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Owner preferences</h3>
        <ul className="mt-3 space-y-2">
          {data.preferences.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-2">
              <StatusPill status={item.ownerConfirmed ? "owner confirmed" : item.strength} />
              <span className="text-sm">
                <strong>{item.category}:</strong> {item.statement}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Templates</h3>
        <p className="mt-1 text-sm text-brand-charcoal/70">Data-driven templates, not one component per category.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {data.templates.map((item) => (
            <li key={item.id}>
              {item.name} · {item.category}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
