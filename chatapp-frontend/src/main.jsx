import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ChatApp from './components/ChatApp.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChatApp /> {/* Asegúrate de que este componente sea el correcto */}
  </StrictMode>,
)
