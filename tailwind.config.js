/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#161a22',
        panel: '#1e2330',
        'panel-hi': '#262c3c',
        border: '#2d3445',
        accent: '#fa9549',
        'accent-hi': '#ffb76a',
      },
    },
  },
  plugins: [],
};
