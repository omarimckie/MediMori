import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tone?: "white" | "cream";
};

/** Shared Twilight Feather card surface for later section phases. */
export function TfCard({
  children,
  tone = "white",
  className = "",
  ...rest
}: Props) {
  const toneClass = tone === "cream" ? "tf-card-cream" : "";
  return (
    <div className={["tf-card", toneClass, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
