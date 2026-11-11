import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
import { supabasePagesData } from './pages/supabaseData'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App auth={supabase.auth} pagesData={supabasePagesData} />
  </StrictMode>,
)
