// ==========================================
// 1. WEBSOCKET SETUP
// ==========================================
// Determine the WebSocket URL dynamically
// If deployed to Vercel, it uses the production backend URL (e.g., Render/Railway)
// If running locally, it defaults to localhost
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BACKEND_WS_URL = isLocalhost 
    ? 'ws://localhost:8080' 
    : 'wss://your-production-backend-url.onrender.com'; // REPLACE THIS LATER

const ws = new WebSocket(BACKEND_WS_URL);

const statusDot = document.getElementById('ws-status-dot');
const statusText = document.getElementById('ws-status-text');

ws.onopen = () => {
    statusDot.className = 'dot connected';
    statusText.innerText = 'Connected';
    logEvent('System', 'Connected to WebSocket Data Stream');
};

ws.onclose = () => {
    statusDot.className = 'dot disconnected';
    statusText.innerText = 'Disconnected - Retrying...';
    // Auto-reconnect roughly every 5 seconds if connection is lost
    setTimeout(() => {
        window.location.reload();
    }, 5000);
};

// ==========================================
// 2. CHART.JS CONFIGURATION
// ==========================================
const ctx = document.getElementById('powerChart').getContext('2d');
const powerChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], // Timestamps
        datasets: [{
            label: 'Power (W)',
            data: [], // Live Wattage values
            borderColor: '#3b82f6', // Default Blue
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            borderWidth: 2,
            tension: 0.1, // Smooth curves
            fill: true,
            pointRadius: 2,
            pointBackgroundColor: '#3b82f6'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 }, // Disable animation so live data doesn't "lag" visually
        scales: {
            x: { title: { display: true, color: '#94a3b8', text: 'Time' }, ticks: { color: '#94a3b8' } },
            y: { title: { display: true, color: '#94a3b8', text: 'Watts' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
        },
        plugins: {
            legend: { display: false }
        }
    }
});

// ==========================================
// 2B. TRENDS CHART (HISTORICAL)
// ==========================================
// Tariff Configurations (Loaded from LocalStorage or Defaults)
let tariffConfig = {
    currency: localStorage.getItem('tariffCurrency') || '$',
    unitRate: parseFloat(localStorage.getItem('tariffUnitRate')) || 0.12,
    fixedCharge: parseFloat(localStorage.getItem('tariffFixedCharge')) || 5.00,
    taxRate: parseFloat(localStorage.getItem('tariffTaxRate')) || 5.0,
    dailyBudget: parseFloat(localStorage.getItem('tariffDailyBudget')) || 2.00
};

const trendsCtx = document.getElementById('trendsChart').getContext('2d');
const pastKWhData = [14.2, 12.5, 15.0, 11.2, 13.8, 16.5]; // Mock data Mon-Sat

const trendsChart = new Chart(trendsCtx, {
    type: 'bar',
    data: {
        labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Yesterday', 'Today'],
        datasets: [
            {
                label: 'Energy (kWh)',
                data: [...pastKWhData, 0],
                backgroundColor: 'rgba(59, 130, 246, 0.8)', // Blue
                borderRadius: 4,
                yAxisID: 'y'
            },
            {
                label: 'Cost ($)',
                data: [0, 0, 0, 0, 0, 0, 0], // Will be calculated dynamically below
                backgroundColor: 'rgba(34, 197, 94, 0.8)',  // Green
                borderRadius: 4,
                yAxisID: 'y1'
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                type: 'linear', display: true, position: 'left',
                title: { display: true, color: '#94a3b8', text: 'Energy (kWh)' },
                ticks: { color: '#94a3b8' }
            },
            y1: {
                type: 'linear', display: true, position: 'right',
                title: { display: true, color: '#94a3b8', text: 'Cost' },
                ticks: { color: '#94a3b8' },
                grid: { drawOnChartArea: false }
            },
            x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(255,255,255,0.05)' }
            }
        },
        plugins: {
            legend: { labels: { color: '#f8fafc' } }
        }
    }
});

function recalcPastCosts() {
    trendsChart.data.datasets[1].label = `Cost (${tariffConfig.currency})`;
    for (let i = 0; i < pastKWhData.length; i++) {
        let baseCost = pastKWhData[i] * tariffConfig.unitRate;
        let tax = baseCost * (tariffConfig.taxRate / 100);
        let fixed = tariffConfig.fixedCharge / 30;
        trendsChart.data.datasets[1].data[i] = baseCost + tax + fixed;
    }
    trendsChart.update();
}

// Initial calculation on load
recalcPastCosts();

// ==========================================
// 3. UI STATE & ELEMENTS
// ==========================================
let previousPower = null;
const powerValueEl = document.getElementById('power-value');
const voltageValueEl = document.getElementById('voltage-value');
const currentValueEl = document.getElementById('current-value');
const batteryLevelEl = document.getElementById('battery-level');
const logList = document.getElementById('log-list');
const spikeAlert = document.getElementById('spike-alert');

// Financial UI Elements
const costHourlyEl = document.getElementById('cost-hourly');
const costMonthlyEl = document.getElementById('cost-monthly');
const settingsModal = document.getElementById('settings-modal');

// Budget UI Elements
const budgetCurrentEl = document.getElementById('budget-current');
const budgetMaxEl = document.getElementById('budget-max');
const budgetBarFillEl = document.getElementById('budget-bar-fill');
const budgetStatusTextEl = document.getElementById('budget-status-text');

// The maximum wattage that brings the "Battery UI" to 100% full.
const MAX_POWER_SCALE = 200; 

// ==========================================
// 4. INCOMING DATA HANDLER
// ==========================================
ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        
        // Intercept System Mode changes
        if (data.type === 'MODE_SYNC') {
            updateModeUI(data.mode);
            return;
        }

        if (data.power === undefined) return;
        
        handleNewData(data.power, data.voltage, data.current, data.mockState);
    } catch(err) {
        console.error("Invalid JSON:", event.data);
    }
};

function handleNewData(power, voltage, current, mockState) {
    // --- A. Update Text Stats ---
    powerValueEl.innerText = power.toFixed(1);
    voltageValueEl.innerText = voltage.toFixed(1) + ' V';
    currentValueEl.innerText = current.toFixed(2) + ' A';

    // --- B. Battery Load Indicator Logic ---
    let fillPercent = (power / MAX_POWER_SCALE) * 100;
    if (fillPercent > 100) fillPercent = 100;
    batteryLevelEl.style.height = `${fillPercent}%`; // Animate fluid rising

    // Color shifting based on load severity
    if (power < 50) {
        batteryLevelEl.style.backgroundColor = 'var(--bat-low)'; // Green
    } else if (power < 120) {
        batteryLevelEl.style.backgroundColor = 'var(--bat-med)'; // Yellow
    } else {
        batteryLevelEl.style.backgroundColor = 'var(--bat-high)';// Red
    }

    // --- C. Spike & Device Inference Logic ---
    if (previousPower !== null) {
        let delta = power - previousPower;

        // NOISE FILTER: Ignore tiny fluctuations (< 5W)
        if (Math.abs(delta) > 5) {
            
            // Spike Alert Popup (if power jumps more than 14W instantly)
            if (delta > 14) {
                spikeAlert.classList.remove('hidden');
                setTimeout(() => spikeAlert.classList.add('hidden'), 2000);
            }
            
            // Inference Logic (Guessing what turned on based on Wattage signature)
            if (delta >= 10 && delta < 30) {
                 logEvent('Inference (+)', 'Small Device / Bulb turned ON', delta);
            } else if (delta >= 30 && delta < 70) {
                 logEvent('Inference (+)', 'Medium Device / Fan turned ON', delta);
            } else if (delta >= 70) {
                 logEvent('Inference (+)', 'Large Appliance turned ON', delta);
            } else if (delta <= -10 && delta > -30) {
                 logEvent('Inference (-)', 'Small Device / Bulb turned OFF', delta);
            } else if (delta <= -30) {
                 logEvent('Inference (-)', 'Medium/Large Appliance turned OFF', delta);
            }
        }
    }
    previousPower = power;

    // --- D. Update Chart.js ---
    const now = new Date();
    const timeLabel = now.getHours().toString().padStart(2, '0') + ':' + 
                      now.getMinutes().toString().padStart(2, '0') + ':' + 
                      now.getSeconds().toString().padStart(2, '0');

    powerChart.data.labels.push(timeLabel);
    powerChart.data.datasets[0].data.push(power);

    // Keep only the last 30 data points on the graph to prevent lag
    if (powerChart.data.labels.length > 30) {
        powerChart.data.labels.shift();
        powerChart.data.datasets[0].data.shift();
    }

    // Dynamic Chart color based on if power is dangerously high
    if (power > 120) {
         powerChart.data.datasets[0].borderColor = '#ef4444'; // Make graph red
         powerChart.data.datasets[0].backgroundColor = 'rgba(239, 68, 68, 0.2)';
    } else {
         powerChart.data.datasets[0].borderColor = '#3b82f6'; // Keep graph blue
         powerChart.data.datasets[0].backgroundColor = 'rgba(59, 130, 246, 0.2)';
    }

    powerChart.update();

    // --- E. Update Financial Impact Stats ---
    // 1. Live Hourly Cost = (Power / 1000) kW * Unit Rate
    const liveHourlyCost = (power / 1000) * tariffConfig.unitRate;
    costHourlyEl.innerText = `${tariffConfig.currency}${liveHourlyCost.toFixed(3)}/hr`;

    // 2. Estimated Monthly Bill = Extrapolating current power over 30 days
    const estimatedMonthlyKWh = (power / 1000) * 24 * 30;
    const baseEnergyCost = estimatedMonthlyKWh * tariffConfig.unitRate;
    const taxAmount = baseEnergyCost * (tariffConfig.taxRate / 100);
    const totalEstMonthly = tariffConfig.fixedCharge + baseEnergyCost + taxAmount;
    
    costMonthlyEl.innerText = `${tariffConfig.currency}${totalEstMonthly.toFixed(2)}`;

    // --- F. Update Gamified Daily Budget ---
    // Daily cost extrapolated
    const dailyFixed = tariffConfig.fixedCharge / 30;
    const dailyEnergy = (power / 1000) * 24 * tariffConfig.unitRate;
    const dailyTax = dailyEnergy * (tariffConfig.taxRate / 100);
    const projectedDailyCost = dailyFixed + dailyEnergy + dailyTax;

    budgetCurrentEl.innerText = `${tariffConfig.currency}${projectedDailyCost.toFixed(2)}`;
    budgetMaxEl.innerText = `/ ${tariffConfig.currency}${tariffConfig.dailyBudget.toFixed(2)}`;

    let budgetPercent = Math.min((projectedDailyCost / tariffConfig.dailyBudget) * 100, 100);
    budgetBarFillEl.style.width = `${budgetPercent}%`;

    if (budgetPercent < 60) {
        budgetBarFillEl.style.backgroundColor = '#22c55e'; // Green
        budgetStatusTextEl.innerText = '🟢 On Track';
        budgetStatusTextEl.style.color = '#4ade80';
    } else if (budgetPercent < 100) {
        budgetBarFillEl.style.backgroundColor = '#eab308'; // Yellow
        budgetStatusTextEl.innerText = '🟡 Approaching Limit';
        budgetStatusTextEl.style.color = '#fde047';
    } else {
        budgetBarFillEl.style.backgroundColor = '#ef4444'; // Red
        budgetStatusTextEl.innerText = '🔴 Budget Exceeded!';
        budgetStatusTextEl.style.color = '#f87171';
    }

    // --- G. Update Appliance Grid ---
    if (mockState) {
        renderApplianceGrid(mockState);
    }

    // --- H. Update Trends Chart ---
    const projectedDailyKWh = (power / 1000) * 24;
    trendsChart.data.datasets[0].data[6] = projectedDailyKWh;
    trendsChart.data.datasets[1].data[6] = projectedDailyCost;
    trendsChart.update();

    // 3. Compare Today vs Yesterday (Index 5 is Yesterday)
    let yesterdayCost = trendsChart.data.datasets[1].data[5];
    const trendComparisonEl = document.getElementById('trend-comparison');
    if (yesterdayCost > 0) {
        let diffPercent = ((projectedDailyCost - yesterdayCost) / yesterdayCost) * 100;
        if (diffPercent > 0) {
            trendComparisonEl.innerText = `↑ ${Math.abs(diffPercent).toFixed(1)}% More`;
            trendComparisonEl.style.color = '#ef4444'; // Red showing waste
        } else {
            trendComparisonEl.innerText = `↓ ${Math.abs(diffPercent).toFixed(1)}% Less`;
            trendComparisonEl.style.color = '#22c55e'; // Green showing savings
        }
    }
}

// ==========================================
// 5. EVENT LOGGER UI
// ==========================================
function logEvent(type, msg, delta = null) {
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString();
    
    // Formatting the (+15W) text if provided
    let deltaStr = delta !== null ? ` <span style="font-weight:bold; color:${delta > 0 ? '#ef4444' : '#22c55e'}">(${delta > 0 ? '+' : ''}${delta.toFixed(1)}W)</span>` : '';
    
    li.innerHTML = `<span class="log-time">[${time}]</span> <span><strong>${type}:</strong> ${msg}${deltaStr}</span>`;
    logList.prepend(li); // Add to top of list

    // Keep log to max 20 entries
    if(logList.children.length > 20) {
        logList.removeChild(logList.lastChild);
    }
}

// ==========================================
// 6. FRONTEND SIMULATION ACTIONS
// ==========================================
// Triggered by the buttons in the UI. Sends commands to Node backend.
function simulateDevice(action, id = '') {
    if(ws.readyState === WebSocket.OPEN) {
        ws.send(`SIMULATE:${action}:${id}`);
        console.log(`Simulation command sent: ${action}:${id}`);
    } else {
        alert("WebSocket not connected! Cannot send simulation command.");
    }
}

let lastRenderedState = "";
function renderApplianceGrid(mockState) {
    const gridEl = document.getElementById('appliances-grid');
    if (!gridEl) return;
    
    // Prevent useless re-renders if state hasn't changed
    const stateStr = JSON.stringify(mockState);
    if (stateStr === lastRenderedState) return;
    lastRenderedState = stateStr;

    gridEl.innerHTML = ''; // Clear loading/old state
    
    mockState.forEach(app => {
        const item = document.createElement('div');
        item.className = 'app-item';
        
        const countClass = app.count > 0 ? 'app-count active' : 'app-count';
        
        item.innerHTML = `
            <div class="app-info">
                <span class="app-title">${app.name}</span>
                <span class="app-power">${app.power}W</span>
            </div>
            <div class="app-controls">
                <button class="app-btn" onclick="simulateDevice('OFF', '${app.id}')">-</button>
                <span class="${countClass}">${app.count}</span>
                <button class="app-btn" onclick="simulateDevice('ON', '${app.id}')">+</button>
            </div>
        `;
        gridEl.appendChild(item);
    });
}

// ==========================================
// 7. TARIFF MODAL LOGIC
// ==========================================
document.getElementById('settings-btn').addEventListener('click', () => {
    // Populate form with current values
    document.getElementById('currency-symbol').value = tariffConfig.currency;
    document.getElementById('unit-rate').value = tariffConfig.unitRate;
    document.getElementById('fixed-charge').value = tariffConfig.fixedCharge;
    document.getElementById('tax-rate').value = tariffConfig.taxRate;
    document.getElementById('daily-budget').value = tariffConfig.dailyBudget;
    
    settingsModal.classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

document.getElementById('save-settings').addEventListener('click', () => {
    tariffConfig.currency = document.getElementById('currency-symbol').value;
    tariffConfig.unitRate = parseFloat(document.getElementById('unit-rate').value);
    tariffConfig.fixedCharge = parseFloat(document.getElementById('fixed-charge').value);
    tariffConfig.taxRate = parseFloat(document.getElementById('tax-rate').value);
    tariffConfig.dailyBudget = parseFloat(document.getElementById('daily-budget').value);

    // Save to local storage
    localStorage.setItem('tariffCurrency', tariffConfig.currency);
    localStorage.setItem('tariffUnitRate', tariffConfig.unitRate);
    localStorage.setItem('tariffFixedCharge', tariffConfig.fixedCharge);
    localStorage.setItem('tariffTaxRate', tariffConfig.taxRate);
    localStorage.setItem('tariffDailyBudget', tariffConfig.dailyBudget);

    settingsModal.classList.add('hidden');
    logEvent('Settings', 'Tariff configuration updated');
    
    // Recalculate historical bar chart money values with new tariff!
    recalcPastCosts();

    // Trigger an immediate UI update based on the last known power if we have it
    if (previousPower !== null) {
        // Just calling the logic part again to force a visual update
        // We simulate `voltage` and `current` parsing wouldn't matter for the finance part update,
        // but it's simpler to just let the next WebSocket packet update it naturally in 2 seconds.
    }
});

// ==========================================
// 8. REAL vs MOCK MODE TOGGLE
// ==========================================
function setMode(mode) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(`SET_MODE:${mode}`);
    } else {
        alert("WebSocket not connected! Cannot change mode.");
    }
}

function updateModeUI(mode) {
    const btnReal = document.getElementById('btn-mode-real');
    const btnMock = document.getElementById('btn-mode-mock');
    const simControls = document.getElementById('simulator-controls');

    if (mode === 'REAL') {
        btnReal.classList.add('active');
        btnMock.classList.remove('active');
        simControls.classList.add('disabled-section');
    } else {
        btnMock.classList.add('active');
        btnReal.classList.remove('active');
        simControls.classList.remove('disabled-section');
    }
}

