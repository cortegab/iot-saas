import Image from "next/image";
import { cn } from "@/lib/cn";

/** The IO Driven mark (docs/design/io-driven-mark.png): the product's logo
 * beside its name on public pages. Decorative: the name next to it is the label. */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return <Image src="/brand/io-driven-mark.png" alt="" aria-hidden width={size} height={size} className={cn("shrink-0", className)} priority />;
}
