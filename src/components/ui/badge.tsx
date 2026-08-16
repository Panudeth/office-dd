import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-box border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-ink-500 bg-ink-700 text-dim',
        brass: 'border-wood-dark bg-wood-deep text-brass-lite',
        good: 'border-carpet-dark bg-[#22401f] text-carpet-lite',
        bad: 'border-rug-dark bg-[#3f2018] text-rug-lite',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
