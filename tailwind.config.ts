import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        discord: {
          blurple: '#7A1027',
          green: '#23A559',
          yellow: '#F0B232',
          red: '#F23F43',
          gray: '#80848E',
        },
        neon: {
          blue: '#C2183C',
          pink: '#8E1330',
          purple: '#5A1023',
          green: '#39ff14',
        }
      },
      boxShadow: {
        'neon-blue': '0 0 5px #C2183C, 0 0 20px #C2183C',
        'neon-pink': '0 0 5px #8E1330, 0 0 20px #8E1330',
        'neon-purple': '0 0 5px #5A1023, 0 0 20px #5A1023',
      },
      backgroundImage: {
        'neon-gradient': 'linear-gradient(45deg, #C2183C, #5A1023, #8E1330)',
      }
    },
  },
  plugins: [],
}
export default config
