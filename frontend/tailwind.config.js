/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Crimson Text"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: '#1a1a2e',
        parchment: '#faf9f6',
        muted: '#6b7280',
        accent: '#2563eb',
        'accent-light': '#dbeafe',
        'status-draft': '#9ca3af',
        'status-review': '#f59e0b',
        'status-edited': '#ef4444',
        'status-complete': '#10b981',
      },
    },
  },
  plugins: [],
}
