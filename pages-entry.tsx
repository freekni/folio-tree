import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectWorkspace from './app/project-workspace';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><ProjectWorkspace /></StrictMode>,
);

// Caches the app shell so the page still opens without a network connection.
// Project files never travel through it — they are read straight off the disk.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
  });
}
