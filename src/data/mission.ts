export type MissionPrinciple = {
  name: string;
  explanation: string;
  motif: "heart" | "book" | "spark" | "shield" | "globe";
};

export const missionHeading = "Our Mission";

export const missionHeadline =
  "Building a healthier, kinder, more informed tomorrow.";

export const missionIntroduction =
  "We create children's stories and resources that help families understand health, wellness, and growing up with honesty, warmth, and care.";

export const missionVisualSrc = "/feather-accent.png";

export const missionPrinciples: MissionPrinciple[] = [
  {
    name: "Empathy",
    motif: "heart",
    explanation:
      "We make room for children's questions, feelings, and experiences.",
  },
  {
    name: "Education",
    motif: "book",
    explanation:
      "We explain health topics in language families can understand.",
  },
  {
    name: "Empowerment",
    motif: "spark",
    explanation:
      "Our stories help children feel capable, confident, and informed.",
  },
  {
    name: "Trust",
    motif: "shield",
    explanation:
      "We approach difficult topics with care, honesty, and warmth.",
  },
  {
    name: "Inclusion",
    motif: "globe",
    explanation:
      "We create stories that reflect the diverse world children live in.",
  },
];
