export type Author = {
  name: string;
  tagline: string;
  bio: string;
  photoSrc?: string;
  photoAlt?: string;
};

export const authors: Author[] = [
  {
    name: "Dr. Dale-Marie McKie",
    tagline: "Family Physician • Co-Author",
    bio: "Dr. Dale-Marie McKie is a Family Physician who has spent her career caring for children and families. That same compassion shows up in every Twilight Feather story, especially the Children Diseases series, where she turns conditions like sickle cell disease and asthma into stories that comfort and empower young readers. She's a proud wife and mom of three boys, and rarely without a cup of coffee and a dog at her feet.",
  },
  {
    name: "Omari McKie",
    tagline: "Accountant by day • Co-Author always",
    bio: "Omari handles the numbers — budgets, deadlines, and the occasional spreadsheet emergency — as an accountant. But his favorite job comes with no calculator: dreaming up stories with his wife, Dale-Marie. A devoted husband and father of three lively sons (and two equally lively dogs), Omari brings structure, patience, and a steady editing eye to every Twilight Feather book.",
    photoSrc: "/authors/omari.png",
    photoAlt: "Omari McKie headshot",
  },
];
