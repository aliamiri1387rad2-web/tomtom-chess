TOMTOM CHESS — GitHub Final Online Fix

این نسخه باید به عنوان نسخه کامل پروژه روی GitHub قرار بگیرد.
فایل‌های game.js و public/game.js یکسان هستند.
فایل‌های online-plus.js و public/online-plus.js یکسان هستند.
WebSocket سرور و کلاینت هر دو از مسیر /ws استفاده می‌کنند.
تست اتصال علاوه بر handshake، پیام connected واقعی سرور را نیز بررسی می‌کند.

Render: Build = npm install && npm run build
Render: Start = npm start
Health = /health
WebSocket = wss://YOUR-SERVER.onrender.com/ws
