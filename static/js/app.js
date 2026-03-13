// ═══════════════════════════════════════════════════════════════
//  五十音道場 - Frontend Application
// ═══════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const mainContent = document.getElementById("mainContent");

// ─── API Helper ─────────────────────────────────────────────
async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
        headers: { "Content-Type": "application/json" },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
}

// ─── TTS (Text-to-Speech) ───────────────────────────────────
function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.8;
    const voices = speechSynthesis.getVoices();
    const jpVoice = voices.find(
        (v) => v.lang.startsWith("ja") && v.localService
    ) || voices.find((v) => v.lang.startsWith("ja"));
    if (jpVoice) u.voice = jpVoice;
    speechSynthesis.speak(u);
}
if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ─── Router ─────────────────────────────────────────────────
const router = {
    current: "home",
    navigate(view) {
        this.current = view;
        $$(".tab-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.view === view);
        });
        window.scrollTo(0, 0);
        switch (view) {
            case "home": renderHome(); break;
            case "chart": renderChart(); break;
            case "lesson": startNewLesson(); break;
            case "errors": renderErrors(); break;
            case "rank": renderRank(); break;
        }
    },
};

// ─── Tooltip ────────────────────────────────────────────────
let tooltipEl = null;
function initTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "tooltip";
        document.body.appendChild(tooltipEl);
    }
}
function showTooltip(e, text) {
    initTooltip();
    tooltipEl.textContent = text;
    tooltipEl.style.display = "block";
    tooltipEl.style.left = e.clientX + 12 + "px";
    tooltipEl.style.top = e.clientY - 40 + "px";
}
function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = "none";
}

// ─── Update Nav Stats ───────────────────────────────────────
async function updateNavStats() {
    const stats = await api("/stats");
    document.getElementById("navStreak").textContent = stats.current_streak;
    document.getElementById("navLessons").textContent = stats.total_lessons;
}

// ═══════════════════════════════════════════════════════════════
//  HOME VIEW
// ═══════════════════════════════════════════════════════════════
async function renderHome() {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
    const [stats, calendar] = await Promise.all([api("/stats"), api("/calendar")]);

    const accuracy = stats.total_questions > 0
        ? Math.round((stats.total_correct / stats.total_questions) * 100) : 0;
    const durationMin = Math.round(stats.total_duration / 60);

    mainContent.innerHTML = `
        <div class="home-hero">
            <h1>五十音道場</h1>
            <p>每天进步一点点，掌握日语假名</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card streak">
                <span class="stat-number">${stats.current_streak}</span>
                <span class="stat-label">🔥 连续打卡 (天)</span>
            </div>
            <div class="stat-card lessons">
                <span class="stat-number">${stats.total_lessons}</span>
                <span class="stat-label">📚 完成课程</span>
            </div>
            <div class="stat-card accuracy">
                <span class="stat-number">${accuracy}%</span>
                <span class="stat-label">✅ 正确率</span>
            </div>
            <div class="stat-card duration">
                <span class="stat-number">${durationMin}</span>
                <span class="stat-label">⏱️ 学习(分钟)</span>
            </div>
        </div>

        <div class="action-buttons">
            <button class="action-btn" onclick="router.navigate('lesson')">
                <div class="btn-icon green">📝</div>
                <div class="btn-text">
                    <h3>开始新课程</h3>
                    <p>随机学习10个假名，听·读·写练习</p>
                </div>
            </button>
            <button class="action-btn" onclick="router.navigate('chart')">
                <div class="btn-icon blue">📊</div>
                <div class="btn-text">
                    <h3>五十音图表</h3>
                    <p>查看完整的平假名·片假名对照表</p>
                </div>
            </button>
            <button class="action-btn" onclick="router.navigate('errors')">
                <div class="btn-icon orange">🔄</div>
                <div class="btn-text">
                    <h3>错题集复习</h3>
                    <p>针对薄弱假名反复练习</p>
                </div>
            </button>
            <button class="action-btn" onclick="router.navigate('rank')">
                <div class="btn-icon red">🏆</div>
                <div class="btn-text">
                    <h3>排行榜</h3>
                    <p>查看学习排名与Redis数据结构</p>
                </div>
            </button>
        </div>

        <div class="calendar-section">
            <h2>📅 学习日历</h2>
            <div class="calendar-wrapper" id="calendarWrapper"></div>
        </div>
    `;

    renderCalendar(calendar);
}

// ─── Calendar Heatmap (GitLab style) ────────────────────────
function renderCalendar(data) {
    const wrapper = document.getElementById("calendarWrapper");
    if (!wrapper) return;

    const maxDuration = Math.max(...data.map((d) => d.duration), 1);
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);

    const dayOfWeek = startDate.getDay();
    const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

    const dataMap = {};
    data.forEach((d) => { dataMap[d.date] = d; });

    const weeks = [];
    let currentWeek = [];
    for (let i = 0; i < dayOfWeek; i++) currentWeek.push(null);

    for (let i = 0; i <= 364; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const entry = dataMap[dateStr] || { duration: 0, lessons: 0 };
        currentWeek.push({ date: dateStr, ...entry, dayObj: d });

        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    }
    if (currentWeek.length) {
        while (currentWeek.length < 7) currentWeek.push(null);
        weeks.push(currentWeek);
    }

    const monthLabels = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
        for (const day of week) {
            if (day && day.dayObj) {
                const m = day.dayObj.getMonth();
                if (m !== lastMonth) {
                    monthLabels.push({ index: wi, label: monthNames[m] });
                    lastMonth = m;
                }
                break;
            }
        }
    });

    let monthHtml = '<div class="calendar-months">';
    let colIndex = 0;
    monthLabels.forEach((ml, i) => {
        const nextIdx = i < monthLabels.length - 1 ? monthLabels[i + 1].index : weeks.length;
        const span = nextIdx - ml.index;
        monthHtml += `<span style="min-width:${span * 16}px">${ml.label}</span>`;
    });
    monthHtml += "</div>";

    const dayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    let labelsHtml = '<div class="calendar-labels">';
    dayLabels.forEach((l, i) => {
        labelsHtml += `<span>${i % 2 === 1 ? l : ""}</span>`;
    });
    labelsHtml += "</div>";

    let gridHtml = '<div class="calendar-grid">';
    weeks.forEach((week) => {
        gridHtml += '<div class="calendar-week">';
        week.forEach((day) => {
            if (!day) {
                gridHtml += '<div class="calendar-day empty"></div>';
            } else {
                let level = 0;
                if (day.duration > 0) level = 1;
                if (day.duration > maxDuration * 0.25) level = 2;
                if (day.duration > maxDuration * 0.5) level = 3;
                if (day.duration > maxDuration * 0.75) level = 4;
                const tip = `${day.date}: ${Math.round(day.duration / 60)}分钟, ${day.lessons}课`;
                gridHtml += `<div class="calendar-day level-${level}" data-tip="${tip}"
                    onmouseenter="showTooltip(event, this.dataset.tip)"
                    onmouseleave="hideTooltip()"></div>`;
            }
        });
        gridHtml += "</div>";
    });
    gridHtml += "</div>";

    wrapper.innerHTML = `
        ${monthHtml}
        <div class="calendar-body">
            ${labelsHtml}
            ${gridHtml}
        </div>
        <div class="calendar-legend">
            <span>少</span>
            <div class="day-sample" style="background:var(--bg-input)"></div>
            <div class="day-sample" style="background:#0e4429"></div>
            <div class="day-sample" style="background:#006d32"></div>
            <div class="day-sample" style="background:#26a641"></div>
            <div class="day-sample" style="background:#39d353"></div>
            <span>多</span>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  CHART VIEW
// ═══════════════════════════════════════════════════════════════
async function renderChart() {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
    const chart = await api("/kana/chart");

    const typeOrder = ["seion", "dakuon", "handakuon", "youon"];
    let activeType = "all";

    function renderChartContent() {
        let tabsHtml = `<div class="chart-tabs">
            <button class="chart-tab ${activeType === "all" ? "active" : ""}" onclick="setChartType('all')">全部</button>`;
        typeOrder.forEach((t) => {
            if (chart[t]) {
                tabsHtml += `<button class="chart-tab ${activeType === t ? "active" : ""}" onclick="setChartType('${t}')">${chart[t].label}</button>`;
            }
        });
        tabsHtml += "</div>";

        let contentHtml = "";
        typeOrder.forEach((t) => {
            if (!chart[t]) return;
            if (activeType !== "all" && activeType !== t) return;

            contentHtml += `<div class="chart-type-section"><div class="chart-type-title">${chart[t].label}</div>`;
            const rows = chart[t].rows;
            for (const rowKey in rows) {
                const row = rows[rowKey];
                contentHtml += `<div class="chart-row"><div class="chart-row-label">${row.label}</div><div class="chart-row-kana">`;
                row.kana.forEach((k) => {
                    contentHtml += `<div class="kana-cell" onclick="showKanaDetail('${k.romaji}')" title="点击查看详情">
                        <span class="kana-hira">${k.hiragana}</span>
                        <span class="kana-kata">${k.katakana}</span>
                        <span class="kana-roma">${k.romaji}</span>
                    </div>`;
                });
                contentHtml += "</div></div>";
            }
            contentHtml += "</div>";
        });

        mainContent.innerHTML = `
            <div class="chart-header"><h1>五十音图</h1></div>
            ${tabsHtml}
            ${contentHtml}
        `;
    }

    window.setChartType = (t) => { activeType = t; renderChartContent(); };
    window.allKana = await api("/kana");
    renderChartContent();
}

// ─── Kana Detail Modal ──────────────────────────────────────
window.showKanaDetail = async (romaji) => {
    const kana = window.allKana.find((k) => k.romaji === romaji);
    if (!kana) return;
    const words = await api(`/vocabulary/${romaji}`);

    let wordsHtml = words.map((w) => `
        <div class="word-card">
            <div class="word-jp">${w.word}${w.kanji ? ` (${w.kanji})` : ""}</div>
            <div class="word-romaji">${w.romaji}</div>
            <div class="word-meaning">${w.meaning}</div>
        </div>
    `).join("");

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
        <div class="modal" style="position:relative">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
            <div class="kana-pair">
                <div><div class="kana-char" style="color:var(--text)">${kana.hiragana}</div><div class="kana-label">平假名</div></div>
                <div style="font-size:24px;color:var(--text-muted)">⇄</div>
                <div><div class="kana-char" style="color:var(--blue)">${kana.katakana}</div><div class="kana-label">片假名</div></div>
            </div>
            <div class="kana-romaji-big">${kana.romaji}</div>
            <button class="sound-btn" onclick="speak('${kana.hiragana}')">🔊</button>
            <div class="mt-16">${wordsHtml || '<p style="color:var(--text-muted)">暂无相关词汇</p>'}</div>
        </div>
    `;
    document.body.appendChild(overlay);
};

// ═══════════════════════════════════════════════════════════════
//  LESSON VIEW
// ═══════════════════════════════════════════════════════════════
let lessonState = null;

async function startNewLesson() {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>生成课程中...</div>';
    const data = await api("/lesson/new?count=10");

    lessonState = {
        lessonId: data.lesson_id,
        kana: data.kana,
        current: 0,
        phase: "learn",  // learn -> listen -> read -> write -> next
        errors: [],
        correctCount: 0,
        totalQuestions: 0,
        startTime: Date.now(),
    };

    renderLessonStep();
}

function renderLessonStep() {
    const s = lessonState;
    if (!s) return;

    if (s.current >= s.kana.length) {
        renderLessonResults();
        return;
    }

    const k = s.kana[s.current];
    const progressHtml = s.kana
        .map((_, i) => {
            let cls = "";
            if (i < s.current) cls = s.errors.some((e) => e.index === i) ? "error" : "done";
            else if (i === s.current) cls = "current";
            return `<div class="progress-dot ${cls}"></div>`;
        })
        .join("");

    if (s.phase === "learn") {
        const wordHtml = k.words.length
            ? k.words.map((w) => `
                <div class="word-card">
                    <div class="word-jp">${w.word}${w.kanji ? ` (${w.kanji})` : ""}</div>
                    <div class="word-romaji">${w.romaji}</div>
                    <div class="word-meaning">${w.meaning}</div>
                </div>
            `).join("") : "";

        mainContent.innerHTML = `
            <div class="lesson-view">
                <div class="lesson-progress">${progressHtml}</div>
                <div class="lesson-phase">
                    <div class="phase-label" style="color:var(--purple)">📖 学习 ${s.current + 1}/${s.kana.length}</div>
                    <div class="kana-display">
                        <div>
                            <div class="kana-big hira">${k.hiragana}</div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">平假名</div>
                        </div>
                        <div class="kana-arrow">⇄</div>
                        <div>
                            <div class="kana-big kata">${k.katakana}</div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">片假名</div>
                        </div>
                    </div>
                    <div class="kana-romaji-big">${k.romaji}</div>
                    <button class="sound-btn" onclick="speak('${k.hiragana}')">🔊</button>
                    ${wordHtml}
                </div>
                <button class="btn btn-primary btn-block btn-lg" onclick="lessonNextPhase()">开始练习 →</button>
            </div>
        `;
        speak(k.hiragana);

    } else if (s.phase === "listen") {
        const allKana = window.allKana || s.kana;
        const options = generateOptions(k, allKana, 4, "hiragana");

        mainContent.innerHTML = `
            <div class="lesson-view">
                <div class="lesson-progress">${progressHtml}</div>
                <div class="lesson-phase">
                    <div class="phase-label listen">🎧 听音辨字</div>
                    <p style="color:var(--text-secondary);font-weight:600;margin-bottom:16px">听发音，选择正确的假名</p>
                    <button class="sound-btn" onclick="speak('${k.hiragana}')" style="margin-bottom:8px">🔊</button>
                    <div class="quiz-options" id="quizOptions">
                        ${options.map((o) => `
                            <button class="quiz-option" data-romaji="${o.romaji}" onclick="checkAnswer(this, '${k.romaji}', 'listen')">
                                ${o.hiragana}
                            </button>
                        `).join("")}
                    </div>
                </div>
            </div>
        `;
        setTimeout(() => speak(k.hiragana), 300);

    } else if (s.phase === "read") {
        const allKana = window.allKana || s.kana;
        const options = generateOptions(k, allKana, 4, "romaji");

        mainContent.innerHTML = `
            <div class="lesson-view">
                <div class="lesson-progress">${progressHtml}</div>
                <div class="lesson-phase">
                    <div class="phase-label read">👁️ 看字读音</div>
                    <p style="color:var(--text-secondary);font-weight:600;margin-bottom:16px">看假名，选择正确的读音</p>
                    <div class="kana-display">
                        <div class="kana-big hira">${k.hiragana}</div>
                    </div>
                    <div class="quiz-options" id="quizOptions">
                        ${options.map((o) => `
                            <button class="quiz-option" style="font-family:var(--font-main);font-size:20px" data-romaji="${o.romaji}" onclick="checkAnswer(this, '${k.romaji}', 'read')">
                                ${o.romaji}
                            </button>
                        `).join("")}
                    </div>
                </div>
            </div>
        `;

    } else if (s.phase === "write") {
        mainContent.innerHTML = `
            <div class="lesson-view">
                <div class="lesson-progress">${progressHtml}</div>
                <div class="lesson-phase">
                    <div class="phase-label write">✏️ 拼写练习</div>
                    <p style="color:var(--text-secondary);font-weight:600;margin-bottom:16px">看片假名，输入罗马音</p>
                    <div class="kana-display">
                        <div class="kana-big kata">${k.katakana}</div>
                    </div>
                    <input class="quiz-input" id="writeInput" type="text" placeholder="输入罗马音..." autocomplete="off" autofocus
                        onkeydown="if(event.key==='Enter')checkWriteAnswer()">
                    <button class="btn btn-primary btn-block mt-16" onclick="checkWriteAnswer()">确认</button>
                </div>
            </div>
        `;
        setTimeout(() => {
            const input = document.getElementById("writeInput");
            if (input) input.focus();
        }, 100);
    }
}

function generateOptions(correct, pool, count, field) {
    const options = [correct];
    const filtered = pool.filter((k) => k.romaji !== correct.romaji);
    const shuffled = filtered.sort(() => Math.random() - 0.5);
    for (let i = 0; options.length < count && i < shuffled.length; i++) {
        options.push(shuffled[i]);
    }
    return options.sort(() => Math.random() - 0.5);
}

window.checkAnswer = function (btn, correctRomaji, phase) {
    const s = lessonState;
    if (!s || btn.classList.contains("correct") || btn.classList.contains("wrong")) return;

    s.totalQuestions++;
    const selected = btn.dataset.romaji;
    const isCorrect = selected === correctRomaji;

    const buttons = document.querySelectorAll("#quizOptions .quiz-option");
    buttons.forEach((b) => { b.style.pointerEvents = "none"; });

    if (isCorrect) {
        btn.classList.add("correct");
        s.correctCount++;
    } else {
        btn.classList.add("wrong");
        buttons.forEach((b) => {
            if (b.dataset.romaji === correctRomaji) b.classList.add("correct");
        });
        const k = s.kana[s.current];
        s.errors.push({ ...k, index: s.current, phase });
    }

    setTimeout(() => lessonNextPhase(), 1000);
};

window.checkWriteAnswer = function () {
    const s = lessonState;
    if (!s) return;
    const input = document.getElementById("writeInput");
    if (!input) return;

    const answer = input.value.trim().toLowerCase();
    const k = s.kana[s.current];
    s.totalQuestions++;

    const isCorrect = answer === k.romaji;
    if (isCorrect) {
        input.classList.add("correct");
        s.correctCount++;
    } else {
        input.classList.add("wrong");
        s.errors.push({ ...k, index: s.current, phase: "write" });
        input.value = k.romaji;
    }

    input.disabled = true;
    setTimeout(() => {
        s.current++;
        s.phase = "learn";
        renderLessonStep();
    }, 1200);
};

window.lessonNextPhase = function () {
    const s = lessonState;
    if (!s) return;
    const phases = ["learn", "listen", "read", "write"];
    const idx = phases.indexOf(s.phase);
    if (idx < phases.length - 1) {
        s.phase = phases[idx + 1];
    } else {
        s.current++;
        s.phase = "learn";
    }
    renderLessonStep();
};

async function renderLessonResults() {
    const s = lessonState;
    const duration = Math.round((Date.now() - s.startTime) / 1000);
    const accuracy = s.totalQuestions > 0
        ? Math.round((s.correctCount / s.totalQuestions) * 100) : 0;

    await api("/lesson/submit", {
        method: "POST",
        body: {
            lesson_id: s.lessonId,
            errors: s.errors,
            correct_count: s.correctCount,
            total_count: s.totalQuestions,
            duration_seconds: duration,
        },
    });
    updateNavStats();

    const icon = accuracy >= 80 ? "🎉" : accuracy >= 50 ? "👍" : "💪";
    const title = accuracy >= 80 ? "太棒了！" : accuracy >= 50 ? "继续加油！" : "不要灰心！";

    let errorsHtml = "";
    if (s.errors.length > 0) {
        errorsHtml = `
            <div class="section-header mt-24">
                <h2>❌ 本次错题</h2>
            </div>
            <div class="error-list">
                ${s.errors.map((e, i) => `
                    <div class="error-item">
                        <div class="error-rank">${i + 1}</div>
                        <div class="error-kana">${e.hiragana}</div>
                        <div class="error-info">
                            <div class="error-romaji">${e.romaji}</div>
                            <div class="error-kata">${e.katakana} · ${e.phase === "listen" ? "听音" : e.phase === "read" ? "看字" : "拼写"}</div>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    }

    mainContent.innerHTML = `
        <div class="results-view">
            <div class="results-icon">${icon}</div>
            <div class="results-title">${title}</div>
            <div class="results-subtitle">课程完成！</div>
            <div class="results-stats">
                <div class="results-stat">
                    <span class="rs-number text-green">${s.correctCount}</span>
                    <span class="rs-label">正确</span>
                </div>
                <div class="results-stat">
                    <span class="rs-number text-red">${s.totalQuestions - s.correctCount}</span>
                    <span class="rs-label">错误</span>
                </div>
                <div class="results-stat">
                    <span class="rs-number text-blue">${accuracy}%</span>
                    <span class="rs-label">正确率</span>
                </div>
                <div class="results-stat">
                    <span class="rs-number" style="color:var(--purple)">${Math.round(duration / 60)}:${String(duration % 60).padStart(2, "0")}</span>
                    <span class="rs-label">用时</span>
                </div>
            </div>
            ${errorsHtml}
            <div class="mt-24" style="display:flex;gap:12px">
                <button class="btn btn-primary btn-block" onclick="startNewLesson()">再来一课</button>
                <button class="btn btn-secondary btn-block" onclick="router.navigate('home')">返回首页</button>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
//  ERROR COLLECTION VIEW
// ═══════════════════════════════════════════════════════════════
async function renderErrors() {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
    const errors = await api("/errors");

    if (errors.length === 0) {
        mainContent.innerHTML = `
            <div class="section-header"><h2>📋 错题集</h2></div>
            <div class="empty-state">
                <div class="empty-icon">✨</div>
                <div class="empty-text">暂无错题</div>
                <div class="empty-sub">完成课程后，错题会自动收集在这里</div>
                <button class="btn btn-primary mt-24" onclick="router.navigate('lesson')">开始学习</button>
            </div>
        `;
        return;
    }

    mainContent.innerHTML = `
        <div class="section-header">
            <h2>📋 错题集 (${errors.length})</h2>
            <button class="section-action" onclick="clearErrors()">清空错题</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
            <button class="btn btn-primary" onclick="startErrorPractice()">🔄 开始复习</button>
        </div>
        <div class="error-list">
            ${errors.map((e, i) => `
                <div class="error-item" onclick="showKanaDetail('${e.romaji}')" style="cursor:pointer">
                    <div class="error-rank">${i + 1}</div>
                    <div class="error-kana">${e.hiragana}</div>
                    <div class="error-info">
                        <div class="error-romaji">${e.romaji}</div>
                        <div class="error-kata">${e.katakana}</div>
                    </div>
                    <div class="error-count">×${e.error_count}</div>
                </div>
            `).join("")}
        </div>
    `;
}

window.clearErrors = async () => {
    if (confirm("确定清空所有错题吗？")) {
        await api("/errors/clear", { method: "POST" });
        renderErrors();
    }
};

window.startErrorPractice = async () => {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>生成复习课程...</div>';
    const errors = await api("/errors/practice?count=10");
    if (errors.length === 0) {
        renderErrors();
        return;
    }
    lessonState = {
        lessonId: "error-practice",
        kana: errors,
        current: 0,
        phase: "learn",
        errors: [],
        correctCount: 0,
        totalQuestions: 0,
        startTime: Date.now(),
    };
    renderLessonStep();
};

// ═══════════════════════════════════════════════════════════════
//  LEADERBOARD VIEW
// ═══════════════════════════════════════════════════════════════
async function renderRank() {
    mainContent.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

    const [leaderboard, usernames, redisInfo] = await Promise.all([
        api("/leaderboard"),
        api("/leaderboard/usernames"),
        api("/redis/info"),
    ]);

    let activeBoard = "duration";
    const boardLabels = {
        duration: "⏱️ 学习时长",
        lessons: "📚 课程数",
        streak: "🔥 连续打卡",
        accuracy: "✅ 正确数",
    };
    const boardUnits = {
        duration: (s) => `${Math.round(s / 60)}分钟`,
        lessons: (s) => `${s}课`,
        streak: (s) => `${s}天`,
        accuracy: (s) => `${s}题`,
    };

    function renderBoardContent() {
        const entries = leaderboard[activeBoard] || [];

        let tabsHtml = '<div class="lb-tabs">';
        for (const b in boardLabels) {
            tabsHtml += `<button class="lb-tab ${b === activeBoard ? "active" : ""}" onclick="setBoard('${b}')">${boardLabels[b]}</button>`;
        }
        tabsHtml += "</div>";

        let listHtml = "";
        if (entries.length === 0) {
            listHtml = `<div class="empty-state">
                <div class="empty-icon">🏆</div>
                <div class="empty-text">暂无排行数据</div>
                <div class="empty-sub">点击下方按钮生成示例数据</div>
            </div>`;
        } else {
            listHtml = '<div class="lb-list">';
            entries.forEach((e, i) => {
                const name = usernames[e.user] || e.user;
                const isMe = e.user === "me";
                const topCls = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
                listHtml += `
                    <div class="lb-item ${topCls} ${isMe ? "me" : ""}">
                        <div class="lb-rank">${i + 1}</div>
                        <div class="lb-name">${name} ${isMe ? "⭐" : ""}</div>
                        <div class="lb-score">${boardUnits[activeBoard](e.score)}</div>
                    </div>
                `;
            });
            listHtml += "</div>";
        }

        let redisHtml = '<div class="redis-panel"><h3>🔧 Redis 数据结构说明</h3>';
        for (const key in redisInfo) {
            const info = redisInfo[key];
            const keysStr = info.keys
                ? (Array.isArray(info.keys) ? info.keys.join(", ") : info.keys)
                : "";
            redisHtml += `
                <div class="redis-item">
                    <div class="ri-title">${key}</div>
                    <div class="ri-type">类型: ${info.type || ""}</div>
                    ${info.key ? `<div class="ri-key">Key: ${info.key}</div>` : ""}
                    ${info.key_pattern ? `<div class="ri-key">Pattern: ${info.key_pattern}</div>` : ""}
                    ${keysStr ? `<div class="ri-key">Keys: ${keysStr}</div>` : ""}
                    ${info.commands ? `<div class="ri-cmds">Commands: ${info.commands}</div>` : ""}
                    ${info.description ? `<div class="ri-desc">${info.description}</div>` : ""}
                </div>
            `;
        }
        redisHtml += "</div>";

        mainContent.innerHTML = `
            <div class="section-header">
                <h2>🏆 排行榜</h2>
                <button class="section-action" onclick="seedLeaderboard()">生成示例数据</button>
            </div>
            ${tabsHtml}
            ${listHtml}
            ${redisHtml}
        `;
    }

    window.setBoard = (b) => { activeBoard = b; renderBoardContent(); };
    renderBoardContent();
}

window.seedLeaderboard = async () => {
    await api("/seed", { method: "POST" });
    await updateNavStats();
    renderRank();
};

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
(async function init() {
    window.allKana = await api("/kana");
    await updateNavStats();
    router.navigate("home");
})();
