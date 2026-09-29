V43 verified fixes:
- Removed the explicit blue capture/move ring from the chessboard.
- Portrait game screen is no longer forced to 100dvh/hidden overflow; it can scroll naturally on Android WebViews.
- Removed backdrop-filter dependency from offline modal for WebView compatibility.
- Preserved AI/game logic from V42.
- Background file is 3840x2160 via high-quality Lanczos upscale of the existing artwork; this is an upscale, not newly generated native 4K detail.
