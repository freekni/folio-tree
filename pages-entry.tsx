import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectWorkspace from './app/project-workspace';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><ProjectWorkspace /></StrictMode>,
);
