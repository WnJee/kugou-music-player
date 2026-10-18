/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  /**
   * 这些类名由 TSX 里以模板字符串拼接（如 `lyric-line--${variant}`），
   * Tailwind 的静态扫描看不到，会把 @layer components 里的对应规则整段剔除。
   * 这里显式登记，避免样式"源码里有、产物里没有"。
   */
  safelist: [
    'lyric-line--left',
    'lyric-line--center',
    'lyric-scroller--left',
    'lyric-scroller--center',
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090b',
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
      }
    },
  },
  plugins: [],
}
