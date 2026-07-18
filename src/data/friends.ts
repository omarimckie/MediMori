export type Friend = {
  id: "amara" | "aj";
  name: string;
  tagline: string;
  introduction: string;
  personality: string;
  imagePosition: string;
  accent: "purple" | "blue";
};

export const friends: Friend[] = [
  {
    id: "amara",
    name: "Amara",
    tagline: "Curious, kind, and always ready to learn!",
    introduction:
      "Amara loves discovering how things work, asking thoughtful questions, and sharing what she learns with the people around her.",
    personality:
      "Whether she is opening a new book or helping a friend, Amara brings curiosity, patience, and a big heart to every adventure.",
    imagePosition: "82% center",
    accent: "purple",
  },
  {
    id: "aj",
    name: "AJ",
    tagline: "Loves adventures, sports, and helping others.",
    introduction:
      "AJ is energetic, imaginative, and always ready to turn an ordinary day into a new adventure.",
    personality:
      "He believes being brave also means being kind. AJ enjoys solving problems, cheering on his friends, and finding fun ways to lend a hand.",
    imagePosition: "18% center",
    accent: "blue",
  },
];

export function getFriend(id: string): Friend | undefined {
  return friends.find((friend) => friend.id === id);
}
