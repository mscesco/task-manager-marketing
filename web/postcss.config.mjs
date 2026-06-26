// Tailwind v4 usa o plugin dedicado de PostCSS (substitui tailwindcss+autoprefixer do v3).
// v4 já faz vendor-prefix sozinho — NÃO adicionar autoprefixer.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
