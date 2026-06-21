/** @type {import('tailwindcss').Config} */
// Direction C — "Premium", now DARK: quiet luxury on a deep near-black base.
// The Geist-style semantic ramp is re-themed for dark (gray-1000 = brightest ink,
// bg-100 = lifted surface, gray-a = white-alpha hairlines), so every component
// flips coherently with no markup changes. Type stays Space Grotesk (display) +
// Inter (body); a single muted-indigo `accent` carries focus + quiet highlights;
// definition comes from white hairlines + surface tints over heavier shadow.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#f5f6fa',
        secondary: '#c9cbd6',
        tertiary: '#7d7df2',
        neutral: '#191a21',
        // base surfaces: page (200, deepest) vs frame/cards (100, lifted)
        'bg-100': '#15161d',
        'bg-200': '#0a0b10',
        // muted indigo — brightened for dark; used sparingly (focus, marks, highlights)
        accent: {
          100: '#181a2e',
          200: '#23264a',
          400: '#4a4cc0',
          500: '#7d7df2',
          600: '#9494f6',
          700: '#b4b4f9',
        },
        // inverted neutral ramp: 1000 = brightest ink (text + high-contrast fills),
        // descending to dark subtle fills (100).
        gray: {
          100: '#191a21',
          200: '#21222b',
          300: '#2b2d36',
          400: '#393b46',
          500: '#50525d',
          600: '#6b6d79',
          700: '#8b8d99',
          800: '#abadb9',
          900: '#c9cbd6',
          1000: '#f5f6fa',
        },
        // white-alpha hairlines / hovers / overlays (replaces the light theme's black alphas)
        'gray-a': {
          100: '#ffffff0a',
          200: '#ffffff12',
          300: '#ffffff1f',
          400: '#ffffff14',
          500: '#ffffff2b',
          600: '#ffffff3d',
          700: '#ffffff59',
          800: '#ffffff80',
          900: '#ffffffb5',
          1000: '#ffffffeb',
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
        red: {
          100: '#fff0f0',
          400: '#ffc1c1',
          700: '#fc0035',
          900: '#c40034',
          1000: '#5b0014',
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
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        head: ['Space Grotesk', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '20px',
        xl: '28px',
        full: '9999px',
      },
      boxShadow: {
        // deeper, blacker shadows so elevation reads on a dark base
        raised: '0 1px 2px rgba(0, 0, 0, 0.4)',
        popover:
          '0 1px 1px rgba(0,0,0,0.5), 0 8px 16px -6px rgba(0,0,0,0.55), 0 22px 36px -14px rgba(0,0,0,0.65)',
        modal:
          '0 1px 1px rgba(0,0,0,0.5), 0 14px 28px -10px rgba(0,0,0,0.6), 0 40px 64px -20px rgba(0,0,0,0.75)',
      },
      transitionTimingFunction: {
        // smoother, premium ease (no bounce) for all `ease-geist` transitions
        geist: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}
