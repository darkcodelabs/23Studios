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
          900: '#0d0f15'
        },
        accent: '#9dffce'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
