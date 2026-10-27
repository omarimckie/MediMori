import type { PreferenceSignal } from "./types";

export function inferPreferenceSignals(
  original: string,
  edited: string,
): PreferenceSignal[] {
  const signals: PreferenceSignal[] = [];
  if (original === edited) return signals;

  const originalStart = original.trim().slice(0, 48).toLowerCase();
  const editedStart = edited.trim().slice(0, 48).toLowerCase();

  if (/^help your child|^teach your child|^explain to your child/.test(originalStart)) {
    if (!/^help your child|^teach your child/.test(editedStart)) {
      signals.push({
        category: "voice",
        statement: "prefers conversational hooks over generic instructional openings",
        strength: "signal",
      });
    }
  }

  const warmer = ["doesn't have to feel scary", "gentle", "together", "warm", "kind"];
  if (warmer.some((word) => edited.toLowerCase().includes(word) && !original.toLowerCase().includes(word))) {
    signals.push({
      category: "tone",
      statement: "prefers warmer language",
      strength: "signal",
    });
  }

  if (edited.length + 40 < original.length) {
    signals.push({
      category: "messaging",
      statement: "prefers shorter copy",
      strength: "signal",
    });
  }

  if (edited.length > original.length + 80) {
    signals.push({
      category: "messaging",
      statement: "prefers more context in body copy",
      strength: "signal",
    });
  }

  return signals;
}
