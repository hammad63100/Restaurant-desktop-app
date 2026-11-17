/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#E63946',
          dark: '#C1121F',
        },
        secondary: '#FFB703',
        accent: '#FB8500',
        background: '#F8F9FA',
        surface: '#FFFFFF',
        border: '#E5E7EB',
        text: {
          primary: '#1F2937',
          secondary: '#6B7280',
        },
        sidebar: '#1F2937',
        status: {
          success: '#2A9D8F',
          pending: '#FFB703',
          preparing: '#3B82F6',
          cancelled: '#DC2626',
        },
      },
      fontFamily: {
        heading: ['Poppins', 'system-ui', 'Segoe UI', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      fontSize: {
        'page-title': ['28px', { lineHeight: '1.2', fontWeight: '700' }],
        'section-title': ['20px', { lineHeight: '1.2', fontWeight: '600' }],
        'card-title': ['16px', { lineHeight: '1.2', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.5', fontWeight: '500' }],
        'big-number': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        button: ['14px', { lineHeight: '1.5', fontWeight: '600' }],
      },
      borderRadius: {
        card: '12px',
        control: '8px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0, 0, 0, 0.08)',
      },
      height: {
        control: '40px',
        'control-lg': '48px',
      },
    },
  },
  plugins: [],
};
