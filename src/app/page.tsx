import { HomeClient, type HomeBlogPost } from "@/components/HomeClient";
import { getPosts } from "@/lib/blog";

export const dynamic = "force-dynamic";

export default async function Home() {
  const posts = await getPosts();

  const latestPosts: HomeBlogPost[] = posts.slice(0, 3).map((post) => ({
    slug: post.slug,
    title: post.title,
    dateLabel:
      post.dateLabel ??
      new Date(post.publishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    imageUrl: post.imageUrl,
  }));

  return <HomeClient latestPosts={latestPosts} />;
}
