import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';

const HostApp = lazy(() => import('./host/HostApp.jsx'));
const ControllerApp = lazy(() => import('./controller/ControllerApp.jsx'));

// /play/ABCD -> phone controller, everything else -> host screen
const m = location.pathname.match(/^\/play\/?([A-Za-z]{4})?/);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="boot">loading…</div>}>
      {m ? <ControllerApp room={(m[1] || '').toUpperCase()} /> : <HostApp />}
    </Suspense>
  </StrictMode>,
);
