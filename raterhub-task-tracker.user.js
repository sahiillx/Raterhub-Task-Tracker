// ==UserScript==
// @name         RaterHub Task Tracker
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  A productivity tracker for Raterhub tasks
// @author       Sahil Khan
// @match        https://www.raterhub.com/evaluation/rater/*
// @grant        GM_xmlhttpRequest
// @connect      raterhub.com
// @updateURL    https://raw.githubusercontent.com/sahiillx/Raterhub-Task-Tracker/main/raterhub-task-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/sahiillx/Raterhub-Task-Tracker/main/raterhub-task-tracker.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Constants ---
    const TASK_STORAGE_KEY = 'taskData_v2'; // Storage for task counts/history
    const STORAGE_KEY_UT = 'utData'; // Storage for User Time (UT)
    const DEFAULT_TARGET = 700; // Default task target
    const TASK_TIME_LIMIT_MS = 2 * 60 * 1000; // Task counts only if under 2 mins
    const MAX_UT_PER_TASK = 120; // Max UT seconds to record per task submission
    const todayKey = new Date().toISOString().split('T')[0]; // Key for daily UT storage
    const isTaskPage = window.location.href.includes('/evaluation/rater/task/show?taskIds=');
    let utUpdateIntervalId = null; // To hold the interval ID for UT display updates

    // --- Conflict Notifier Functions ---
    function showNotification(message) {
        // Prevent duplicate notifications
        if (document.getElementById('taskConflictWarning')) return;

        const box = document.createElement('div');
        box.id = 'taskConflictWarning';
        box.innerText = message;
        box.style.position = 'fixed';
        box.style.top = '50%';
        box.style.left = '50%';
        box.style.transform = 'translate(-50%, -50%)';
        box.style.background = '#FF6363'; // Red background
        box.style.color = '#000'; // Black text
        box.style.padding = '20px 30px';
        box.style.border = '1px solid #000'; // Black border
        box.style.borderRadius = '10px';
        box.style.fontSize = '16px';
        box.style.zIndex = '99999'; // Ensure it's on top
        box.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';

        box.style.textAlign = 'center';

        document.body.appendChild(box);
        // Automatically remove after 10 seconds
        setTimeout(() => {
            if (box) box.remove();
        }, 5000);
    }

    function checkIncompleteTasks() {
        console.log("Checking for incomplete tasks...");
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://www.raterhub.com/evaluation/rater/task/index",
            onload: function (response) {
                if (response.status !== 200) {
                    console.warn("Failed to fetch task index page. Status:", response.status);
                    return;
                }
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');
                    // Find links that act as 'Continue' buttons
                    const continueButtons = [...doc.querySelectorAll('a')].filter(a => a.textContent.trim() === 'Continue');

                    console.log(`Found ${continueButtons.length} 'Continue' buttons on index page.`);
                    if (continueButtons.length > 1) {
                        showNotification(`⚠️ You have ${continueButtons.length} tasks running in the background!`);
                    }
                } catch (e) {
                    console.error("Error parsing task index page:", e);
                }
            },
            onerror: function(error) {
                 console.error("Error during GM_xmlhttpRequest for conflict check:", error);
            }
        });
    }


    // --- UT Helper Functions ---
    function formatTime(totalSecs) {
        totalSecs = Math.max(0, Math.floor(totalSecs));
        const hr = Math.floor(totalSecs / 3600);
        const min = Math.floor((totalSecs % 3600) / 60);
        const sec = totalSecs % 60;
        return `${hr > 0 ? `${hr}h ` : ''}${String(min).padStart(hr > 0 ? 2 : 1, '0')}m ${String(sec).padStart(2, '0')}s`;
    }

    function initializeUT() {
        let utDataRaw = localStorage.getItem(STORAGE_KEY_UT);
        let utData = {};
        try {
             utData = JSON.parse(utDataRaw);
             if (!utData || typeof utData !== 'object') throw new Error("Invalid UT data format");
        } catch(e) {
            console.warn("Initializing UT data due to error or missing data:", e.message);
            utData = {};
        }
        if (!utData[todayKey]) {
            utData[todayKey] = { total: 0, tasks: {} };
            localStorage.setItem(STORAGE_KEY_UT, JSON.stringify(utData));
        } else {
             if (typeof utData[todayKey].total !== 'number') utData[todayKey].total = 0;
             if (typeof utData[todayKey].tasks !== 'object') utData[todayKey].tasks = {};
        }
        return utData;
    }

     function updateUT(taskId, sessionSecs) {
        if (!taskId || typeof sessionSecs !== 'number' || sessionSecs < 0) return;
        let utData = initializeUT();
        let dailyData = utData[todayKey];
        let currentTaskUT = dailyData.tasks[taskId] || 0;
        let timeToAdd = sessionSecs;
        if (currentTaskUT + sessionSecs > MAX_UT_PER_TASK) {
            timeToAdd = Math.max(0, MAX_UT_PER_TASK - currentTaskUT);
            console.log(`UT for task ${taskId} hit limit. Adding ${timeToAdd}s instead of ${sessionSecs}s.`);
        }
        if (timeToAdd > 0) {
            dailyData.tasks[taskId] = currentTaskUT + timeToAdd;
            dailyData.total += timeToAdd;
            console.log(`Updated UT for task ${taskId}: ${dailyData.tasks[taskId]}s. Added ${timeToAdd}s to daily.`);
        }
        localStorage.setItem(STORAGE_KEY_UT, JSON.stringify(utData));
        updateDashboardUI();
    }


    // --- Task Tracker Functions ---
    function initTaskStorage() {
        let raw = localStorage.getItem(TASK_STORAGE_KEY);
        let data;
        try {
            data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || !data.taskHistory) throw new Error("Invalid task data format");
        } catch(e) {
             console.warn("Initializing task data due to error or missing data:", e.message);
            data = {
                target: DEFAULT_TARGET, achieved: 0, left: DEFAULT_TARGET, taskHistory: [], count: 0
            };
            localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(data));
        }
        data.target = data.target || DEFAULT_TARGET;
        data.achieved = data.achieved || 0;
        data.left = Math.max(0, (data.target || DEFAULT_TARGET) - (data.achieved || 0));
        data.taskHistory = data.taskHistory || [];
        data.count = data.count || 0;
        return data;
    }

    function saveTaskData(data) {
        localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(data));
    }

    // --- UI Functions ---
    function createDashboardUI() {
        if (document.getElementById('taskCounterV2')) return;

        const taskData = initTaskStorage();
        const utData = initializeUT();
        const initialUT = utData[todayKey]?.total || 0;
        const progressPercent = taskData.target > 0 ? Math.min(100, (taskData.achieved / taskData.target) * 100) : 0;

        const div = document.createElement('div');
        div.id = 'taskCounterV2';
        // Styles...
        div.style.position = 'fixed';
        div.style.top = '40px';
        div.style.right = '19px';
        div.style.width = '200px';
        div.style.background = '#f8f9fa';
        div.style.border = '1px solid #ccc';
        div.style.borderRadius = '10px';
        div.style.padding = '12px';
        div.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        div.style.fontFamily = 'Arial, sans-serif';
        div.style.fontSize = '14px';
        div.style.zIndex = '9999';

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; font-size: 16px; color: #495057;">📊 Rater Dashboard</h3>
                <span style="font-size: 10px; color: #6c757d;">v0.7</span>
            </div>

            <div style="background: #e9ecef; padding: 8px; border-radius: 5px; margin-bottom: 10px;">
                 <div style="display: flex; justify-content: space-between;">
                    <span>⏱️ Today UT:</span>
                    <span id="utTodayDisplayV2" style="font-weight: bold;">${formatTime(initialUT)}</span>
                </div>
            </div>

             <div style="margin-bottom: 10px;">
                 <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>🎯 Target:</span>
                    <div style="display: flex; align-items: center;">
                        <input id="targetInputV2" type="number" value="${taskData.target}" min="1" style="width: 50px; text-align: right; margin-right: 5px; border: 1px solid #ced4da; border-radius: 3px; padding: 2px;">
                        <button id="saveTargetV2" title="Save Target" style="background-color: #28a745; color: white; border: none; border-radius: 3px; padding: 2px 5px; font-size: 12px; cursor: pointer;">💾</button>
                    </div>
                </div>
                <div style="background: #e9ecef; height: 4px; border-radius: 3px; margin-top: 5px;">
                    <div id="progressBarV2" style="background: ${progressPercent >= 100 ? '#28a745' : '#007bff'}; width: ${progressPercent}%; height: 100%; border-radius: 3px; transition: width 0.3s ease, background-color 0.3s ease;"></div>
                </div>
            </div>

            <div style="background: #e9ecef; padding: 8px; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>✅ Achieved:</span>
                    <span id="achievedV2" style="font-weight: bold;">${taskData.achieved}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>⏳ Left:</span>
                    <span id="leftV2" style="font-weight: bold; color: ${taskData.left > 0 ? '#dc3545' : '#28a745'}">${taskData.left}</span>
                </div>
            </div>
            `;

        document.body.appendChild(div);

        const saveBtn = document.getElementById('saveTargetV2');
        const targetInput = document.getElementById('targetInputV2');
        if (saveBtn) saveBtn.addEventListener('click', updateTarget);
        if (targetInput) targetInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') updateTarget();
        });
    }

    function updateTarget() {
        const input = document.getElementById('targetInputV2');
        if (!input) return;
        const newTarget = parseInt(input.value);
        if (!isNaN(newTarget) && newTarget > 0) {
            const data = initTaskStorage();
            data.target = newTarget;
            data.left = Math.max(0, newTarget - data.achieved);
            saveTaskData(data);
            updateDashboardUI();
        } else {
            const data = initTaskStorage();
            input.value = data.target;
        }
    }

    function updateDashboardUI() {
        const taskData = initTaskStorage();
        const utData = initializeUT();
        const todaysUT = utData[todayKey]?.total || 0;
        const taskId = isTaskPage ? new URLSearchParams(window.location.search).get('taskIds') : null;
        const currentTaskStoredUT = taskId ? (utData[todayKey]?.tasks?.[taskId] || 0) : 0;

        const achievedEl = document.getElementById('achievedV2');
        const leftEl = document.getElementById('leftV2');
        const bar = document.getElementById('progressBarV2');
        const targetInput = document.getElementById('targetInputV2');
        const utDisplayEl = document.getElementById('utTodayDisplayV2');

        if (!achievedEl || !leftEl || !bar || !utDisplayEl) return;

        // Update Task Count UI
        const percent = taskData.target > 0 ? Math.min(100, (taskData.achieved / taskData.target) * 100) : 0;
        achievedEl.textContent = taskData.achieved;
        leftEl.textContent = taskData.left;
        leftEl.style.color = taskData.left > 0 ? '#dc3545' : '#28a745';
        bar.style.width = `${percent}%`;
        bar.style.background = percent >= 100 ? '#28a745' : '#007bff';
        if (targetInput && parseInt(targetInput.value) !== taskData.target) {
            targetInput.value = taskData.target;
        }

        // Update UT Display (Live Calculation if on Task Page)
        let displayUT = todaysUT;
        if (isTaskPage && taskId) {
            const timerEl = document.querySelector('.ewok-rater-progress-bar-timer-digital-display');
            if (timerEl && timerEl.textContent.includes(':')) {
                try {
                     const [m, s] = timerEl.textContent.split(':').map(Number);
                     const elapsedSeconds = m * 60 + s;
                     const maxLiveAdd = Math.max(0, MAX_UT_PER_TASK - currentTaskStoredUT);
                     const liveAdd = Math.min(elapsedSeconds, maxLiveAdd);
                     displayUT = todaysUT + liveAdd;
                } catch (e) { console.error("Error parsing live timer:", e); }
            }
        }
         utDisplayEl.textContent = formatTime(displayUT);
    }

    // --- Event Handling & Logic ---
    function setupEventHandlers() {
        const taskId = new URLSearchParams(window.location.search).get('taskIds');
        if (!isTaskPage || !taskId) return;

        // Task Counting Logic
        const taskStartTimeKey = `taskStartTime_${taskId}`;
        if (!sessionStorage.getItem(taskStartTimeKey)) {
            sessionStorage.setItem(taskStartTimeKey, Date.now().toString());
        }

        ['button[type="submit"]', 'input[type="submit"]', '#ewok-task-submit-done-button'].forEach(selector => {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.addEventListener('click', () => {
                    sessionStorage.setItem('submittedTask', 'true');
                });
            }
        });

        // Combined BeforeUnload Logic
        window.addEventListener('beforeunload', () => {
            if (sessionStorage.getItem('skipTaskCountOnce') === 'true') {
                sessionStorage.removeItem('skipTaskCountOnce');
                sessionStorage.removeItem(taskStartTimeKey);
                return;
            }
            if (sessionStorage.getItem('submittedTask') !== 'true') {
                sessionStorage.removeItem(taskStartTimeKey);
                return;
            }
            sessionStorage.removeItem('submittedTask');

            const startTime = parseInt(sessionStorage.getItem(taskStartTimeKey), 10);
            const endTime = Date.now();
            let durationMs = NaN;
            if (startTime) durationMs = endTime - startTime;
            sessionStorage.removeItem(taskStartTimeKey);

            // Count Task (if within time limit)
            if (startTime && durationMs <= TASK_TIME_LIMIT_MS) {
                console.log(`Task ${taskId} submitted within time limit (${durationMs / 1000}s). Counting.`);
                const taskData = initTaskStorage();
                if (!taskData.taskHistory.includes(taskId)) {
                    taskData.taskHistory.push(taskId);
                    taskData.achieved++;
                    taskData.left = Math.max(0, taskData.target - taskData.achieved);
                    taskData.count++;
                    saveTaskData(taskData);
                } else { console.log(`Task ${taskId} already counted.`); }
            } else { console.log(`Task ${taskId} exceeded time limit or start time missing. Not counting.`); }

            // Record UT (using EWoK timer)
            const timerEl = document.querySelector('.ewok-rater-progress-bar-timer-digital-display');
            if (timerEl && timerEl.textContent.includes(':')) {
                 try {
                    const [min, sec] = timerEl.textContent.split(':').map(Number);
                    const sessionSecs = min * 60 + sec;
                    console.log(`Recording UT for task ${taskId}: ${sessionSecs}s from timer.`);
                    updateUT(taskId, sessionSecs);
                 } catch (e) { console.error("Error reading EWoK timer for UT on unload:", e); }
            } else { console.warn("Could not find EWoK timer for UT on unload."); }
        });
    }

    function startUTDisplayUpdater() {
        if (utUpdateIntervalId) clearInterval(utUpdateIntervalId);
        utUpdateIntervalId = setInterval(updateDashboardUI, 1000);
        console.log("UT Display Updater Started.");
    }

     function stopUTDisplayUpdater() {
         if (utUpdateIntervalId) {
            clearInterval(utUpdateIntervalId);
            utUpdateIntervalId = null;
            console.log("UT Display Updater Stopped.");
         }
    }

    // --- Combined Reset Button ---
    function addResetButton() {
        const container = document.getElementById('taskCounterV2');
        if (!container || container.querySelector('#resetAllButtonV2')) return;

        const btn = document.createElement('button');
        btn.id = 'resetAllButtonV2';
        btn.textContent = '🔄 Reset All';
        // Styles...
        btn.style.marginTop = '10px';
        btn.style.width = '100%';
        btn.style.backgroundColor = '#dc3545';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.padding = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';

        btn.addEventListener('click', () => {
            if (confirm('Reset all task progress AND today\'s UT data?')) {
                localStorage.removeItem(TASK_STORAGE_KEY);
                localStorage.removeItem(STORAGE_KEY_UT);
                sessionStorage.setItem('skipTaskCountOnce', 'true');
                Object.keys(sessionStorage).forEach(key => {
                    if (key.startsWith('taskStartTime_')) sessionStorage.removeItem(key);
                });
                location.reload();
            }
        });

        const signatureDiv = container.querySelector('#signatureV2');
        if (signatureDiv) container.insertBefore(btn, signatureDiv);
        else container.appendChild(btn);
    }

    // --- Signature ---
    function addSignature() {
         const container = document.getElementById('taskCounterV2');
         if (!container || container.querySelector('#signatureV2')) return;
        const signature = document.createElement('div');
        signature.id = 'signatureV2';
        signature.innerHTML = `
        <div style="font-size: 11px; color: #888; text-align: center; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #eee; font-style: italic;">
            Built with ❤️ by Sahil Khan
        </div>
        `;
        container.appendChild(signature);
     }

    // --- Main Execution ---
    function main() {
        console.log("RaterHub Dashboard Script Initializing...");
        createDashboardUI(); // Create static UI elements
        addResetButton(); // Add buttons dynamically
        addSignature();

        updateDashboardUI(); // Populate UI with initial data

        if (isTaskPage) {
            console.log("Task page detected. Setting up handlers and timers.");
            setupEventHandlers();
            startUTDisplayUpdater();
            // Check for conflicts after a short delay to allow page elements to load
            setTimeout(checkIncompleteTasks, 1500); // Added conflict check call
        } else {
            console.log("Not a task page. Stopping timers and clearing session data.");
            stopUTDisplayUpdater();
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('taskStartTime_')) sessionStorage.removeItem(key);
            });
        }
        console.log("RaterHub Dashboard Script Initialized.");
    }

    // --- DOM Ready Execution ---
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(main, 250); // Slightly increased delay
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(main, 250));
    }

})();
