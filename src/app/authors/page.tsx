export default function AuthorsPage() {
  return (
    <main className="px-4 py-16 sm:px-6 sm:py-20">
      <section className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-brand-charcoal sm:text-5xl">
            About Our Authors
          </h1>
          <p className="mt-4 text-brand-charcoal/75">
            Meet the creators behind Twilight.Feather&apos;s wellness-focused stories.
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <article className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10">
            <h2 className="text-2xl font-extrabold text-brand-blue-deep">
              Omari McKie
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/85">
              Omari creates engaging educational content that makes health topics
              approachable for children and families. His work blends clear
              language, playful design, and practical guidance to support early
              learning and healthy habits.
            </p>
          </article>

          <article className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10">
            <h2 className="text-2xl font-extrabold text-brand-green-deep">
              Dale-marie McKie
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/85">
              Dale-marie focuses on nurturing, child-centered storytelling that
              supports emotional wellness and resilience. Her contributions help
              families start meaningful conversations about care, confidence, and
              lifelong wellbeing.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
