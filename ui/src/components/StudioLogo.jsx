// Brand mark — 1-bit pixel-art cyber-glove with embedded green LCD that
// already carries the "23 STUDIOS" wordmark. Renders at native dims with
// `image-rendering: pixelated` so the LCD stays crisp.
//
// Three asset sizes ship with the app under /icons/:
//   sm  — 64x43   (nav bar)
//   md  — 180x120 (dashboard hero / login)
//   lg  — 600x400 (only when explicitly displayed large)
//
// Props:
//   size?  'sm' | 'md' | 'lg'   default 'sm'
//   className?  extra classes for the <img>
//   alt?  override alt text (default '23 Studios')

const VARIANTS = {
  sm: { src: '/icons/studio-logo-sm.png', w: 64,  h: 46  },
  md: { src: '/icons/studio-logo-md.png', w: 180, h: 128 },
  lg: { src: '/icons/studio-logo.png',    w: 600, h: 428 }
};

export default function StudioLogo({ size = 'sm', className = '', alt = '23 Studios' }) {
  const v = VARIANTS[size] || VARIANTS.sm;
  // Through code-server proxies the app mounts at /proxy/<port>/; root-
  // relative paths ignore <base href>, so we prepend window.__APP_BASE__
  // (set by the boot script in index.html) to anchor onto the proxy mount.
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return (
    <img
      src={base + v.src}
      alt={alt}
      width={v.w}
      height={v.h}
      decoding="async"
      className={`pixelated select-none ${className}`}
      draggable={false}
    />
  );
}
