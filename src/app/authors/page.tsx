import { PersonalSocialLinks } from "@/components/PersonalSocialLinks";
import Image from "next/image";

type Author = {
  name: string;
  tagline: string;
  bio: string;
  photoSrc?: string;
  photoAlt?: string;
};

const authors: Author[] = [
  {
    name: "Dr. Dale-Marie McKie",
    tagline: "Family Physician • Co-Author",
    bio: "Dr. Dale-Marie McKie is a Family Physician who has spent her career caring for children and families. That same compassion shows up in every Twilight Feather story, especially the Children Diseases series, where she turns conditions like sickle cell disease and asthma into stories that comfort and empower young readers. She's a proud wife and mom of three boys, and rarely without a cup of coffee and a dog at her feet.",
  },
  {
    name: "Omari McKie",
    tagline: "Accountant by day • Co-Author always",
    bio: "Omari handles the numbers — budgets, deadlines, and the occasional spreadsheet emergency — as an accountant. But his favorite job comes with no calculator: dreaming up stories with his wife, Dale-Marie. A devoted husband and father of three lively sons (and two equally lively dogs), Omari brings structure, patience, and a steady editing eye to every Twilight Feather book.",
  },
];

function AuthorPhoto({ author }: { author: Author }) {
  if (author.photoSrc) {
    return (
      <div className="mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-2xl border border-brand-brown/20 bg-white shadow-sm">
        <Image
          src={author.photoSrc}
          alt={author.photoAlt ?? `${author.name} headshot`}
          width={220}
          height={220}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/5 text-sm font-medium text-brand-charcoal/45"
    >
      Author Photo
    </div>
  );
}

export default function AuthorsPage() {
  return (
    <main className="px-4 py-16 sm:px-6 sm:py-20">
      <section className="mx-auto max-w-5xl">
        <div className="text-center">
          <Image
            src="/logo.png"
            alt=""
            width={72}
            height={72}
            aria-hidden="true"
            className="mx-auto h-[72px] w-[72px] rounded-full border-2 border-brand-orange/40 object-cover shadow-sm"
          />
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-brand-blue-deep sm:text-5xl">
            About the Authors
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg italic leading-relaxed text-brand-blue-deep/90">
            Twilight Feather Children&apos;s Books is a husband-and-wife passion
            project — written with heart, illustrated with care, and inspired by
            real life.
          </p>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-12">
          {authors.map((author) => (
            <article key={author.name} className="text-center">
              <AuthorPhoto author={author} />
              <h2 className="mt-6 text-2xl font-extrabold text-brand-blue-deep sm:text-[1.65rem]">
                {author.name}
              </h2>
              <p className="mt-2 text-sm font-semibold italic text-brand-brown">
                {author.tagline}
              </p>
              <p className="mt-4 text-left text-sm leading-relaxed text-brand-charcoal/85 sm:text-[0.95rem]">
                {author.bio}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-16 pt-2">
          <h2 className="text-2xl font-extrabold text-brand-blue-deep sm:text-3xl">
            Our Story
          </h2>
          <hr className="mt-4 border-brand-brown/20" />
          <p className="mt-6 text-sm leading-relaxed text-brand-charcoal/85 sm:text-base">
            Twilight Feather Children&apos;s Books was founded by Dr. Dale-Marie
            McKie and Omari McKie to help children understand the world — and
            sometimes their own bodies — a little better. Dale-Marie&apos;s years
            of experience as a Family Physician inspired the Children Diseases
            series, while Omari&apos;s love of language helps shape every
            manuscript into something families want to read again and again.
            Together with their three sons and two dogs, the McKies are always
            chasing the next story worth telling.
          </p>
          <PersonalSocialLinks />
        </div>
      </section>
    </main>
  );
}
