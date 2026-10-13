import type { ComponentPropsWithRef } from 'react';

import { cn } from '@/lib/utils';

/** Native controls for custom layouts and file/checkbox inputs.
 * Keep native events and refs, so browser behavior stays intact. */
export function ActionButton({
  type = 'button',
  className,
  ...props
}: ComponentPropsWithRef<'button'>) {
  return (
    <button
      type={type}
      data-slot="action-button"
      className={cn('ui-action', className)}
      {...props}
    />
  );
}

export function NativeInput({
  className,
  ...props
}: ComponentPropsWithRef<'input'>) {
  return (
    <input
      data-slot="native-input"
      className={cn('ui-native-input', className)}
      {...props}
    />
  );
}

export function RangeInput({
  className,
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return (
    <NativeInput
      {...props}
      type="range"
      className={cn('ui-range', className)}
    />
  );
}
