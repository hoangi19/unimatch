import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createChatbotApi } from './chatbot/api'
import { supabaseDatasetData } from './dataset/supabaseData'
import { supabaseInboxData } from './inbox/supabaseData'
import { supabase } from './lib/supabase'
import { supabasePagesData } from './pages/supabaseData'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      auth={supabase.auth}
      inboxData={supabaseInboxData}
      pagesData={supabasePagesData}
      datasetData={supabaseDatasetData}
      chatbot={createChatbotApi(supabase)}
    />
  </StrictMode>,
)
