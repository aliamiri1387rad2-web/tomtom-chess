# TOMTOM CHESS — ONLINE

نسخه آنلاین واقعی TOMTOM CHESS با WebSocket.

## اجرا روی کامپیوتر

1. Node.js نصب باشد.
2. داخل همین پوشه اجرا کنید:

```bash
npm install
npm start
```

3. مرورگر را باز کنید:

`http://localhost:8080`

4. از داخل «بازی آنلاین» روی «ساخت اتاق» بزنید.
5. کد اتاق را برای بازیکن دوم بفرستید.
6. بازیکن دوم همان آدرس سایت را باز کند، کد را وارد کند و «ورود به اتاق» را بزند.

## بازی از دو دستگاه در اینترنت

برای اینترنت عمومی، `server.js` باید روی یک سرور/هاست Node.js با WebSocket اجرا شود. سپس آدرس HTTPS سایت را به هر دو بازیکن بدهید. کد اتاق از طریق WebSocket روی همان سرور هماهنگ می‌شود.

اگر سایت با HTTPS اجرا شود، کلاینت به صورت خودکار از `wss://` استفاده می‌کند.

## نکته

این نسخه حرکت‌های قانونی را در مرورگر شطرنج کنترل می‌کند و سرور نقش هماهنگ‌کننده اتاق و انتقال حرکت را دارد. برای محصول رقابتی واقعی، مرحله بعدی می‌تواند اعتبارسنجی کامل حرکت‌ها روی سرور، احراز هویت، ذخیره بازی و سیستم رتبه‌بندی آنلاین باشد.


### V5 UI stability
- The chessboard keeps a fixed square layout while moves are rendered.
- Move rendering no longer applies a scale animation to the whole board.
- Scroll position is preserved when the board is re-rendered.
- The board shell uses layout containment to prevent page reflow.
