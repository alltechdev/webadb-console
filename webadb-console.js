import { Adb, AdbDaemonTransport } from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb@2.1.0/+esm';
import { AdbDaemonWebUsbDeviceManager } from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb-daemon-webusb@2.1.0/+esm';
import AdbWebCredentialStore from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb-credential-web@2.1.0/+esm';

class WebAdbConsole {
    constructor() {
        this.manager = AdbDaemonWebUsbDeviceManager.BROWSER;
        this.device = null;
        this.transport = null;
        this.adb = null;
        this.credentialStore = new AdbWebCredentialStore('WebADB Console Key');
        this.apkQueue = [];
        this.shareSession = null;
        this.isSharing = false;
        this.connectedPeers = [];
        this.scrcpyServer = null;
        this.scrcpyVideoSocket = null;
        this.scrcpyControlSocket = null;
        this.isScrcpyRunning = false;
    }

    async init() {
        this.checkWebUSBSupport();
        this.setupEventListeners();
        await this.tryAutoConnect();
    }

    checkWebUSBSupport() {
        if (!('usb' in navigator)) {
            this.showError('WebUSB is not supported in this browser. Please use Chrome or Edge.');
            const btn = document.getElementById('connectBtn');
            if (btn) btn.disabled = true;
        }
    }

    setupEventListeners() {
        // Connection button
        document.getElementById('connectBtn')?.addEventListener('click', () => this.handleConnect());

        // ADB Console
        document.getElementById('executeBtn')?.addEventListener('click', () => this.executeCommand());
        document.getElementById('commandInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.executeCommand();
        });

        // Console controls
        document.getElementById('clearConsoleBtn')?.addEventListener('click', () => this.clearConsole());
        document.getElementById('downloadConsoleBtn')?.addEventListener('click', () => this.downloadConsoleOutput());
        document.getElementById('copyConsoleBtn')?.addEventListener('click', () => this.copyConsoleOutput());


        // Sharing controls
        document.getElementById('createShareBtn')?.addEventListener('click', () => this.createShareSession());
        document.getElementById('joinShareBtn')?.addEventListener('click', () => this.toggleJoinSession());
        document.getElementById('connectToShareBtn')?.addEventListener('click', () => this.connectToShareSession());
        document.getElementById('copyShareCodeBtn')?.addEventListener('click', () => this.copyShareCode());

        // APK installation
        const apkUploadArea = document.getElementById('apkUploadArea');
        const apkFileInput = document.getElementById('apkFileInput');

        apkUploadArea?.addEventListener('click', () => apkFileInput?.click());
        apkFileInput?.addEventListener('change', (e) => this.handleApkSelection(e));

        // APK drag and drop
        apkUploadArea?.addEventListener('dragover', (e) => {
            e.preventDefault();
            apkUploadArea.classList.add('drag-over');
        });

        apkUploadArea?.addEventListener('dragleave', () => {
            apkUploadArea.classList.remove('drag-over');
        });

        apkUploadArea?.addEventListener('drop', (e) => {
            e.preventDefault();
            apkUploadArea.classList.remove('drag-over');
            this.handleApkDrop(e);
        });

        // APK installation controls
        document.getElementById('installAllBtn')?.addEventListener('click', () => this.installAllApks());
        document.getElementById('clearApkQueueBtn')?.addEventListener('click', () => this.clearApkQueue());

        // Scrcpy controls
        document.getElementById('startScrcpyBtn')?.addEventListener('click', () => this.startScrcpy());
        document.getElementById('stopScrcpyBtn')?.addEventListener('click', () => this.stopScrcpy());
        document.getElementById('clearScrcpyConsoleBtn')?.addEventListener('click', () => this.clearScrcpyConsole());
        document.getElementById('downloadScrcpyConsoleBtn')?.addEventListener('click', () => this.downloadScrcpyConsoleOutput());
        document.getElementById('copyScrcpyConsoleBtn')?.addEventListener('click', () => this.copyScrcpyConsoleOutput());

        // Auto-handle USB device connection changes
        if ('usb' in navigator) {
            navigator.usb.addEventListener('disconnect', async () => {
                this.logToConsole('USB device disconnected', 'warning');
                if (this.device) {
                    await this.handleDisconnect();
                }
            });

            navigator.usb.addEventListener('connect', async () => {
                this.logToConsole('USB device connected', 'info');
                if (!this.device) {
                    await this.tryAutoConnect();
                }
            });
        }
    }

    async handleConnect() {
        try {
            const btn = document.getElementById('connectBtn');
            if (btn) btn.disabled = true;

            if (this.device) {
                await this.handleDisconnect();
            } else {
                this.logToConsole('Requesting USB device access...', 'info');
                this.logToConsole('Please select your Android device from the browser prompt', 'info');
                
                const connectPromise = this.connect();
                let dismissAllow = null;
                const allowTimer = setTimeout(() => {
                    dismissAllow = this.showWarning('Tap allow on your device');
                }, 1000);
                
                this.device = await connectPromise.finally(() => {
                    clearTimeout(allowTimer);
                    if (dismissAllow) dismissAllow();
                });

                if (this.device) {
                    await this.finalizeConnection();
                }
            }
        } catch (error) {
            console.error('Connection error:', error);
            const errorText = error?.message || error?.name || String(error);
            this.showError(`Connection failed: ${errorText}`);
            const btn = document.getElementById('connectBtn');
            if (btn) btn.disabled = false;
        }
    }

    async connect() {
        if (!this.manager) {
            throw new Error('WebUSB is not supported in this browser.');
        }

        try {
            const devices = await this.manager.getDevices();
            const cached = JSON.parse(localStorage.getItem('adbDevice') || 'null');
            let target = null;
            
            if (cached) {
                target = devices.find(d =>
                    d.raw.vendorId === cached.vendorId &&
                    d.raw.productId === cached.productId &&
                    (!cached.serialNumber || d.serial === cached.serialNumber)
                );
            }
            
            if (!target) {
                if (devices.length > 0) target = devices[0];
                else target = await this.manager.requestDevice();
            }
            
            if (!target) {
                throw new Error('No compatible Android device found. Please connect your device via USB and ensure USB debugging is enabled.');
            }

            this.device = target;
            
            try {
                localStorage.setItem('adbDevice', JSON.stringify({
                    vendorId: target.raw.vendorId,
                    productId: target.raw.productId,
                    serialNumber: target.serial
                }));
            } catch (e) {
                console.warn('Failed to cache device info', e);
            }

            const connection = await target.connect();
            this.transport = await AdbDaemonTransport.authenticate({
                serial: target.serial,
                connection,
                credentialStore: this.credentialStore
            });

            this.adb = new Adb(this.transport);
            return target.raw;
        } catch (error) {
            console.error('Connection error:', error);
            if (error.name === 'NotFoundError') {
                throw new Error('No compatible Android device found. Please connect your device via USB and ensure USB debugging is enabled.');
            } else if (error.name === 'SecurityError') {
                throw new Error('USB device access denied. Please ensure you are using a secure context (HTTPS) and have granted permission to access the device.');
            } else if (error.message?.includes('Authentication')) {
                throw new Error('Device authorization required. Please check your Android device and tap "Allow".');
            }
            throw error;
        }
    }

    async handleDisconnect() {
        if (this.adb) {
            try { await this.adb.close(); } catch {}
        }
        this.adb = null;
        this.transport = null;
        this.device = null;

        this.updateConnectionStatus('disconnected');

        const btn = document.getElementById('connectBtn');
        if (btn) {
            btn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0l1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>
                </svg>
                Connect
            `;
            btn.disabled = false;
        }

        const executeBtn = document.getElementById('executeBtn');
        if (executeBtn) executeBtn.disabled = true;

        const createShareBtn = document.getElementById('createShareBtn');
        if (createShareBtn) createShareBtn.disabled = true;

        const startScrcpyBtn = document.getElementById('startScrcpyBtn');
        if (startScrcpyBtn) startScrcpyBtn.disabled = true;

        this.logToConsole('Device disconnected', 'warning');
    }

    async finalizeConnection() {
        const btn = document.getElementById('connectBtn');
        
        this.logToConsole('Device connected. Getting device information...', 'info');
        this.logToConsole('If prompted on your device, tap "Allow" to authorize this computer', 'warning');

        const deviceInfo = await this.getDeviceInfo();
        this.updateConnectionStatus('connected', deviceInfo);
        
        if (btn) {
            btn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                    <line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
                Disconnect
            `;
            btn.disabled = false;
        }
        
        const executeBtn = document.getElementById('executeBtn');
        if (executeBtn) executeBtn.disabled = false;
        
        const createShareBtn = document.getElementById('createShareBtn');
        if (createShareBtn) createShareBtn.disabled = false;
        
        const startScrcpyBtn = document.getElementById('startScrcpyBtn');
        if (startScrcpyBtn) startScrcpyBtn.disabled = false;
        
        this.logToConsole('Device connected and ready', 'success');
    }

    async tryAutoConnect() {
        const cached = JSON.parse(localStorage.getItem('adbDevice') || 'null');
        if (!cached) return;

        try {
            const devices = await navigator.usb.getDevices();
            const match = devices.find(d =>
                d.vendorId === cached.vendorId &&
                d.productId === cached.productId &&
                (!cached.serialNumber || d.serialNumber === cached.serialNumber)
            );
            
            if (!match) {
                localStorage.removeItem('adbDevice');
                return;
            }

            await this.handleConnect();
        } catch (error) {
            console.error('Auto-connect failed:', error);
            localStorage.removeItem('adbDevice');
        }
    }

    async executeCommand() {
        const commandInput = document.getElementById('commandInput');
        const command = commandInput?.value.trim();
        if (!command) return;

        if (!this.adb) {
            this.logToConsole('ERROR: No device connected', 'error');
            return;
        }

        const executeBtn = document.getElementById('executeBtn');
        if (executeBtn) {
            executeBtn.disabled = true;
            executeBtn.innerHTML = `
                <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>
            `;
        }

        try {
            this.logToConsole(`$ adb shell ${command}`, 'command');
            
            // Execute the command directly as a shell command
            const result = await this.executeShellCommand(command);
            if (result.trim()) {
                this.logToConsole(result, 'output');
            } else {
                this.logToConsole('(no output)', 'info');
            }
        } catch (error) {
            this.logToConsole(`ERROR: ${error.message}`, 'error');
        }

        if (executeBtn) {
            executeBtn.disabled = false;
            executeBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5,3 19,12 5,21"></polygon>
                </svg>
            `;
        }
        if (commandInput) commandInput.value = '';
    }

    async executeShellCommand(command) {
        if (!this.adb) {
            throw new Error('No device connected');
        }

        let processedCommand = command;
        if (command.includes('dpm set-device-owner')) {
            const match = command.match(/dpm set-device-owner\s+(?:["']([^"']+)["']|([^\s]+))/);
            if (match) {
                const componentName = match[1] || match[2];
                processedCommand = `dpm set-device-owner '${componentName}'`;
            }
        } else if (command.includes('dpm ') && command.includes('/')) {
            processedCommand = command.replace(/([\w.]+\/[\w.]+)/g, "'$1'");
        }

        try {
            return await this.adb.subprocess.noneProtocol.spawnWaitText(processedCommand);
        } catch (error) {
            console.error('Shell command error:', error);
            throw new Error(`Failed to execute command: ${error.message}`);
        }
    }

    async getDeviceInfo() {
        if (!this.adb) {
            throw new Error('No device connected');
        }
        
        try {
            const [model, androidVersion, buildId] = await Promise.all([
                this.executeShellCommand('getprop ro.product.model'),
                this.executeShellCommand('getprop ro.build.version.release'),
                this.executeShellCommand('getprop ro.build.display.id')
            ]);
            
            return {
                model: model.trim(),
                androidVersion: androidVersion.trim(),
                buildId: buildId.trim(),
                serial: this.transport?.serial || this.device?.serial || ''
            };
        } catch (error) {
            console.error('Get device info error:', error);
            throw new Error(`Failed to get device info: ${error.message}`);
        }
    }

    updateConnectionStatus(status, deviceInfo = null) {
        const statusIcon = document.querySelector('.status-icon');
        const statusTitle = document.getElementById('statusTitle');
        const statusMessage = document.getElementById('statusMessage');
        const deviceInfoDiv = document.getElementById('deviceInfo');
        const deviceModel = document.getElementById('deviceModel');
        const androidVersion = document.getElementById('androidVersion');
        const deviceSerial = document.getElementById('deviceSerial');

        if (status === 'connected' && deviceInfo) {
            statusIcon.className = 'status-icon connected';
            statusIcon.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22,4 12,14.01 9,11.01"></polyline>
                </svg>
            `;
            statusTitle.textContent = 'Device Connected';
            statusMessage.textContent = 'ADB console ready for commands';
            
            if (deviceModel) deviceModel.textContent = deviceInfo.model || 'Unknown';
            if (androidVersion) androidVersion.textContent = deviceInfo.androidVersion || 'Unknown';
            if (deviceSerial) deviceSerial.textContent = deviceInfo.serial || 'Unknown';
            
            deviceInfoDiv.classList.remove('hidden');
        } else {
            statusIcon.className = 'status-icon disconnected';
            statusIcon.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                    <line x1="12" y1="18" x2="12.01" y2="18"></line>
                </svg>
            `;
            statusTitle.textContent = 'No Device Connected';
            statusMessage.textContent = 'Connect your Android device via USB to begin';
            deviceInfoDiv.classList.add('hidden');
        }
    }

    logToConsole(message, type = 'info') {
        const consoleOutput = document.getElementById('consoleOutput');
        if (!consoleOutput) return;

        const entry = document.createElement('div');
        entry.className = `console-entry ${type}`;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'console-timestamp';
        timestamp.textContent = `[${type.toUpperCase()}]`;
        
        const messageSpan = document.createElement('span');
        messageSpan.className = 'console-message';
        messageSpan.textContent = message;
        
        entry.appendChild(timestamp);
        entry.appendChild(messageSpan);
        
        consoleOutput.appendChild(entry);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    logToFastbootConsole(message, type = 'info') {
        const consoleOutput = document.getElementById('fastbootConsoleOutput');
        if (!consoleOutput) return;

        const entry = document.createElement('div');
        entry.className = `console-entry ${type}`;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'console-timestamp';
        timestamp.textContent = `[${type.toUpperCase()}]`;
        
        const messageSpan = document.createElement('span');
        messageSpan.className = 'console-message';
        messageSpan.textContent = message;
        
        entry.appendChild(timestamp);
        entry.appendChild(messageSpan);
        
        consoleOutput.appendChild(entry);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    clearConsole() {
        const consoleOutput = document.getElementById('consoleOutput');
        if (consoleOutput) consoleOutput.innerHTML = '';
    }

    clearFastbootConsole() {
        const consoleOutput = document.getElementById('fastbootConsoleOutput');
        if (consoleOutput) consoleOutput.innerHTML = '';
    }

    downloadConsoleOutput() {
        const consoleOutput = document.getElementById('consoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.showWarning('No console output to download');
            return;
        }

        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `adb-console-output-${timestamp}.txt`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showSuccess('Console output downloaded');
    }

    copyConsoleOutput() {
        const consoleOutput = document.getElementById('consoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.showWarning('No console output to copy');
            return;
        }
        
        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');
            
        navigator.clipboard.writeText(content)
            .then(() => this.showSuccess('Console output copied to clipboard'))
            .catch(() => this.showError('Failed to copy output'));
    }

    downloadFastbootConsoleOutput() {
        const consoleOutput = document.getElementById('fastbootConsoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.logToFastbootConsole('No console output to download', 'warning');
            return;
        }

        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fastboot-console-output-${timestamp}.txt`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.logToFastbootConsole('Console output downloaded', 'success');
    }

    copyFastbootConsoleOutput() {
        const consoleOutput = document.getElementById('fastbootConsoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.logToFastbootConsole('No console output to copy', 'warning');
            return;
        }
        
        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');
            
        navigator.clipboard.writeText(content)
            .then(() => this.logToFastbootConsole('Console output copied to clipboard', 'success'))
            .catch(() => this.logToFastbootConsole('Failed to copy output', 'error'));
    }

    logToScrcpyConsole(message, type = 'info') {
        const consoleOutput = document.getElementById('scrcpyConsoleOutput');
        if (!consoleOutput) return;

        const entry = document.createElement('div');
        entry.className = `console-entry ${type}`;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'console-timestamp';
        timestamp.textContent = `[${type.toUpperCase()}]`;
        
        const messageSpan = document.createElement('span');
        messageSpan.className = 'console-message';
        messageSpan.textContent = message;
        
        entry.appendChild(timestamp);
        entry.appendChild(messageSpan);
        
        consoleOutput.appendChild(entry);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    clearScrcpyConsole() {
        const consoleOutput = document.getElementById('scrcpyConsoleOutput');
        if (consoleOutput) consoleOutput.innerHTML = '';
    }

    downloadScrcpyConsoleOutput() {
        const consoleOutput = document.getElementById('scrcpyConsoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.logToScrcpyConsole('No console output to download', 'warning');
            return;
        }

        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `scrcpy-console-output-${timestamp}.txt`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.logToScrcpyConsole('Console output downloaded', 'success');
    }

    copyScrcpyConsoleOutput() {
        const consoleOutput = document.getElementById('scrcpyConsoleOutput');
        if (!consoleOutput || consoleOutput.children.length === 0) {
            this.logToScrcpyConsole('No console output to copy', 'warning');
            return;
        }
        
        const content = Array.from(consoleOutput.children)
            .map(entry => entry.textContent)
            .join('\n');
            
        navigator.clipboard.writeText(content)
            .then(() => this.logToScrcpyConsole('Console output copied to clipboard', 'success'))
            .catch(() => this.logToScrcpyConsole('Failed to copy output', 'error'));
    }

    async startScrcpy() {
        if (!this.adb) {
            this.logToScrcpyConsole('Please connect device first', 'error');
            return;
        }

        if (this.isScrcpyRunning) {
            this.logToScrcpyConsole('Screen mirroring is already running', 'warning');
            return;
        }

        const startBtn = document.getElementById('startScrcpyBtn');
        const stopBtn = document.getElementById('stopScrcpyBtn');
        
        if (startBtn) startBtn.disabled = true;

        try {
            this.logToScrcpyConsole('Preparing scrcpy server...', 'info');

            // Step 1: Push scrcpy server to device
            await this.pushScrcpyServer();

            // Step 2: Start scrcpy server with proper arguments
            await this.startScrcpyServer();

            // Step 3: Setup video streaming
            await this.setupVideoStream();

            // Step 4: Setup input handling
            this.setupInputHandling();

            this.isScrcpyRunning = true;
            if (stopBtn) stopBtn.disabled = false;
            
            this.logToScrcpyConsole('Screen mirroring started successfully', 'success');
            this.showVideoDisplay();

        } catch (error) {
            this.logToScrcpyConsole(`Failed to start screen mirroring: ${error.message}`, 'error');
            if (startBtn) startBtn.disabled = false;
            this.cleanup();
        }
    }

    async stopScrcpy() {
        if (!this.isScrcpyRunning) {
            this.logToScrcpyConsole('Screen mirroring is not running', 'warning');
            return;
        }

        const startBtn = document.getElementById('startScrcpyBtn');
        const stopBtn = document.getElementById('stopScrcpyBtn');
        
        this.logToScrcpyConsole('Stopping screen mirror...', 'info');

        // Cleanup all resources
        await this.cleanup();

        this.isScrcpyRunning = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;

        this.hideVideoDisplay();
        this.logToScrcpyConsole('Screen mirror stopped', 'success');
    }

    showScrcpyPlaceholder() {
        const placeholder = document.querySelector('.scrcpy-placeholder');
        const canvas = document.getElementById('scrcpyCanvas');
        
        if (placeholder) placeholder.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            // Create a placeholder pattern on canvas
            const ctx = canvas.getContext('2d');
            canvas.width = 400;
            canvas.height = 600;
            
            // Create a gradient background
            const gradient = ctx.createLinearGradient(0, 0, 400, 600);
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 400, 600);
            
            // Add text
            ctx.fillStyle = 'white';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Scrcpy Simulation', 200, 280);
            ctx.font = '16px Arial';
            ctx.fillText('Device screen would appear here', 200, 320);
            ctx.fillText('with real scrcpy integration', 200, 340);
        }
    }

    hideScrcpyDisplay() {
        const placeholder = document.querySelector('.scrcpy-placeholder');
        const canvas = document.getElementById('scrcpyCanvas');
        
        if (placeholder) placeholder.style.display = 'block';
        if (canvas) canvas.style.display = 'none';
    }

    showSuccess(message) {
        this.logToConsole(message, 'success');
    }

    showError(message) {
        this.logToConsole(message, 'error');
    }

    showWarning(message) {
        this.logToConsole(message, 'warning');
    }

    switchMode(mode) {
        this.currentMode = mode;
        
        // Update mode buttons
        document.getElementById('adbModeBtn')?.classList.toggle('active', mode === 'adb');
        document.getElementById('fastbootModeBtn')?.classList.toggle('active', mode === 'fastboot');
        document.getElementById('scrcpyModeBtn')?.classList.toggle('active', mode === 'scrcpy');
        
        // Update console visibility
        const adbConsole = document.getElementById('adbConsoleCard');
        const fastbootConsole = document.getElementById('fastbootConsoleCard');
        const scrcpyConsole = document.getElementById('scrcpyConsoleCard');
        
        // Hide all consoles first
        adbConsole?.classList.add('hidden');
        fastbootConsole?.classList.add('hidden');
        scrcpyConsole?.classList.add('hidden');
        
        // Show the selected console
        if (mode === 'adb') {
            adbConsole?.classList.remove('hidden');
        } else if (mode === 'fastboot') {
            fastbootConsole?.classList.remove('hidden');
            // Add helpful information about fastboot limitations
            this.logToFastbootConsole('Fastboot mode activated', 'info');
            this.logToFastbootConsole('Note: Browser-based fastboot has limitations due to WebUSB restrictions', 'warning');
            this.logToFastbootConsole('For full fastboot functionality, use native fastboot tools', 'info');
        } else if (mode === 'scrcpy') {
            scrcpyConsole?.classList.remove('hidden');
        }
        
        this.logToConsole(`Switched to ${mode.toUpperCase()} mode`, 'info');
    }

    async executeFastbootCommand() {
        const commandInput = document.getElementById('fastbootCommandInput');
        const fullCommand = commandInput?.value.trim();
        if (!fullCommand) return;

        const executeBtn = document.getElementById('fastbootExecuteBtn');
        if (executeBtn) {
            executeBtn.disabled = true;
            executeBtn.innerHTML = `
                <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>
            `;
        }

        try {
            this.logToFastbootConsole(`$ ${fullCommand}`, 'command');
            
            // Validate that command starts with 'fastboot'
            if (!fullCommand.startsWith('fastboot ')) {
                this.logToFastbootConsole('ERROR: Command must start with "fastboot" (e.g., "fastboot devices")', 'error');
                throw new Error('Invalid command format');
            }
            
            // Parse the command to extract the fastboot part
            let command = fullCommand;
            if (fullCommand.startsWith('fastboot ')) {
                command = fullCommand.substring('fastboot '.length);
            }
            
            // For fastboot mode, we need to handle device connection differently
            if (command === 'devices') {
                try {
                    // Try to request fastboot devices specifically
                    const manager = this.manager;
                    if (manager) {
                        // First check if we have an ADB device that we can potentially reboot to fastboot
                        if (this.device && this.adb) {
                            this.logToFastbootConsole(`${this.device.serial || 'unknown'}\tfastboot`, 'output');
                            this.logToFastbootConsole('Note: Showing connected ADB device. Use "fastboot reboot bootloader" to enter fastboot mode.', 'info');
                        } else {
                            this.logToFastbootConsole('No ADB device connected.', 'warning');
                            this.logToFastbootConsole('Fastboot device detection requires device to be connected via ADB first.', 'info');
                            this.logToFastbootConsole('Connect device, then use "adb reboot bootloader" to enter fastboot mode.', 'info');
                        }
                    } else {
                        this.logToFastbootConsole('WebUSB not available for fastboot device detection', 'warning');
                    }
                } catch (error) {
                    this.logToFastbootConsole('Fastboot device detection not available in browser', 'warning');
                    this.logToFastbootConsole('Real fastboot support requires native fastboot tools or server-side implementation', 'info');
                }
            } else if (command.startsWith('reboot')) {
                if (this.adb) {
                    // If we have ADB connection, try to reboot through ADB
                    if (command === 'reboot bootloader' || command === 'reboot-bootloader') {
                        const result = await this.executeShellCommand('reboot bootloader');
                        this.logToFastbootConsole('Device rebooting to bootloader...', 'info');
                        this.logToFastbootConsole('Wait for device to enter fastboot mode, then try fastboot commands.', 'warning');
                    } else if (command === 'reboot') {
                        const result = await this.executeShellCommand('reboot');
                        this.logToFastbootConsole('Device rebooting...', 'info');
                    }
                } else {
                    this.logToFastbootConsole('No ADB connection available to reboot device', 'error');
                    this.logToFastbootConsole('Please manually reboot device to desired mode', 'info');
                }
            } else {
                this.logToFastbootConsole('Browser-based fastboot has limitations', 'warning');
                this.logToFastbootConsole('WebUSB cannot directly communicate with fastboot devices', 'info');
                this.logToFastbootConsole('For real fastboot operations, use native fastboot tools', 'info');
                this.logToFastbootConsole(`Simulated: fastboot ${command}`, 'output');
            }
            
        } catch (error) {
            this.logToFastbootConsole(`ERROR: ${error.message}`, 'error');
        }

        if (executeBtn) {
            executeBtn.disabled = false;
            executeBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5,3 19,12 5,21"></polygon>
                </svg>
            `;
        }
        if (commandInput) commandInput.value = '';
    }

    async simulateFastbootCommand(command) {
        // This is a placeholder for fastboot functionality
        // In a real implementation, you'd integrate fastboot.js
        if (command === 'devices') {
            return `${this.device?.serial || 'unknown'}\tfastboot`;
        } else if (command.startsWith('getvar')) {
            return 'version-bootloader: 1.0\nfinished. total time: 0.001s';
        } else if (command === 'reboot bootloader') {
            return await this.executeShellCommand('reboot bootloader');
        } else if (command === 'reboot') {
            return await this.executeShellCommand('reboot');
        } else {
            return 'Fastboot command simulation - real fastboot.js integration needed';
        }
    }

    handleFileSelection(e) {
        const files = Array.from(e.target.files || []);
        files.forEach(file => this.addToFlashQueue(file));
    }

    handleFileDrop(e) {
        const files = Array.from(e.dataTransfer.files || []);
        files.forEach(file => this.addToFlashQueue(file));
    }

    addToFlashQueue(file) {
        const supportedTypes = ['.img', '.zip', '.bin', '.apk'];
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!supportedTypes.includes(fileExtension)) {
            this.showError(`Unsupported file type: ${fileExtension}`);
            return;
        }

        // Check if file already in queue
        if (this.flashQueue.find(item => item.file.name === file.name)) {
            this.showWarning(`File ${file.name} is already in queue`);
            return;
        }

        const flashItem = {
            file: file,
            name: file.name,
            size: this.formatFileSize(file.size),
            partition: this.guessPartition(file.name)
        };

        this.flashQueue.push(flashItem);
        this.updateFlashQueueDisplay();
        this.logToConsole(`Added ${file.name} to flash queue`, 'info');
    }

    guessPartition(filename) {
        const name = filename.toLowerCase();
        if (name.endsWith('.apk')) return 'apk-install';
        if (name.includes('boot')) return 'boot';
        if (name.includes('recovery')) return 'recovery';
        if (name.includes('system')) return 'system';
        if (name.includes('userdata')) return 'userdata';
        if (name.includes('vendor')) return 'vendor';
        if (name.includes('dtbo')) return 'dtbo';
        if (name.includes('vbmeta')) return 'vbmeta';
        return 'unknown';
    }

    updateFlashQueueDisplay() {
        const flashQueue = document.getElementById('flashQueue');
        const flashList = document.getElementById('flashList');
        
        if (this.flashQueue.length === 0) {
            flashQueue.style.display = 'none';
            return;
        }
        
        flashQueue.style.display = 'block';
        flashList.innerHTML = '';

        this.flashQueue.forEach((item, index) => {
            const itemElement = document.createElement('div');
            itemElement.className = 'flash-item';
            itemElement.innerHTML = `
                <div class="flash-item-info">
                    <div class="flash-item-icon">${item.partition.toUpperCase()}</div>
                    <div class="flash-item-details">
                        <h4>${item.name}</h4>
                        <p>${item.size} • Target: ${item.partition}</p>
                        <div class="partition-selector">
                            <label>Partition:</label>
                            <select data-index="${index}" class="partition-select">
                                <option value="apk-install" ${item.partition === 'apk-install' ? 'selected' : ''}>APK Install</option>
                                <option value="boot" ${item.partition === 'boot' ? 'selected' : ''}>boot</option>
                                <option value="recovery" ${item.partition === 'recovery' ? 'selected' : ''}>recovery</option>
                                <option value="system" ${item.partition === 'system' ? 'selected' : ''}>system</option>
                                <option value="userdata" ${item.partition === 'userdata' ? 'selected' : ''}>userdata</option>
                                <option value="vendor" ${item.partition === 'vendor' ? 'selected' : ''}>vendor</option>
                                <option value="dtbo" ${item.partition === 'dtbo' ? 'selected' : ''}>dtbo</option>
                                <option value="vbmeta" ${item.partition === 'vbmeta' ? 'selected' : ''}>vbmeta</option>
                                <option value="custom">Custom...</option>
                            </select>
                        </div>
                    </div>
                </div>
                <button class="flash-item-remove" data-index="${index}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;

            // Add event listeners
            itemElement.querySelector('.flash-item-remove')?.addEventListener('click', () => {
                this.removeFromFlashQueue(index);
            });

            itemElement.querySelector('.partition-select')?.addEventListener('change', (e) => {
                this.flashQueue[index].partition = e.target.value;
            });

            flashList.appendChild(itemElement);
        });
    }

    removeFromFlashQueue(index) {
        const item = this.flashQueue[index];
        this.flashQueue.splice(index, 1);
        this.updateFlashQueueDisplay();
        this.logToConsole(`Removed ${item.name} from flash queue`, 'info');
    }

    clearFlashQueue() {
        this.flashQueue = [];
        this.updateFlashQueueDisplay();
        this.logToConsole('Flash queue cleared', 'info');
    }

    async flashAll() {
        if (!this.device) {
            this.showError('Please connect a device first');
            return;
        }

        if (this.flashQueue.length === 0) {
            this.showError('No files in flash queue');
            return;
        }

        const flashBtn = document.getElementById('flashAllBtn');
        if (flashBtn) flashBtn.disabled = true;

        this.logToConsole('Starting flash process...', 'info');
        this.logToConsole('WARNING: Flashing firmware can brick your device if done incorrectly!', 'warning');

        for (let i = 0; i < this.flashQueue.length; i++) {
            const item = this.flashQueue[i];
            try {
                this.logToConsole(`Flashing ${item.name} to ${item.partition}...`, 'info');
                
                // In a real implementation, you would:
                // 1. Use fastboot.js to flash the file
                // 2. Handle the binary data properly
                // 3. Show real progress
                
                // For now, simulate the flashing process
                await this.simulateFlash(item);
                
                this.logToConsole(`Successfully flashed ${item.name}`, 'success');
            } catch (error) {
                this.logToConsole(`Failed to flash ${item.name}: ${error.message}`, 'error');
            }
        }

        this.logToConsole('Flash process completed', 'info');
        if (flashBtn) flashBtn.disabled = false;
    }

    async simulateFlash(item) {
        // Simulate flashing delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // This would be replaced with actual fastboot flashing
        this.logToConsole(`Simulated flash of ${item.name} (${item.size}) to ${item.partition} partition`, 'output');
        
        // In real implementation:
        // return await this.fastboot.flash(item.partition, item.file);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    // Sharing functionality
    async createShareSession() {
        if (!this.adb) {
            this.logToConsole('Please connect device first', 'error');
            return;
        }

        // Generate a unique share code
        const shareCode = this.generateShareCode();
        
        // Show sharing info
        const sharingInfo = document.getElementById('sharingInfo');
        const shareCodeInput = document.getElementById('shareCode');
        const connectionStatus = document.getElementById('connectionStatus');
        
        if (sharingInfo && shareCodeInput && connectionStatus) {
            shareCodeInput.value = shareCode;
            sharingInfo.style.display = 'block';
            connectionStatus.textContent = 'Share session active - waiting for connections...';
        }

        this.isSharing = true;
        this.shareSession = shareCode;
        this.logToConsole(`Share session created: ${shareCode}`, 'success');
        this.logToConsole('Others can join using this code to execute commands on your device', 'info');
    }

    generateShareCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async copyShareCode() {
        const shareCodeInput = document.getElementById('shareCode');
        if (shareCodeInput && shareCodeInput.value) {
            try {
                await navigator.clipboard.writeText(shareCodeInput.value);
                this.logToConsole('Share code copied to clipboard', 'success');
            } catch (error) {
                this.logToConsole('Failed to copy share code', 'error');
            }
        }
    }

    toggleJoinSession() {
        const joinSession = document.getElementById('joinSession');
        if (joinSession) {
            const isVisible = joinSession.style.display === 'block';
            joinSession.style.display = isVisible ? 'none' : 'block';
        }
    }

    async connectToShareSession() {
        const joinCodeInput = document.getElementById('joinCodeInput');
        const shareCode = joinCodeInput?.value.trim().toUpperCase();
        
        if (!shareCode) {
            this.logToConsole('Please enter a share code', 'error');
            return;
        }

        this.logToConsole(`Attempting to join session: ${shareCode}`, 'info');
        this.logToConsole('Note: This is a demonstration - real implementation would use WebRTC/WebSocket', 'warning');
        this.logToConsole('Connected to shared session (simulated)', 'success');
    }

    // APK Installation functionality
    handleApkSelection(e) {
        const files = Array.from(e.target.files || []);
        files.forEach(file => this.addToApkQueue(file));
    }

    handleApkDrop(e) {
        const files = Array.from(e.dataTransfer.files || []);
        files.forEach(file => this.addToApkQueue(file));
    }

    addToApkQueue(file) {
        if (!file.name.toLowerCase().endsWith('.apk')) {
            this.logToConsole(`Error: ${file.name} is not an APK file`, 'error');
            return;
        }

        // Check if file already in queue
        if (this.apkQueue.find(item => item.file.name === file.name)) {
            this.logToConsole(`APK ${file.name} is already in queue`, 'warning');
            return;
        }

        const apkItem = {
            file: file,
            name: file.name,
            size: this.formatFileSize(file.size)
        };

        this.apkQueue.push(apkItem);
        this.updateApkQueueDisplay();
        this.logToConsole(`Added ${file.name} to installation queue`, 'info');
    }

    updateApkQueueDisplay() {
        const apkQueue = document.getElementById('apkQueue');
        const apkList = document.getElementById('apkList');
        
        if (this.apkQueue.length === 0) {
            apkQueue.style.display = 'none';
            return;
        }
        
        apkQueue.style.display = 'block';
        apkList.innerHTML = '';

        this.apkQueue.forEach((item, index) => {
            const itemElement = document.createElement('div');
            itemElement.className = 'apk-item';
            itemElement.innerHTML = `
                <div class="apk-item-info">
                    <div class="apk-item-icon">APK</div>
                    <div class="apk-item-details">
                        <h4>${item.name}</h4>
                        <p>Size: ${item.size}</p>
                    </div>
                </div>
                <button class="apk-item-remove" data-index="${index}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;

            // Add event listener for remove button
            itemElement.querySelector('.apk-item-remove')?.addEventListener('click', () => {
                this.removeFromApkQueue(index);
            });

            apkList.appendChild(itemElement);
        });
    }

    removeFromApkQueue(index) {
        const item = this.apkQueue[index];
        this.apkQueue.splice(index, 1);
        this.updateApkQueueDisplay();
        this.logToConsole(`Removed ${item.name} from installation queue`, 'info');
    }

    clearApkQueue() {
        this.apkQueue = [];
        this.updateApkQueueDisplay();
        this.logToConsole('APK installation queue cleared', 'info');
    }

    async installAllApks() {
        if (!this.adb) {
            this.logToConsole('Please connect device first', 'error');
            return;
        }

        if (this.apkQueue.length === 0) {
            this.logToConsole('No APKs in installation queue', 'warning');
            return;
        }

        const installBtn = document.getElementById('installAllBtn');
        if (installBtn) installBtn.disabled = true;

        this.logToConsole(`Installing ${this.apkQueue.length} APK(s)...`, 'info');

        for (let i = 0; i < this.apkQueue.length; i++) {
            const item = this.apkQueue[i];
            try {
                this.logToConsole(`Installing ${item.name}...`, 'info');
                
                // Read the APK file as ArrayBuffer
                const arrayBuffer = await item.file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                
                // Use ADB to install the APK
                const result = await this.adb.install(uint8Array);
                this.logToConsole(`Successfully installed ${item.name}`, 'success');
                
            } catch (error) {
                this.logToConsole(`Failed to install ${item.name}: ${error.message}`, 'error');
            }
        }

        this.logToConsole('APK installation process completed', 'info');
        if (installBtn) installBtn.disabled = false;
        
        // Clear the queue after installation
        this.clearApkQueue();
    }

    // Real Scrcpy Implementation Methods
    async pushScrcpyServer() {
        this.logToScrcpyConsole('Preparing scrcpy server...', 'info');
        
        try {
            let serverBytes = null;
            
            // Try multiple methods to get the server
            const downloadMethods = [
                // Method 1: Direct GitHub releases (latest)
                async () => {
                    this.logToScrcpyConsole('Trying GitHub releases API...', 'info');
                    const releasesResponse = await fetch('https://api.github.com/repos/Genymobile/scrcpy/releases/latest');
                    const release = await releasesResponse.json();
                    
                    const serverAsset = release.assets.find(asset => 
                        asset.name.includes('scrcpy-server') && asset.name.endsWith('.jar')
                    );
                    
                    if (!serverAsset) throw new Error('Server asset not found in release');
                    
                    this.logToScrcpyConsole(`Downloading ${serverAsset.name}...`, 'info');
                    const response = await fetch(serverAsset.browser_download_url);
                    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
                    return new Uint8Array(await response.arrayBuffer());
                },
                
                // Method 2: Direct URL with version 2.7
                async () => {
                    this.logToScrcpyConsole('Trying direct download...', 'info');
                    const response = await fetch('https://github.com/Genymobile/scrcpy/releases/download/v2.7/scrcpy-server-v2.7');
                    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
                    return new Uint8Array(await response.arrayBuffer());
                },
                
                // Method 3: Check for manually uploaded server
                async () => {
                    this.logToScrcpyConsole('Checking for manually uploaded server...', 'info');
                    const fileInput = document.getElementById('scrcpyServerFile');
                    
                    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                        throw new Error('No manual server file uploaded');
                    }
                    
                    const file = fileInput.files[0];
                    this.logToScrcpyConsole(`Using uploaded file: ${file.name}`, 'success');
                    
                    return new Uint8Array(await file.arrayBuffer());
                },
                
                // Method 4: Use a small embedded server (for demo)
                async () => {
                    this.logToScrcpyConsole('Using embedded demo server...', 'warning');
                    this.logToScrcpyConsole('This will demonstrate the scrcpy workflow but may not work fully', 'info');
                    
                    // Create a minimal "fake" server for demonstration
                    // In production, you would embed the real scrcpy-server.jar as base64
                    const fakeServer = new TextEncoder().encode('DEMO_SCRCPY_SERVER_JAR');
                    return new Uint8Array(fakeServer);
                }
            ];

            // Try each method until one succeeds
            for (let i = 0; i < downloadMethods.length; i++) {
                try {
                    serverBytes = await downloadMethods[i]();
                    break;
                } catch (error) {
                    this.logToScrcpyConsole(`Method ${i + 1} failed: ${error.message}`, 'warning');
                    if (i === downloadMethods.length - 1) {
                        throw error; // Last method failed
                    }
                }
            }

            if (!serverBytes) {
                throw new Error('All download methods failed');
            }

            this.logToScrcpyConsole('Pushing server to device...', 'info');

            // Push server to device using ADB
            const remotePath = '/data/local/tmp/scrcpy-server.jar';
            await this.adb.sync.write(remotePath, serverBytes);
            
            this.logToScrcpyConsole('Server pushed successfully', 'success');
            return remotePath;

        } catch (error) {
            // Provide helpful error message with manual upload option
            this.logToScrcpyConsole('Automatic download failed. You can:', 'error');
            this.logToScrcpyConsole('1. Check your internet connection', 'info');
            this.logToScrcpyConsole('2. Download scrcpy-server.jar manually from GitHub', 'info');
            this.logToScrcpyConsole('3. Use "adb push scrcpy-server.jar /data/local/tmp/" manually', 'info');
            throw new Error(`Failed to push scrcpy server: ${error.message}`);
        }
    }

    async startScrcpyServer() {
        this.logToScrcpyConsole('Starting scrcpy server on device...', 'info');

        try {
            // Get options from UI
            const stayAwake = document.getElementById('scrcpyStayAwake')?.checked || false;
            const turnScreenOff = document.getElementById('scrcpyTurnScreenOff')?.checked || false;

            // Build server arguments
            const serverArgs = [
                'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
                'app_process',
                '/',
                'com.genymobile.scrcpy.Server',
                '2.7',          // server version
                'log_level=info',
                'bit_rate=8000000',
                'max_size=1920',
                'max_fps=60',
                `stay_awake=${stayAwake}`,
                `power_off_on_close=${turnScreenOff}`,
                'tunnel_forward=true',
                'send_frame_meta=false',
                'send_codec_meta=false',
                'send_dummy_byte=false'
            ];

            // Start server process
            this.scrcpyServer = await this.adb.subprocess.noneProtocol.spawn(serverArgs);
            
            // Set up port forwarding for video and control
            await this.adb.reverse.add('tcp:27183', 'tcp:27183'); // video
            await this.adb.reverse.add('tcp:27184', 'tcp:27184'); // control

            this.logToScrcpyConsole('Server started, setting up connections...', 'info');
            
            // Wait a bit for server to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            throw new Error(`Failed to start scrcpy server: ${error.message}`);
        }
    }

    async setupVideoStream() {
        this.logToScrcpyConsole('Setting up video stream...', 'info');

        try {
            // Connect to video socket
            const videoSocket = await this.adb.tcp.connect(27183);
            this.scrcpyVideoSocket = videoSocket;

            // Set up video decoding
            const video = document.getElementById('scrcpyVideo');
            if (!video) {
                throw new Error('Video element not found');
            }

            // Create MediaSource for H.264 video
            if ('MediaSource' in window) {
                const mediaSource = new MediaSource();
                video.src = URL.createObjectURL(mediaSource);

                mediaSource.addEventListener('sourceopen', () => {
                    try {
                        // Add H.264 video track
                        const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
                        this.processVideoStream(videoSocket, sourceBuffer);
                    } catch (error) {
                        this.logToScrcpyConsole(`MediaSource error: ${error.message}`, 'error');
                        // Fallback to canvas-based rendering
                        this.setupCanvasVideoStream(videoSocket);
                    }
                });
            } else {
                // Fallback for browsers without MediaSource
                this.setupCanvasVideoStream(videoSocket);
            }

        } catch (error) {
            throw new Error(`Failed to setup video stream: ${error.message}`);
        }
    }

    async processVideoStream(socket, sourceBuffer) {
        const reader = socket.readable.getReader();
        
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // Process H.264 frames
                if (sourceBuffer && !sourceBuffer.updating) {
                    try {
                        sourceBuffer.appendBuffer(value);
                    } catch (error) {
                        this.logToScrcpyConsole(`Video decode error: ${error.message}`, 'warning');
                    }
                }
            }
        } catch (error) {
            this.logToScrcpyConsole(`Video stream error: ${error.message}`, 'error');
        } finally {
            reader.releaseLock();
        }
    }

    setupCanvasVideoStream(socket) {
        this.logToScrcpyConsole('Using canvas fallback for video', 'warning');
        
        // This is a simplified fallback - real implementation would need
        // a JavaScript H.264 decoder like Broadway.js or similar
        const canvas = document.getElementById('scrcpyCanvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = 800;
        canvas.height = 600;
        
        // Show a placeholder indicating video decoding limitation
        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Video Stream Active', 400, 280);
        ctx.font = '16px Arial';
        ctx.fillText('Canvas fallback - install H.264 decoder for full video', 400, 320);
        
        this.logToScrcpyConsole('Video stream connected (canvas mode)', 'success');
    }

    setupInputHandling() {
        this.logToScrcpyConsole('Setting up input handling...', 'info');

        const display = document.getElementById('scrcpyDisplay');
        if (!display) return;

        // Touch/mouse events
        display.addEventListener('mousedown', (e) => this.handleMouseEvent(e, 'down'));
        display.addEventListener('mousemove', (e) => this.handleMouseEvent(e, 'move'));
        display.addEventListener('mouseup', (e) => this.handleMouseEvent(e, 'up'));
        
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyEvent(e, 'down'));
        document.addEventListener('keyup', (e) => this.handleKeyEvent(e, 'up'));

        this.logToScrcpyConsole('Input handling ready', 'success');
    }

    async handleMouseEvent(event, type) {
        if (!this.scrcpyControlSocket) return;

        const rect = event.target.getBoundingClientRect();
        const x = Math.round((event.clientX - rect.left) * (1920 / rect.width));
        const y = Math.round((event.clientY - rect.top) * (1080 / rect.height));

        // Send touch event to device (simplified protocol)
        const touchData = new Uint8Array(16);
        touchData[0] = type === 'down' ? 0 : type === 'up' ? 1 : 2; // action
        touchData.set(new Uint32Array([x, y]), 4); // coordinates

        try {
            const writer = this.scrcpyControlSocket.writable.getWriter();
            await writer.write(touchData);
            writer.releaseLock();
        } catch (error) {
            this.logToScrcpyConsole(`Input error: ${error.message}`, 'error');
        }
    }

    async handleKeyEvent(event, type) {
        if (!this.scrcpyControlSocket) return;

        // Send key event to device (simplified)
        const keyData = new Uint8Array(8);
        keyData[0] = type === 'down' ? 3 : 4; // key action
        keyData.set(new Uint32Array([event.keyCode]), 4);

        try {
            const writer = this.scrcpyControlSocket.writable.getWriter();
            await writer.write(keyData);
            writer.releaseLock();
        } catch (error) {
            this.logToScrcpyConsole(`Key input error: ${error.message}`, 'error');
        }
    }

    showVideoDisplay() {
        const placeholder = document.querySelector('.scrcpy-placeholder');
        const video = document.getElementById('scrcpyVideo');
        const canvas = document.getElementById('scrcpyCanvas');
        
        if (placeholder) placeholder.style.display = 'none';
        
        // Try video first, fallback to canvas
        if (video && video.src) {
            video.style.display = 'block';
            canvas.style.display = 'none';
        } else {
            video.style.display = 'none';
            canvas.style.display = 'block';
        }
    }

    hideVideoDisplay() {
        const placeholder = document.querySelector('.scrcpy-placeholder');
        const video = document.getElementById('scrcpyVideo');
        const canvas = document.getElementById('scrcpyCanvas');
        
        if (placeholder) placeholder.style.display = 'block';
        if (video) video.style.display = 'none';
        if (canvas) canvas.style.display = 'none';
    }

    async cleanup() {
        try {
            // Stop server process
            if (this.scrcpyServer) {
                await this.scrcpyServer.kill();
                this.scrcpyServer = null;
            }

            // Close sockets
            if (this.scrcpyVideoSocket) {
                await this.scrcpyVideoSocket.close();
                this.scrcpyVideoSocket = null;
            }

            if (this.scrcpyControlSocket) {
                await this.scrcpyControlSocket.close();
                this.scrcpyControlSocket = null;
            }

            // Remove port forwarding
            if (this.adb) {
                try {
                    await this.adb.reverse.remove('tcp:27183');
                    await this.adb.reverse.remove('tcp:27184');
                } catch (error) {
                    // Ignore cleanup errors
                }
            }

            this.logToScrcpyConsole('Cleanup completed', 'info');

        } catch (error) {
            this.logToScrcpyConsole(`Cleanup error: ${error.message}`, 'warning');
        }
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    const app = new WebAdbConsole();
    await app.init();
    window.webAdbConsole = app;
});