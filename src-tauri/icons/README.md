# App icons

Tauri needs platform icons here before `tauri build`. Generate the full set from one
1024×1024 PNG source:

```
cd sampatti
npm run tauri icon ./brand/icon-source.png
```

That writes the desktop and mobile assets from the same source:

- macOS: `icon.icns` plus the PNG sizes referenced by `tauri.conf.json`
- Windows: `icon.ico` and `Square*Logo.png` / `StoreLogo.png`
- Android: `android/mipmap-*/ic_launcher*.png` and adaptive icon XML
- iPhone/iPad: Tauri writes the Xcode `AppIcon.appiconset` into ignored generated files under
  `src-tauri/gen/apple/Assets.xcassets/`; keep a committed copy in
  `src-tauri/icons/apple/AppIcon.appiconset/`

After regenerating icons, refresh the committed Apple copy:

```
cp -R src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset src-tauri/icons/apple/
```
