import { AuthorProfiles } from "@/components/AuthorProfiles";
import { PageSection } from "@/components/PageSection";
import { authors } from "@/data/authors";

type Props = {
  searchParams: Promise<{ author?: string }>;
};

export default async function AuthorsPage({ searchParams }: Props) {
  const { author } = await searchParams;

  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          About the Authors
        </h1>
        <p className="mx-auto mt-4 max-w-3xl text-lg italic leading-relaxed text-white/85">
          Twilight Feather Children&apos;s Books is a husband-and-wife passion
          project — written with heart, illustrated with care, and inspired by
          real life.
        </p>
      </PageSection>

      <PageSection tone="white">
        <AuthorProfiles authors={authors} initialAuthorId={author} />
      </PageSection>

      <PageSection tone="navy">
        <h2 className="text-2xl font-extrabold text-white sm:text-3xl">Our Story</h2>
        <hr className="mt-4 border-white/20" />
        <p className="mt-6 text-sm leading-relaxed text-white/85 sm:text-base">
          Twilight Feather Children&apos;s Books was founded by Dr. Dale-Marie
          McKie and Omari McKie to help children understand the world — and
          sometimes their own bodies — a little better. Dale-Marie&apos;s years
          of experience as a Family Physician inspired the Children Diseases
          series, while Omari&apos;s love of language helps shape every
          manuscript into something families want to read again and again.
          Together with their three sons and two dogs, the McKies are always
          chasing the next story worth telling.
        </p>
      </PageSection>
    </main>
  );
}
