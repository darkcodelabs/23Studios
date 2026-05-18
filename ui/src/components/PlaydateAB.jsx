// Two round black buttons labeled A (upper-right) and B (lower-left of A).
// onPress('a'|'b') / onRelease('a'|'b').

export default function PlaydateAB({ onPress, onRelease }) {
  function bind(which) {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onPress?.(which);
      },
      onPointerUp: (e) => {
        e.preventDefault();
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
        onRelease?.(which);
      },
      onPointerCancel: () => onRelease?.(which),
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  const buttonBase = {
    width: 54,
    height: 54,
    borderRadius: '50%',
    background:
      'radial-gradient(circle at 35% 30%, #3a3a3a 0%, #181818 55%, #050505 100%)',
    color: '#fff',
    border: '1px solid #000',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.55)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: '0.05em',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
    transition: 'transform 60ms ease-out',
  };

  return (
    <div className="relative select-none" style={{ width: 130, height: 110 }}>
      {/* B sits lower-left */}
      <button
        type="button"
        aria-label="B button"
        style={{ ...buttonBase, position: 'absolute', left: 0, top: 50 }}
        {...bind('b')}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(1px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = '')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
      >
        B
      </button>
      {/* A sits upper-right */}
      <button
        type="button"
        aria-label="A button"
        style={{ ...buttonBase, position: 'absolute', left: 64, top: 6 }}
        {...bind('a')}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(1px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = '')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
      >
        A
      </button>
    </div>
  );
}
