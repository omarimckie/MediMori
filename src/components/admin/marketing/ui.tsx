export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    needs_review: "bg-brand-gold/30 text-brand-navy",
    approved: "bg-brand-sage/20 text-brand-navy",
    scheduled: "bg-brand-sky/30 text-brand-navy",
    published: "bg-brand-green-deep text-white",
    rejected: "bg-brand-orange/30 text-brand-navy",
    failed: "bg-brand-orange-deep text-white",
    draft: "bg-cream-deep text-brand-charcoal",
    active: "bg-brand-green-deep text-white",
    planned: "bg-brand-lavender/40 text-brand-navy",
    completed: "bg-brand-navy text-white",
    open: "bg-brand-gold/30 text-brand-navy",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
        tone[status] ?? "bg-cream-deep text-brand-charcoal"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border border-brand-brown/15 bg-white p-5 shadow-tf-card ${className}`}>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white disabled:opacity-50 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal disabled:opacity-50 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
