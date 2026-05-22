/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy ink palette — kept for backward compat. Existing surfaces
        // still rely on bg-ink-900 / ring-ink-800 / etc until they're
        // explicitly ported to the design-token utilities below.
        ink: {
          50: '#f7f7f8',
          100: '#eceef1',
          200: '#d2d5dc',
          300: '#a9aeba',
          400: '#7a8093',
          500: '#525868',
          600: '#3a3f4d',
          700: '#262a35',
          800: '#181b23',
          900: '#0d0f15',
          950: '#08090d'
        },
        // RGB triplet variable so Tailwind's alpha modifier syntax (eg.
        // bg-accent/90, ring-accent/30) still resolves. Themes override
        // --accent-rgb at runtime via setProperty.
        accent: 'rgb(var(--accent-rgb, 157 255 206) / <alpha-value>)',

        // ─── 23 Studios design tokens (from src/styles/tokens.css) ───
        // Surfaces. Use bg-bg, bg-bg-2, bg-surface, etc.
        bg:           'var(--bg)',
        'bg-2':       'var(--bg-2)',
        surface:      'var(--surface)',
        'surface-2':  'var(--surface-2)',
        'surface-3':  'var(--surface-3)',
        // Border tokens are reused as both border-* and ring-* shades.
        border:       'var(--border)',
        'border-2':   'var(--border-2)',
        'border-strong': 'var(--border-strong)',
        // Text shades.
        text: {
          DEFAULT: 'var(--text)',
          soft:    'var(--text-soft)',
          muted:   'var(--text-muted)',
          dim:     'var(--text-dim)',
          faint:   'var(--text-faint)'
        },
        // Accent ramp tied to --accent-* (amber by default, or alt via
        // [data-accent="orange|phosphor|steel"]). bg-accent-tk avoids
        // clashing with the legacy `accent` token above. Token shorthand
        // names mirror styles.css.
        'accent-tk':      'var(--accent)',
        'accent-soft':    'var(--accent-soft)',
        'accent-dim':     'var(--accent-dim)',
        'accent-ink':     'var(--accent-ink)',
        // Status colors.
        phosphor: 'var(--phosphor)',
        crt:      'var(--crt)',
        danger:   'var(--danger)',
        ok:       'var(--ok)'
      },
      fontFamily: {
        // Legacy aliases (sans / mono) kept pointing at the old stack so
        // nothing else breaks; opt into the new look via font-ui / font-mono
        // (override) / font-lcd.
        sans: ['"Google Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', '"JetBrains Mono"', 'SFMono-Regular', 'Menlo', 'monospace'],
        // 23 Studios font utilities — match var(--font-*).
        ui:   ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        lcd:  ['VT323', 'ui-monospace', 'monospace']
      },
      borderRadius: {
        // Token-aware radii without clobbering Tailwind's defaults.
        tk:        'var(--radius)',     // 8px
        'tk-sm':   'var(--radius-sm)',  // 4px
        'tk-lg':   'var(--radius-lg)'   // 14px
      },
      boxShadow: {
        'tk-1': 'var(--shadow-1)',
        'tk-2': 'var(--shadow-2)'
      },
      ringColor: {
        ink: {
          700: '#262a35',
          800: '#181b23'
        }
      },
      ringWidth: {
        DEFAULT: '1px'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        // Amber halo pulse used by gate-blocked asset cards / "ready"
        // download button (lifted from styles.css @keyframes pulse).
        'pulse-accent': {
          '0%,100%': { boxShadow: '0 0 0 0 var(--accent-soft)' },
          '50%':     { boxShadow: '0 0 0 6px transparent' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'pulse-accent': 'pulse-accent 1.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
