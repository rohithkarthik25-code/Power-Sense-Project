const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ==========================================
// SERVE FRONTEND (HTTP SERVER)
// ==========================================
// This serves the static files (index.html, style.css, script.js) to your browser 
// out of the 'frontend' directory.
app.use(express.static(path.join(__dirname, '../frontend')));

// ==========================================
// WEBSOCKET SERVER 
// ==========================================
// This handles real-time, bidirectional communication between the ESP32 and UI.
const wss = new WebSocket.Server({ port: 8080 });

console.log('✅ Backend server initialized.');
console.log('🌐 Dashboard UI: http://localhost:3000');
console.log('🔌 WebSocket Server: ws://localhost:8080');

// Global System State
const isBackendMock = process.argv.includes('--mock');
let systemMode = isBackendMock ? 'MOCK' : 'REAL';
let backendMockPower = 0.0;

// Virtual Home State
const appliances = [
    { id: 'bulb', name: '💡 LED Bulb', power: 10, count: 0 },
    { id: 'tube', name: '🔆 Tube Light', power: 20, count: 0 },
    { id: 'fan', name: '🌀 Ceiling Fan', power: 60, count: 0 },
    { id: 'tv', name: '📺 Television', power: 100, count: 0 },
    { id: 'pc', name: '🖥️ Desktop PC', power: 250, count: 0 },
    { id: 'fridge', name: '🧊 Refrigerator', power: 150, count: 0 },
    { id: 'wm', name: '🧺 Washing Machine', power: 500, count: 0 },
    { id: 'mixer', name: '🥤 Mixer Grinder', power: 500, count: 0 },
    { id: 'vacuum', name: '🧹 Vacuum Cleaner', power: 700, count: 0 },
    { id: 'microwave', name: '♨️ Microwave', power: 800, count: 0 },
    { id: 'iron', name: '👔 Electric Iron', power: 1000, count: 0 },
    { id: 'hairdryer', name: '💨 Hair Dryer', power: 1200, count: 0 },
    { id: 'ac', name: '❄️ Air Conditioner', power: 1500, count: 0 },
    { id: 'heater', name: '🛁 Water Heater', power: 2000, count: 0 }
];

function recalcPower() {
    backendMockPower = appliances.reduce((total, app) => total + (app.power * app.count), 0);
}

wss.on('connection', (ws) => {
    console.log('✨ New client connected! (Browser or ESP32)');

    // Instantly sync the current mode with new connections
    ws.send(JSON.stringify({ type: 'MODE_SYNC', mode: systemMode }));

    // When the server receives a message from ANY connected client
    ws.on('message', (message) => {
        const msg = message.toString();

        // 1. Handle UI Mode Changes
        if (msg.startsWith('SET_MODE:')) {
            systemMode = msg.split(':')[1];
            console.log(`[STATE] System mode changed to: ${systemMode}`);
            
            if (systemMode === 'REAL') {
                // Reset all mock appliances when returning to real mode
                appliances.forEach(app => app.count = 0);
                recalcPower();
            }

            // Sync all browsers viewing the dashboard
            const modePayload = JSON.stringify({ type: 'MODE_SYNC', mode: systemMode });
            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(modePayload);
            });
            return;
        }

        // 2. Handle simulation locally for frontend buttons
        if (msg.startsWith('SIMULATE:')) {
            if (systemMode !== 'MOCK') return; // Ignore if in REAL mode!

            const parts = msg.split(':');
            const action = parts[1]; // ON, OFF, RESET
            const id = parts[2];

            if (action === 'RESET') {
                appliances.forEach(app => app.count = 0);
            } else {
                const app = appliances.find(a => a.id === id);
                if (app) {
                    if (action === 'ON') app.count++;
                    if (action === 'OFF' && app.count > 0) app.count--;
                }
            }

            recalcPower();

            // Instantly push the new value to viewers so the UI reacts immediately to clicks
            const instantPayload = JSON.stringify({
                timestamp: Date.now(),
                power: backendMockPower,
                voltage: 220.0,
                current: backendMockPower > 0 ? (backendMockPower / 220.0) : 0,
                mockState: appliances
            });
            wss.clients.forEach((c) => {
                if (c.readyState === WebSocket.OPEN) c.send(instantPayload);
            });
            return; // done
        }

        // 3. Otherwise, assume it's data from the ESP32.
        // Broadcast the message to ALL OTHER connected clients ONLY if in REAL mode
        if (systemMode === 'REAL') {
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
        }
    });

    ws.on('close', () => {
        console.log('❌ Client disconnected');
    });
});

// ==========================================
// MOCK DATA GENERATOR
// ==========================================
// This interval loops to generate fake data. It now runs on standby
// and only broadcasts data if the UI has selected 'MOCK' mode.
console.log('🧪 Backend Mock Generator on standby.');
setInterval(() => {
    if (systemMode !== 'MOCK') return;

    const voltage = 220.0 + (Math.random() * 4 - 2);
    backendMockPower += Math.random() * 2 - 1; // minor 1W fluctuation
    if (backendMockPower < 0) backendMockPower = 0;
    const current = backendMockPower > 0 ? (backendMockPower / voltage) : 0;
    
    // Match the JSON schema of what the ESP32 would normally send
    const payload = JSON.stringify({
        timestamp: Date.now(),
        power: backendMockPower,
        voltage: voltage,
        current: current,
        mockState: appliances
    });

    // Push data to all browsers looking at the dashboard
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, 1000); // 1 second intervals

// Start HTTP server on port 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`📡 HTTP Server bound to port ${PORT}`);
});
