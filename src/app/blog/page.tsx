import Link from "next/link";

const posts = [
  {
    title: "Helping Kids Understand Health Through Stories",
    excerpt:
      "Simple language and gentle storytelling can make medical topics less scary and more approachable for children.",
    date: "April 2026",
    category: "Wellness",
  },
  {
    title: "5 Ways Families Can Build a Reading Routine",
    excerpt:
      "Small daily reading habits create stronger confidence, vocabulary growth, and emotional connection at home.",
    date: "April 2026",
    category: "Parent Tips",
  },
  {
    title: "Inside Twilight.Feather: Why We Create These Books",
    excerpt:
      "A look at our mission to empower little minds with books rooted in compassion, wellness, and curiosity.",
    date: "April 2026",
    category: "Behind the Scenes",
  },
];

export default function BlogPage() {
  return (
    <main className="px-4 py-16 sm:px-6 sm:py-20">
      <section className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-sm font-extrabold uppercase tracking-wide text-brand-orange-deep">
            Twilight.Feather Blog
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-brand-charcoal sm:text-5xl">
            Stories, tips, and wellness insights
          </h1>
          <p className="mt-4 text-brand-charcoal/75">
            This section is ready for your upcoming posts. Replace these starter
            cards with your real blog content anytime.
          </p>
        </div>

        <div className="mt-12 grid gap-7 md:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.title}
              className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                {post.category}
              </p>
              <h2 className="mt-2 text-xl font-extrabold text-brand-charcoal">
                {post.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/80">
                {post.excerpt}
              </p>
              <p className="mt-4 text-xs font-semibold text-brand-charcoal/60">
                {post.date}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/#books"
            className="inline-flex rounded-2xl bg-brand-blue px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-blue-deep"
          >
            Explore our books
          </Link>
        </div>
      </section>
    </main>
  );
}
