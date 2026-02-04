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
    <path strokeWidth="1.5" d="M12 4.5v15m7.5-7.5h-15" />
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

export const SettingsIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Settings icon" {...props}>
    <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
  </IconBase>
)));

export const EyeIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Eye icon" {...props}>
    <path strokeWidth="1.5" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
    <path strokeWidth="1.5" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </IconBase>
)));

export const EyeSlashIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Eye slash icon" {...props}>
    <path d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
  </IconBase>
)));

export const BulbIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Bulb icon" {...props}>
    <path d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
  </IconBase>
)));

export const CogIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Cog icon" {...props}>
    <path d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
  </IconBase>
)));

export const ClipboardIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Clipboard icon" {...props}>
    <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
  </IconBase>
)));

export const MagnifyingGlassIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Magnifying glass icon" {...props}>
    <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </IconBase>
)));

export const HeartIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Heart icon" {...props}>
    <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
  </IconBase>
)));

export const WalletIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="Wallet icon" {...props}>
    <path d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
  </IconBase>
)));

export const FileTextIcon = memo(forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <IconBase ref={ref} aria-label="File text icon" {...props}>
    <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </IconBase>
)));
