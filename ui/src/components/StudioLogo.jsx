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
  sm: { src: '/icons/studio-logo-sm.png', w: 64, h: 43 },
  md: { src: '/icons/studio-logo-md.png', w: 180, h: 120 },
  lg: { src: '/icons/studio-logo.png',    w: 600, h: 400 }
};

export default function StudioLogo({ size = 'sm', className = '', alt = '23 Studios' }) {
  const v = VARIANTS[size] || VARIANTS.sm;
  // Note: APP_BASE prefix not needed — these assets live under public/icons
  // and are served from the same origin / base path as the SPA itself.
  return (
    <img
      src={v.src}
      alt={alt}
      width={v.w}
      height={v.h}
      decoding="async"
      className={`pixelated select-none ${className}`}
      draggable={false}
    />
  );
}
