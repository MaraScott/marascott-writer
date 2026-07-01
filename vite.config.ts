import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { tamaguiPlugin } from '@tamagui/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    tamaguiPlugin({
      config: 'src/tamagui.config.ts',
      components: ['tamagui'],
      disableExtraction: true,
    }),
  ],
  define: {
    DEV: `${process.env.NODE_ENV === 'development' ? true : false}`,
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
  },
})
