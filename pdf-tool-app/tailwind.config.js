/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        layah: {
          brand: '#2400c6',
          primary: '#416fe3',
          secondary: '#2a54dd',
          surface: '#f4f6fd',
          workspace: '#f8f9fa',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'sans-serif'],
        display: ['var(--font-instrument)', 'serif'],
      },
    },
  },
  plugins: [],
}
