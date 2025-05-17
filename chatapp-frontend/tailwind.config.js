/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}", // Asegúrate de incluir jsx aquí
  ],
  theme: {
    extend: {
      animation: { // Asegúrate de que las animaciones estén habilitadas
        bounce: 'bounce 1s infinite',
      }
    },
  },
  plugins: [],
  corePlugins: {
    animation: true, // Debe ser true (valor por defecto)
  }
}