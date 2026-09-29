TOMTOM CHESS V66 - WebSocket diagnostic fix
- WebSocket client now connects to the service root instead of forcing /ws.
- WebSocket close code/reason is shown in the online panel.
- Server logs every WebSocket upgrade and successful connection.
- Room and matchmaking request/response IDs remain enabled.
- If HTTP health works but WebSocket fails, the app now exposes the actual close state instead of only timing out.
