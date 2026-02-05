// --- FIREBASE CONFIGURATION ---
// 1. Go to https://console.firebase.google.com/
// 2. Click "Add Project" -> Name it "FinalYearTracker"
// 3. Disable Analytics (optional) -> Create Project
// 4. Click the Web icon (</>) -> Register app
// 5. Copy the 'firebaseConfig' object below and replace this placeholder:
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
let user = null;

// Initialize Firebase
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        console.log("Firebase initialized");
    }
} catch (e) {
    console.log("Firebase not configured yet.");
}

// State management
// State management
let state = {
    userName: "Doctor",
    questions: QUESTIONS_DATA,
    progress: {}, // Start EMPTY by default to prevent leaking
    dailyLogs: {},
    activeSubject: Object.keys(QUESTIONS_DATA)[0]
};

// Check local storage ONLY if we suspect a valid session, 
// but relying on Auth state is safer. 
// For now, we load it, but we might wipe it in init() if no user.
const savedProgress = JSON.parse(localStorage.getItem('mbbs_progress'));
if (savedProgress) state.progress = savedProgress;
const savedLogs = JSON.parse(localStorage.getItem('mbbs_daily_logs'));
if (savedLogs) state.dailyLogs = savedLogs;


// Selection DOM Elements
const subjectNav = document.getElementById('subjectNav');
const explorer = document.getElementById('questionExplorer');
const activeSubjectDisplay = document.getElementById('activeSubjectName');
const distributionChartCtx = document.getElementById('distributionChart').getContext('2d');
const loginBtn = document.getElementById('loginBtn');
let distributionChart;
let dailyChart;

// Initialize
function init() {
    renderSubjectNav();
    updateStats();
    renderQuestions(state.activeSubject);
    initCharts();

    // Setup Login Button
    if (loginBtn) {
        if (!auth) {
            loginBtn.innerText = "Setup Firebase Keys";
            loginBtn.onclick = () => alert("Please open app.js and paste your Firebase Config keys at the top!");
        } else {
            loginBtn.onclick = handleLogin;

            // Listen for auth state
            auth.onAuthStateChanged((u) => {
                if (u) {
                    user = u;
                    loginBtn.innerText = "Logout";
                    loginBtn.style.background = "#10b981"; // Green
                    document.getElementById('userNameDisplay').innerText = `Hi, ${u.displayName ? u.displayName.split(' ')[0] : 'Doc'}`;

                    // Logout Handler
                    loginBtn.onclick = () => {
                        auth.signOut().then(() => {
                            // Logic handled in else block
                        });
                    };
                    loadFromFirebase();
                } else {
                    // USER LOGGED OUT

                    // Force Wipe logic
                    console.log("Cleanup: Wiping data");
                    state.progress = {};
                    state.dailyLogs = {};
                    localStorage.removeItem('mbbs_progress');
                    localStorage.removeItem('mbbs_daily_logs');

                    // Force Update UI to reflect 0% IMMEDIATELY
                    updateStats();
                    renderQuestions(state.activeSubject);
                    updateCharts();

                    user = null;
                    loginBtn.innerText = "Login / Sync";
                    loginBtn.style.background = "var(--primary)";
                    loginBtn.onclick = handleLogin;
                }
            });
        }
    }
}

async function handleLogin() {
    if (!auth) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (e) {
        alert("Login failed: " + e.message);
    }
}

async function loadFromFirebase() {
    if (!db || !user) return;

    try {
        const docRef = db.collection('users').doc(user.uid);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();

            // STRICT ISOLATION: 
            // If cloud data exists, it OVERWRITES local data. 
            // This prevents "Guest User" data from merging into "Account B" data.
            if (data.progress && Object.keys(data.progress).length > 0) {
                state.progress = data.progress || {};
                state.dailyLogs = data.dailyLogs || {};
                saveLocal(); // Update local storage to match cloud
                console.log("Cloud data loaded (Local overwritten)");
            } else {
                // If Cloud is empty (New User), THEN we push local guest data
                console.log("New user detected, saving local data to cloud...");
                saveToFirebase();
            }

            // Update UI
            updateStats();
            updateCharts();
            renderQuestions(state.activeSubject);
        } else {
            // First time sync: push local to cloud
            saveToFirebase();
        }
    } catch (e) {
        console.error("Sync error:", e);
    }
}

async function saveToFirebase() {
    if (!db || !user) return;
    try {
        await db.collection('users').doc(user.uid).set({
            progress: state.progress,
            dailyLogs: state.dailyLogs,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("Save error:", e);
    }
}

function saveLocal() {
    localStorage.setItem('mbbs_progress', JSON.stringify(state.progress));
    localStorage.setItem('mbbs_daily_logs', JSON.stringify(state.dailyLogs));
}

function renderSubjectNav() {
    subjectNav.innerHTML = '';
    Object.keys(state.questions).forEach(subject => {
        const btn = document.createElement('button');
        btn.className = `subject-btn ${state.activeSubject === subject ? 'active' : ''}`;
        btn.innerText = subject;
        btn.onclick = () => {
            state.activeSubject = subject;
            document.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeSubjectDisplay.innerText = subject;
            renderQuestions(subject);
            updateStats();
        };
        subjectNav.appendChild(btn);
    });
}

function renderQuestions(subject) {
    if (!state.questions[subject]) return;

    explorer.innerHTML = '';
    const subjectData = state.questions[subject];

    Object.keys(subjectData).forEach(chapter => {
        let questionsHTML = '';
        let hasQuestions = false;
        let highYieldEssay = 0;
        let highYieldSN = 0;

        ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(type => {
            const list = [...(subjectData[chapter][type] || [])];
            list.sort((a, b) => b.frequency - a.frequency);

            if (list.length > 0) {
                hasQuestions = true;
                list.forEach(q => {
                    const isHighYield = q.frequency >= 2;
                    if (isHighYield) {
                        if (type === "ESSAY") highYieldEssay++;
                        else if (type === "SHORT NOTES") highYieldSN++;
                    }

                    const isDone = state.progress[q.id] || false;
                    const freqClass = q.frequency >= 3 ? 'high' : (q.frequency === 2 ? 'med' : '');
                    const typeClass = type === "ESSAY" ? 'essay' : '';

                    questionsHTML += `
                        <div class="question-card ${isDone ? 'done' : ''} ${typeClass}" onclick="toggleQuestion('${q.id}', event)">
                            <div class="q-checkbox">${isDone ? '✓' : ''}</div>
                            <div class="q-content">
                                <p class="q-text">${q.text}</p>
                                <div class="q-meta">
                                    <span class="q-freq ${freqClass}">Asked ${q.frequency}x</span>
                                    ${q.page ? `<span>Pg. ${q.page}</span>` : ''}
                                </div>
                            </div>
                            <span class="q-type-badge ${typeClass}">${type}</span>
                        </div>
                    `;
                });
            }
        });

        if (hasQuestions) {
            const chapterWrap = document.createElement('div');
            chapterWrap.className = 'chapter-section';
            chapterWrap.innerHTML = `
                <div class="chapter-header" onclick="this.classList.toggle('active')">
                    <div class="chapter-title-group">
                        <h3 class="chapter-title" style="font-size: 1.1rem;">${chapter}</h3>
                        <div style="display: flex; gap: 0.5rem; margin-left: 0.5rem;">
                            ${highYieldEssay > 0 ? `<span class="chapter-q-count essay">${highYieldEssay} Essay HY</span>` : ''}
                            ${highYieldSN > 0 ? `<span class="chapter-q-count sn">${highYieldSN} SN HY</span>` : ''}
                        </div>
                    </div>
                    <i data-lucide="chevron-down" class="chevron"></i>
                </div>
                <div class="chapter-content">
                    <div class="question-grid">
                        ${questionsHTML}
                    </div>
                </div>
            `;
            explorer.appendChild(chapterWrap);
        }
    });
    lucide.createIcons();
}

window.toggleQuestion = function (id, event) {
    if (event) event.stopPropagation();
    const wasDone = state.progress[id];
    state.progress[id] = !wasDone;

    const today = new Date().toISOString().split('T')[0];
    if (!state.dailyLogs[today]) state.dailyLogs[today] = 0;

    if (state.progress[id]) {
        state.dailyLogs[today]++;
    } else {
        state.dailyLogs[today] = Math.max(0, state.dailyLogs[today] - 1);
    }

    saveLocal();
    saveToFirebase(); // Sync to cloud

    const card = document.querySelector(`[onclick*="${id}"]`);
    if (card) {
        card.classList.toggle('done');
        card.querySelector('.q-checkbox').innerText = state.progress[id] ? '✓' : '';
    }

    updateStats();
    updateCharts();
};

function updateStats() {
    const s = state.activeSubject;
    if (!state.questions[s]) return;

    let subTotalWeight = 0;
    let subEarnedWeight = 0;
    let essayTotal = 0;
    let essayDone = 0;
    let snTotal = 0;
    let snDone = 0;
    let totalQuestions = 0;
    let totalDone = 0;

    Object.keys(state.questions[s]).forEach(c => {
        ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(t => {
            const weight = t === "ESSAY" ? 5 : 1;
            state.questions[s][c][t].forEach(q => {
                if (q.frequency < 2) return;

                totalQuestions++;
                subTotalWeight += weight;
                if (state.progress[q.id]) {
                    totalDone++;
                    subEarnedWeight += weight;
                }

                if (t === "ESSAY") {
                    essayTotal++;
                    if (state.progress[q.id]) essayDone++;
                } else if (t === "SHORT NOTES") {
                    snTotal++;
                    if (state.progress[q.id]) snDone++;
                }
            });
        });
    });

    const overallPct = subTotalWeight > 0 ? Math.round((subEarnedWeight / subTotalWeight) * 100) : 0;
    const essayPct = essayTotal > 0 ? Math.round((essayDone / essayTotal) * 100) : 0;
    const snPct = snTotal > 0 ? Math.round((snDone / snTotal) * 100) : 0;

    document.getElementById('overallCompletion').innerText = `${overallPct}%`;
    document.getElementById('subjectProgress').innerText = `Weighted Score: ${subEarnedWeight} / ${subTotalWeight}`;
    const essayVal = document.getElementById('essayCompletion');
    essayVal.innerText = `${essayPct}%`;
    if (essayVal.nextElementSibling) essayVal.nextElementSibling.innerText = `(${essayDone} / ${essayTotal} Essays)`;

    const snVal = document.getElementById('snCompletion');
    snVal.innerText = `${snPct}%`;
    if (snVal.nextElementSibling) snVal.nextElementSibling.innerText = `(${snDone} / ${snTotal} Short Notes)`;

    document.getElementById('totalQProgress').innerText = `${totalDone} / ${totalQuestions} Questions Done`;
}

function initCharts() {
    const subjects = Object.keys(state.questions);
    const completionData = subjects.map(s => {
        let subTotalWeight = 0;
        let subEarnedWeight = 0;
        Object.keys(state.questions[s]).forEach(c => {
            ["ESSAY", "SHORT NOTES", "SHORT ANSWERS"].forEach(t => {
                const weight = t === "ESSAY" ? 5 : 1;
                state.questions[s][c][t].forEach(q => {
                    if (q.frequency < 2) return;
                    subTotalWeight += weight;
                    if (state.progress[q.id]) subEarnedWeight += weight;
                });
            });
        });
        return subTotalWeight > 0 ? Math.round((subEarnedWeight / subTotalWeight) * 100) : 0;
    });

    if (distributionChart) distributionChart.destroy();
    distributionChart = new Chart(distributionChartCtx, {
        type: 'bar',
        data: {
            labels: subjects.map(s => s.replace('GENERAL ', '')),
            datasets: [{
                label: 'Weighted Completion %',
                data: completionData,
                backgroundColor: ['#6366f1', '#a855f7', '#22d3ee', '#10b981', '#f59e0b'],
                borderRadius: 12,
                barThickness: 25
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { weight: 'bold', size: 10 } } }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });

    const dailyCtx = document.getElementById('dailyChart').getContext('2d');
    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
    });
    const dailyData = last7Days.map(date => state.dailyLogs[date] || 0);

    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(dailyCtx, {
        type: 'line',
        data: {
            labels: last7Days.map(d => d.split('-').slice(1).join('/')),
            datasets: [{
                label: 'Questions Solved',
                data: dailyData,
                borderColor: '#6366f1',
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(99, 102, 241, 0.1)'
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } },
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function updateCharts() {
    initCharts();
}

document.getElementById('resetProgress').onclick = () => {
    if (confirm("Clear all progress?")) {
        state.progress = {};
        state.dailyLogs = {};
        saveLocal();
        saveToFirebase(); // Sync reset to cloud
        updateStats();
        renderQuestions(state.activeSubject);
        updateCharts();
    }
};

init();
