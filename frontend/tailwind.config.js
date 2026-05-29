/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f6f2ea',  //  밝은 배경
          100: '#fbf5d6',
          200: '#fdeaa3',
          300: '#fce070',
          400: '#fcd53d',
          500: '#fbd12d', //  메인 버튼
          600: '#d5aa1e',
          700: '#aa7e18',
          800: '#8b5924', 
          900: '#6c3531', // 브라운 (가장 어두운 텍스트/포인트 )
        },
        black: '#000000',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
