# Web ADB Console

A modern web-based ADB (Android Debug Bridge) console that runs directly in your browser using WebUSB. Execute ADB commands, flash firmware, and manage your Android device without installing any software.

## Features

- **Direct USB Connection**: Connect to Android devices directly through WebUSB
- **ADB Shell Commands**: Execute any ADB shell command from the browser
- **Fastboot Support**: Flash firmware images and manage bootloader
- **File Flashing**: Upload and flash local files (boot.img, recovery.img, etc.)
- **Real-time Console**: Live output with command history
- **Cross-platform**: Works on any platform with a compatible browser
- **No Installation Required**: Runs entirely in the browser

## Browser Support

- Chrome 61+
- Edge 79+
- Other Chromium-based browsers with WebUSB support

## Getting Started

1. **Enable USB Debugging** on your Android device:
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times to enable Developer Options
   - Go to Settings → Developer Options
   - Enable "USB Debugging"

2. **Connect your device** via USB cable

3. **Open the web console** and click "Connect"

4. **Select your device** from the browser prompt

5. **Authorize the connection** on your device when prompted

## Usage

### ADB Commands
Simply type any ADB shell command in the console:
```
getprop ro.product.model
pm list packages
logcat -d
```

### Fastboot Commands
Switch to fastboot mode and flash images:
```
reboot bootloader
fastboot flash boot boot.img
fastboot reboot
```

### File Flashing
- Upload local image files (boot.img, recovery.img, system.img, etc.)
- Select target partition
- Flash directly from the browser

## Security

- All operations happen locally in your browser
- No data is sent to external servers
- Device authorization required for all connections
- WebUSB provides secure, permission-based device access

## Development

This project uses modern web technologies:
- ES6 Modules
- WebUSB API
- @yume-chan/adb library for ADB protocol
- fastboot.js for fastboot operations

## License

MIT License - feel free to use and modify as needed.

## Contributing

Contributions welcome! Please feel free to submit issues and pull requests.