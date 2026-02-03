import { forwardRef, memo, ReactNode, SVGProps } from 'react';

/**
 * Icons base
 */

type IconBaseProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  viewBox?: string;
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  size?: number | string;
};

const defaultAttrs = {
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeWidth: 0 as number,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconBase = forwardRef<SVGSVGElement, IconBaseProps>(
  ({
    viewBox = '0 0 24 24',
    width = "1lh",
    height = "1lh",
    size,
    children,
    ...props
  }, ref) => (
    <svg
      ref={ref}
      viewBox={viewBox}
      width={size ?? width}
      height={size ?? height}
      role={props['aria-label'] ? 'img' : 'presentation'}
      aria-hidden={props['aria-label'] ? 'false' : 'true'}
      {...defaultAttrs}
      {...props}
    >
      {children}
    </svg>
  )
);

/**
 * Icons
 */

export const UserIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Users icon" {...props}>
    <path d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" />
  </IconBase>
)));

export const UsersIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Users icon" {...props}>
    <path d="M8.25 6.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM15.75 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM2.25 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM6.31 15.117A6.745 6.745 0 0 1 12 12a6.745 6.745 0 0 1 6.709 7.498.75.75 0 0 1-.372.568A12.696 12.696 0 0 1 12 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 0 1-.372-.568 6.787 6.787 0 0 1 1.019-4.38Z" />
    <path d="M5.082 14.254a8.287 8.287 0 0 0-1.308 5.135 9.687 9.687 0 0 1-1.764-.44l-.115-.04a.563.563 0 0 1-.373-.487l-.01-.121a3.75 3.75 0 0 1 3.57-4.047ZM20.226 19.389a8.287 8.287 0 0 0-1.308-5.135 3.75 3.75 0 0 1 3.57 4.047l-.01.121a.563.563 0 0 1-.373.486l-.115.04c-.567.2-1.156.349-1.764.441Z" />
  </IconBase>
)));

export const ArrowLeftRightIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Arrow left and right icon" {...props}>
    <path d="M15.97 2.47a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06l3.22-3.22H7.5a.75.75 0 0 1 0-1.5h11.69l-3.22-3.22a.75.75 0 0 1 0-1.06Zm-7.94 9a.75.75 0 0 1 0 1.06l-3.22 3.22H16.5a.75.75 0 0 1 0 1.5H4.81l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 0Z" />
  </IconBase>
)));

export const CheckIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Check icon" {...props}>
    <path d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" />
  </IconBase>
)));

export const PlusIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Plus icon" {...props}>
    <path d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" />
  </IconBase>
)));

export const ShoppingBagIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Shopping bag icon" {...props}>
    <path d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
  </IconBase>
)));

export const LockOpenIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Lock open icon" {...props}>
    <path d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </IconBase>
)));

export const LockClosedIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Lock closed icon" {...props}>
    <path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </IconBase>
)));

export const NoIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="No icon" {...props}>
    <path d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
  </IconBase>
)));
