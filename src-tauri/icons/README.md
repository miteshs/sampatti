# App icons

Tauri needs platform icons here before `tauri build`. Generate the full set from one
1024×1024 PNG:

```
cd sampatti
npm run tauri icon ./brand-icon.png
```

That writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (macOS), and
`icon.ico` (Windows) into this folder, matching the paths in `tauri.conf.json`.
