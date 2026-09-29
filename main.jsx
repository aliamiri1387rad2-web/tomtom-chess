import React from 'react';
import { createRoot } from 'react-dom/client';
import './shell.css';

const App = () => React.createElement(
  'main',
  { className: 'app-shell' },
  React.createElement('iframe', {
    className: 'game-frame',
    src: '/game.html',
    title: 'TOMTOM CHESS',
    allow: 'autoplay; fullscreen; gamepad'
  })
);

createRoot(document.getElementById('root')).render(React.createElement(App));
