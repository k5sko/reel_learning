/** @type {import('tailwindcss').Config} */
// Geist (Vercel) Light theme tokens — see design.md
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#171717',
        secondary: '#4d4d4d',
        tertiary: '#006bff',
        neutral: '#f2f2f2',
        'bg-100': '#ffffff',
        'bg-200': '#fafafa',
        gray: {
          100: '#f2f2f2',
          200: '#ebebeb',
          300: '#e6e6e6',
          400: '#eaeaea',
          500: '#c9c9c9',
          600: '#a8a8a8',
          700: '#8f8f8f',
          800: '#7d7d7d',
          900: '#4d4d4d',
          1000: '#171717',
        },
        'gray-a': {
          100: '#0000000d',
          200: '#00000015',
          300: '#0000001a',
          400: '#00000014',
          500: '#00000036',
          600: '#0000003d',
          700: '#00000070',
          800: '#00000082',
          900: '#000000b3',
          1000: '#000000e8',
        },
        blue: {
          100: '#f0f7ff',
          200: '#e9f4ff',
          300: '#dfefff',
          400: '#cae7ff',
          500: '#94ccff',
          600: '#48aeff',
          700: '#006bff',
          800: '#0059ec',
          900: '#005ff2',
          1000: '#002359',
        },
        green: {
          100: '#ecfdec',
          400: '#b9f5bc',
          700: '#28a948',
          900: '#107d32',
          1000: '#003a00',
        },
        amber: {
          100: '#fff6de',
          400: '#ffdc73',
          700: '#ffae00',
          900: '#aa4d00',
        },
        purple: {
          100: '#faf0ff',
          400: '#f2d9ff',
          700: '#a000f8',
          900: '#7d00cc',
        },
        pink: {
          100: '#ffe8f6',
          400: '#ffd3e1',
          700: '#f22782',
          900: '#c41562',
        },
        teal: {
          100: '#defffb',
          400: '#b1f7ec',
          700: '#00ac96',
          900: '#007f70',
        },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '12px',
        lg: '16px',
        full: '9999px',
      },
      boxShadow: {
        raised: '0 2px 2px rgba(0, 0, 0, 0.04)',
        popover:
          '0 1px 1px rgba(0,0,0,0.02), 0 4px 8px -4px rgba(0,0,0,0.04), 0 16px 24px -8px rgba(0,0,0,0.06)',
        modal:
          '0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06)',
      },
      transitionTimingFunction: {
        geist: 'cubic-bezier(0.175, 0.885, 0.32, 1.1)',
      },
    },
  },
  plugins: [],
}
