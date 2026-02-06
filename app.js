// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyAwblwsgX1V3pOvb94icZn40V5FDfechSQ",
    authDomain: "final-year-tracker.firebaseapp.com",
    projectId: "final-year-tracker",
    storageBucket: "final-year-tracker.firebasestorage.app",
    messagingSenderId: "825304572249",
    appId: "1:825304572249:web:f54f9db269f9fdbe3eac48",
    measurementId: "G-J5C7828VRQ"
};

let db = null;
let auth = null;
let currentUser = null;

// Initialize Firebase
try {
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        console.log("Firebase initialized");
    }
} catch (e) {
    console.log("Firebase config error:", e);
}

// --- STATE MANAGEMENT ---

const GUEST_KEY_PREFIX = "mbbs_guest";

let state = {
    userName: "Doctor",
    questions: QUESTIONS_DATA,
    progress: {},
    dailyLogs: {},
    activeSubject: Object.keys(QUESTIONS_DATA)[0]
};

// --- DOM ELEMENTS ---
const subjectNav = document.getElementById('subjectNav');
const explorer = document.getElementById('questionExplorer');
// const activeSubjectDisplay = document.getElementById('activeSubjectName'); // Moved to renderApp
// const distributionChartCtx = document.getElementById('distributionChart').getContext('2d'); // Moved to updateCharts
const loginBtn = document.getElementById('loginBtn');
let distributionChart;
let dailyChart;

// --- STORAGE ENGINE ---

function getStorageKey(type) {
    // If logged in, use UID. If not, use GUEST prefix.
    const suffix = currentUser ? currentUser.uid : "GUEST";
    return `mbbs_${type}_${suffix}`;
}

function loadLocalState() {
    const progressKey = getStorageKey('progress');
    const logsKey = getStorageKey('logs');

    console.log(`Loading state from: ${progressKey}`);

    try {
        state.progress = JSON.parse(localStorage.getItem(progressKey)) || {};
        state.dailyLogs = JSON.parse(localStorage.getItem(logsKey)) || {};
    } catch (e) {
        console.error("Error loading state", e);
        state.progress = {};
        state.dailyLogs = {};
    }
}

function saveLocalState() {
    const progressKey = getStorageKey('progress');
    const logsKey = getStorageKey('logs');

    localStorage.setItem(progressKey, JSON.stringify(state.progress));
    localStorage.setItem(logsKey, JSON.stringify(state.dailyLogs));
}

async function syncWithCloud() {
    if (!db || !currentUser) return;

    try {
        const docRef = db.collection('users').doc(currentUser.uid);
        const doc = await docRef.get();

        if (doc.exists) {
            const cloudData = doc.data();

            // CLOUD WINS on conflict to ensure consistency across devices
            // But we can merge if needed. For now, let's treat Cloud as Truth if it exists.
            if (cloudData.progress) { // Simple check
                console.log("Cloud data found. Overwriting local cache.");
                state.progress = cloudData.progress || {};
                state.dailyLogs = cloudData.dailyLogs || {};
                saveLocalState(); // Update the UID-specific local cache
            }
        } else {
            // New cloud user -> Push what we have (which effectively starts them empty or with implied state)
            console.log("Creating new cloud record.");
            await pushToCloud();
        }
    } catch (e) {
        console.error("Cloud sync failed:", e);
    }
}

async function pushToCloud() {
    if (!db || !currentUser) return;
    try {
        await db.collection('users').doc(currentUser.uid).set({
            progress: state.progress,
            dailyLogs: state.dailyLogs,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("Push failed:", e);
    }
}

// --- CORE APP ---

function init() {
    // Initial Load (Defaults to GUEST until Auth loads)
    loadLocalState();
    renderApp();

    // setup Auth Listener
    if (auth) {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                // SWITCH TO USER CONTEXT
                console.log(`Auth Switch: ${user.email}`);
                currentUser = user;

                updateUserUI(user);

                // 1. Load Local Cache for this UID immediately (fast)
                loadLocalState();
                renderApp();

                // 2. Fetch fresh data from Cloud (async)
                await syncWithCloud();
                renderApp();

            } else {
                // SWITCH TO GUEST CONTEXT
                console.log("Auth Switch: Guest");
                currentUser = null;

                updateGuestUI();

                // Load Guest Data
                loadLocalState();
                renderApp();
            }
        });
    }

    if (loginBtn) {
        // Remove old listeners by cloning
        const newBtn = loginBtn.cloneNode(true);
        loginBtn.parentNode.replaceChild(newBtn, loginBtn);

        // Re-select
        const btn = document.getElementById('loginBtn');
        btn.onclick = handleAuthClick;
    }
}

function handleAuthClick() {
    if (currentUser) {
        // Logout
        auth.signOut().then(() => {
            // State reload happens in onAuthStateChanged
        });
    } else {
        // Login
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(e => alert(e.message));
    }
}

function updateUserUI(user) {
    const btn = document.getElementById('loginBtn');
    btn.innerText = "Logout";
    btn.style.background = "#10b981"; // Success Green
    document.getElementById('userNameDisplay').innerText = `Hi, ${user.displayName.split(' ')[0]}`;
}

function updateGuestUI() {
    const btn = document.getElementById('loginBtn');
    btn.innerText = "Login / Sync";
    btn.style.background = "var(--primary)";
    document.getElementById('userNameDisplay').innerText = "Welcome, Doctor";
}

function renderApp() {
    // 1. Update Header (Safe)
    const activeSubjectDisplay = document.getElementById('activeSubjectName');
    if (activeSubjectDisplay) {
        activeSubjectDisplay.innerText = state.activeSubject;
        console.log("Updated Subject Header:", state.activeSubject);
    } else {
        console.warn("activeSubjectName element not found!");
    }

    renderSubjectNav();
    updateStats();
    renderQuestions(state.activeSubject);
    try {
        updateCharts();
    } catch (e) {
        console.error("Chart Error:", e);
    }
}

// --- RENDERING LOGIC (Shared) ---

function renderSubjectNav() {
    subjectNav.innerHTML = '';
    Object.keys(state.questions).forEach(subject => {
        const btn = document.createElement('button');
        btn.className = `subject-btn ${state.activeSubject === subject ? 'active' : ''}`;
        btn.innerText = subject;
        btn.onclick = () => {
            state.activeSubject = subject;
            renderApp(); // Redraw everything on subject switch
        };
        subjectNav.appendChild(btn);
    });
}

function renderQuestions(subject) {
    if (!state.questions[subject]) return;
    explorer.innerHTML = '';
    const subjectData = state.questions[subject];

    Object.keys(subjectData).forEach(chapter => {
        // ... (Logic to count completion) ... 
        // Re-implementing logic to ensure cleanliness
        let html = '';
        let hasQ = false;
        let hyEssay = 0, hySn = 0;

        ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(type => {
            // Create a safe copy before sorting to avoid potential reference issues
            const list = [...(state.questions[subject][chapter][type] || [])];

            // STRICT SORT: High Frequency -> Low Frequency
            list.sort((a, b) => {
                const fA = parseInt(a.frequency) || 0;
                const fB = parseInt(b.frequency) || 0;
                return fB - fA; // Descending
            });

            if (list.length > 0) hasQ = true;

            list.forEach(q => {
                if (q.frequency >= 2) {
                    if (type === "ESSAY") hyEssay++;
                    if (type === "SHORT NOTES") hySn++;
                }
                const isDone = state.progress[q.id] || false;
                const typeClass = type === "ESSAY" ? 'essay' : '';
                const freqClass = q.frequency >= 3 ? 'high' : (q.frequency === 2 ? 'med' : '');

                html += `
                    <div class="question-card ${isDone ? 'done' : ''} ${typeClass}" onclick="toggleQuestion('${q.id}', event)">
                        <div class="q-checkbox">${isDone ? '✓' : ''}</div>
                        <div class="q-content">
                            <p class="q-text">${q.text}</p>
                            <div class="q-meta">
                                <span class="q-freq ${freqClass}">Asked ${q.frequency}x</span>
                            </div>
                        </div>
                        <span class="q-type-badge ${typeClass}">${type}</span>
                    </div>
                 `;
            });
        });

        if (hasQ) {
            const div = document.createElement('div');
            div.className = 'chapter-section';
            div.innerHTML = `
                <div class="chapter-header" onclick="this.classList.toggle('active')">
                    <div class="chapter-title-group">
                        <h3 class="chapter-title" style="font-size: 1.1rem;">${chapter}</h3>
                         <div style="display: flex; gap: 0.5rem; margin-left: 0.5rem;">
                            ${hyEssay > 0 ? `<span class="chapter-q-count essay">${hyEssay} Essay HY</span>` : ''}
                            ${hySn > 0 ? `<span class="chapter-q-count sn">${hySn} SN HY</span>` : ''}
                        </div>
                    </div>
                    <i data-lucide="chevron-down" class="chevron"></i>
                </div>
                <div class="chapter-content">
                    <div class="question-grid">${html}</div>
                </div>
            `;
            explorer.appendChild(div);
        }
    });
    lucide.createIcons();
}

window.toggleQuestion = function (id, event) {
    if (event) event.stopPropagation();

    // Toggle
    state.progress[id] = !state.progress[id];

    // Daily Log logic
    const today = new Date().toISOString().split('T')[0];
    if (!state.dailyLogs[today]) state.dailyLogs[today] = 0;
    state.progress[id] ? state.dailyLogs[today]++ : state.dailyLogs[today]--;
    if (state.dailyLogs[today] < 0) state.dailyLogs[today] = 0;

    // Save Immediately
    saveLocalState();
    pushToCloud(); // Fire & Forget sync

    // UI Update (Partial)
    const card = document.querySelector(`[onclick*="${id}"]`);
    if (card) {
        card.classList.toggle('done');
        card.querySelector('.q-checkbox').innerText = state.progress[id] ? '✓' : '';
    }
    updateStats();
    updateCharts();
}

function updateStats() {
    const s = state.activeSubject;
    let totalW = 0, earnedW = 0;
    let essayT = 0, essayD = 0;
    let snT = 0, snD = 0;
    let qTotal = 0, qDone = 0;

    Object.keys(state.questions[s]).forEach(c => {
        ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(t => {
            const weight = t === "ESSAY" ? 5 : 1;
            (state.questions[s][c][t] || []).forEach(q => {
                if (q.frequency < 2) return;
                totalW += weight;
                qTotal++;
                if (state.progress[q.id]) {
                    earnedW += weight;
                    qDone++;
                }

                if (t === "ESSAY") {
                    essayT++;
                    if (state.progress[q.id]) essayD++;
                } else if (t === "SHORT NOTES") {
                    snT++;
                    if (state.progress[q.id]) snD++;
                }
            });
        });
    });

    const getPct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

    document.getElementById('overallCompletion').innerText = `${getPct(earnedW, totalW)}%`;
    document.getElementById('subjectProgress').innerText = `Weighted Score: ${earnedW} / ${totalW}`;

    document.getElementById('essayCompletion').innerText = `${getPct(essayD, essayT)}%`;
    const el1 = document.getElementById('essayCompletion').nextElementSibling;
    if (el1) el1.innerText = `(${essayD} / ${essayT} Essays)`;

    document.getElementById('snCompletion').innerText = `${getPct(snD, snT)}%`;
    const el2 = document.getElementById('snCompletion').nextElementSibling;
    if (el2) el2.innerText = `(${snD} / ${snT} Short Notes)`;

    document.getElementById('totalQProgress').innerText = `${qDone} / ${qTotal} Questions Done`;
}

function updateCharts() {
    // Re-use existing chart logic structure but simpler
    const subjects = Object.keys(state.questions);
    const data = subjects.map(s => {
        let tw = 0, ew = 0;
        Object.keys(state.questions[s]).forEach(c => {
            ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(t => {
                const w = t === "ESSAY" ? 5 : 1;
                (state.questions[s][c][t] || []).forEach(q => {
                    if (q.frequency < 2) return;
                    tw += w;
                    if (state.progress[q.id]) ew += w;
                });
            });
        });
        return tw > 0 ? parseFloat(((ew / tw) * 100).toFixed(2)) : 0;
    });

    if (distributionChart) distributionChart.destroy();

    // Get context safely
    const distCanvas = document.getElementById('distributionChart');
    if (distCanvas) {
        const distributionChartCtx = distCanvas.getContext('2d');
        // Register Plugin - REMOVED for stability
        // Chart.register(ChartDataLabels);

        distributionChart = new Chart(distributionChartCtx, {
            type: 'bar',
            data: {
                labels: subjects.map(s => s.replace('GENERAL ', '')),
                datasets: [{
                    label: 'Completion %',
                    data: data,
                    backgroundColor: ['#6366f1', '#a855f7', '#22d3ee', '#10b981', '#f59e0b'],
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { max: 100 } },
                plugins: { legend: { display: false } }
            }
        });

    }

    // Daily Chart logic omitted for brevity but follows same pattern...
    // Just rendering empty or simple if needed to save space
    // --- DAILY CHART LOGIC (ROBUST) ---
    const dCtx = document.getElementById('dailyChart');
    if (dCtx) {
        const ctx = dCtx.getContext('2d');
        if (dailyChart) dailyChart.destroy();

        // 1. Generate Last 7 Days (Fixed X-Axis)
        // This ensures the chart ALWAYS shows a week, even if data is empty.
        const last7Days = [...Array(7)].map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toISOString().split('T')[0]; // "2024-02-05"
        });

        // 2. Map Data to these dates
        // If no log exists for a date, default to 0.
        const dataValues = last7Days.map(date => state.dailyLogs[date] || 0);

        // 3. Format Labels (e.g., "02/05")
        const labels = last7Days.map(d => d.split('-').slice(1).join('/'));

        dailyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Questions Solved',
                    data: dataValues,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#6366f1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { display: false }
                    }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
            }
        });
    }
}

document.getElementById('resetProgress').onclick = () => {
    if (confirm("Strict Reset: This wipes LOCAL data for this user context.")) {
        state.progress = {};
        state.dailyLogs = {};
        saveLocalState();
        pushToCloud();
        renderApp();
    }
}

// Start
init();
