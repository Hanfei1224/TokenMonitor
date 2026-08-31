export default {
  content: [
    "./index.html",
    "./renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: 'rgba(245, 245, 247, 0.72)',
          darkBg: 'rgba(28, 28, 30, 0.75)',
          blue: '#0071E3',
          lightBlue: '#34AADC',
          card: 'rgba(255, 255, 255, 0.65)',
          darkCard: 'rgba(44, 44, 46, 0.65)',
          border: 'rgba(255, 255, 255, 0.25)',
          darkBorder: 'rgba(255, 255, 255, 0.1)'
        }
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'SF Pro Text'",
          "'SF Pro Display'",
          "'Segoe UI'",
          "Roboto",
          "'PingFang SC'",
          "'Hiragino Sans GB'",
          "'Microsoft YaHei'",
          "sans-serif"
        ]
      },
      backdropBlur: {
        'xs': '2px',
        '2xl': '32px',
        '3xl': '48px',
      }
    },
  },
  plugins: [],
}
