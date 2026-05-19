// Brand mark — high-detail render of the cyberglove + 23 STUDIOS LCD
// wordmark. NOT pixel art, so render with default smoothing (the prior
// `pixelated` className mangled it). Files under /icons/ are stored at
// roughly 2x display size and the browser downscales smoothly.
//
//   sm  — displayed ~80px tall (file 256x183)
//   md  — displayed ~180px tall (file 720x514)
//   lg  — displayed ~600px tall (file 1650x1178)
//
// Props:
//   size?  'sm' | 'md' | 'lg'   default 'sm'
//   className?  extra classes for the <img>
//   alt?  override alt text (default '23 Studios')

const VARIANTS = {
  sm: { src: '/icons/studio-logo-sm.png', dispH: 28 },
  md: { src: '/icons/studio-logo-md.png', dispH: 120 },
  lg: { src: '/icons/studio-logo.png',    dispH: 360 }
};

export default function StudioLogo({ size = 'sm', className = '', alt = '23 Studios' }) {
  const v = VARIANTS[size] || VARIANTS.sm;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return (
    <img
      src={base + v.src}
      alt={alt}
      style={{ height: v.dispH, width: 'auto', imageRendering: 'auto' }}
      decoding="async"
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
