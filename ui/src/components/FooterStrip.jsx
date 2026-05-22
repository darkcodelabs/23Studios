// FooterStrip — single thin mono row pinned to viewport bottom on every
// shell-wrapped page. Contains the "BUILT BY HAKCERS" belt + the doc links
// the user used to have stacked in Landing's footer.

export default function FooterStrip() {
  return (
    <div
      className="font-mono uppercase"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        padding: '8px 22px',
        fontSize: 10,
        letterSpacing: '.08em',
        color: 'var(--text-muted)',
        background: 'oklch(13% 0.005 75 / .85)',
        backdropFilter: 'blur(12px) saturate(140%)',
        WebkitBackdropFilter: 'blur(12px) saturate(140%)',
        borderTop: '1px solid var(--border)',
        whiteSpace: 'nowrap',
        overflowX: 'auto'
      }}
    >
      <span style={{ color: 'var(--accent)' }}>BUILT BY HAKCERS FOR HAKCERS</span>
      <span>REV 1.0</span>
      <span>R2S-G23S-GLV-001</span>
      <span>1-BIT TARGET</span>
      <span>SIDELOAD READY</span>
      <span>MARKETPLACE PENDING</span>
      <div className="flex" style={{ marginLeft: 'auto', gap: 18 }}>
        <span>DOCS</span>
        <span>CHANGELOG</span>
        <span>DISCORD</span>
        <span>PRESS KIT</span>
      </div>
    </div>
  );
}
