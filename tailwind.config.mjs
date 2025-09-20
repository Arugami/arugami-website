/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    './src/pages/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    './src/components/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    './src/layouts/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
  ],
  theme: {
    extend: {
      colors: {
        arugami: {
          pink: '#ff3399',
          green: '#5fe385',
          yellow: '#e2ff3f',
          dark: '#363636',
        },
        'soft-gray': '#f5f5f5',
        'charcoal': '#1f1f1f',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        marquee: 'marquee 20s linear infinite',
        'bounce-slow': 'bounce 3s infinite',
        'pulse-slow': 'pulse 4s infinite',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
      boxShadow: {
        card: '0 20px 40px rgba(54,54,54,0.08)',
      },
    },
  },
  plugins: [],
};
