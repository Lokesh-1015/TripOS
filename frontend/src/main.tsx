import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import { startServiceWorker } from './lib/pwa'

startServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
    {/* Vercel Web Analytics: page views only, no cookies. It only sends data on Vercel; locally it just logs. */}
    <Analytics />
  </StrictMode>,
)
