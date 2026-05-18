/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
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
        // CSS variable so themes can override at runtime via
        // document.documentElement.style.setProperty('--accent', '#xxx')
        accent: 'var(--accent, #9dffce)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
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
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out'
      }
    }
  },
  plugins: []
};
