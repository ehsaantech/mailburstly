import { cn } from "@/lib/cn";
import { BrandLockup } from "@/components/layout/BrandLockup";

/**
 * The brand lockup for the header.
 *
 * The whole lockup — the mark, "mail" and "burstly" — comes from the logo
 * artwork, traced to vector paths, so the header shows the same lettering
 * that ships in the image rather than a re-typeset approximation. "mail"
 * takes the foreground colour and "burstly" the brand green, so the lockup
 * stays readable in both themes.
 */
export function Brand({
  className,
  classNameText,
  size = "h-5",
  subtitle,
}: {
  className?: string;
  classNameText?: string;
  size?: string;
  subtitle?: string;
}) {
  return (
    <span className={cn("flex flex-col gap-0.5", className)}>
      <BrandLockup className={cn("w-auto text-fg", size, classNameText)} />
      {subtitle ? (
        <span className="text-[10px] leading-none tracking-wide text-fg-subtle">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
