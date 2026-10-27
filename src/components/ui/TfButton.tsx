import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "accent" | "ghost";

const variantClass: Record<Variant, string> = {
  primary: "tf-btn-primary",
  secondary: "tf-btn-secondary",
  accent: "tf-btn-accent",
  ghost: "tf-btn-ghost",
};

type CommonProps = {
  children: ReactNode;
  variant?: Variant;
  className?: string;
};

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
  target?: string;
  rel?: string;
};

export type TfButtonProps = ButtonAsButton | ButtonAsLink;

function classes(variant: Variant, className?: string) {
  return ["tf-btn", variantClass[variant], className].filter(Boolean).join(" ");
}

/** Shared Twilight Feather button. Prefer this over ad-hoc button styles going forward. */
export function TfButton(props: TfButtonProps) {
  const variant = props.variant ?? "primary";

  if ("href" in props && props.href) {
    const { href, children, className, target, rel } = props;
    return (
      <Link
        href={href}
        target={target}
        rel={rel}
        className={classes(variant, className)}
      >
        {children}
      </Link>
    );
  }

  const {
    children,
    className,
    type = "button",
    ...buttonProps
  } = props as ButtonAsButton;

  return (
    <button
      type={type}
      className={classes(variant, className)}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
