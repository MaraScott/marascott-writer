import React from 'react'
import ReactDOM from 'react-dom/client'
import { TamaguiProvider } from 'tamagui'
import { tamaguiConfig } from './tamagui.config'
import { App } from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      <App />
    </TamaguiProvider>
  </React.StrictMode>,
)
