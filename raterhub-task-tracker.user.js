// ==UserScript==
// @name         RaterHub Task Tracker v2
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  A productivity tracker for Raterhub tasks
// @author       Sahil Khan
// @match        https://www.raterhub.com/evaluation/rater/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sahiillx/Raterhub-Task-Tracker/main/raterhub-task-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/sahiillx/Raterhub-Task-Tracker/main/raterhub-task-tracker.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TASK_STORAGE_KEY = 'taskData_v2';
    const STOPWATCH_STORAGE_KEY = 'raterhub_stopwatch_data';
    const DEFAULT_TARGET = 700;
    const isTaskPage = window.location.href.includes('/evaluation/rater/task/show?taskIds=');

    // --------------------------
    // Stopwatch Module
    // --------------------------
    const Stopwatch = {
        data: JSON.parse(localStorage.getItem(STOPWATCH_STORAGE_KEY)) || {
            isRunning: false,
            startTime: null,
            elapsed: 0
        },
        intervalId: null,

        save() {
            localStorage.setItem(STOPWATCH_STORAGE_KEY, JSON.stringify(this.data));
        },

        format(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        },

        updateDisplay() {
            const now = Date.now();
            const elapsed = this.data.elapsed + (this.data.isRunning ? now - this.data.startTime : 0);
            const el = document.getElementById('stopwatchDisplay');
            if (el) el.textContent = this.format(elapsed);
        },

        start() {
            if (!this.data.isRunning) {
                this.data.startTime = Date.now();
                this.data.isRunning = true;
                this.save();
            }

            if (!this.intervalId) {
                this.intervalId = setInterval(() => this.updateDisplay(), 1000);
            }
        },

        stop() {
            if (this.data.isRunning) {
                this.data.elapsed += Date.now() - this.data.startTime;
                this.data.startTime = null;
                this.data.isRunning = false;
                this.save();
            }

            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        },

        reset() {
            if (confirm('Reset stopwatch time?')) {
                this.stop();
                this.data.elapsed = 0;
                this.save();
                this.updateDisplay();
                if (isTaskPage) this.start();
            }
        },

        insertIntoPanel() {
            const container = document.getElementById('taskCounterV2');
            if (!container) return;

            const stopwatchBox = document.createElement('div');
            stopwatchBox.style.background = '#e9ecef';
            stopwatchBox.style.padding = '8px';
            stopwatchBox.style.borderRadius = '5px';
            stopwatchBox.style.marginBottom = '10px';
            stopwatchBox.style.marginTop = '10px';

            stopwatchBox.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
            <span>⏱️ Stopwatch:</span>
            <span id="stopwatchDisplay" style="font-weight: bold;">00:00:00</span>
        </div>
    `;

            // ✅ Insert above "Reset All" button if it exists
            const resetBtn = Array.from(container.getElementsByTagName('button'))
            .find(btn => btn.textContent.includes('Reset All'));

            if (resetBtn) {
                container.insertBefore(stopwatchBox, resetBtn);
            } else {
                container.appendChild(stopwatchBox);
            }

            this.updateDisplay();
            if (this.data.isRunning) {
                this.intervalId = setInterval(() => this.updateDisplay(), 1000);
            }
        }


        ,

        setup() {
            this.insertIntoPanel();
            if (isTaskPage) {
                this.start();
            } else {
                this.stop();
            }
        }
    };

    // --------------------------
    // Task Tracker Module
    // --------------------------
    function initStorage() {
        let raw = localStorage.getItem(TASK_STORAGE_KEY);
        let data;
        try {
            data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || !data.taskHistory) throw new Error();
        } catch {
            data = {
                target: DEFAULT_TARGET,
                achieved: 0,
                left: DEFAULT_TARGET,
                taskHistory: [],
                count: 0
            };
            localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(data));
        }
        return data;
    }

    function saveTaskData(data) {
        localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(data));
    }

    function setupTaskCountingOnUnload() {
        const taskId = new URLSearchParams(window.location.search).get('taskIds');
        if (!taskId) return;

        ['button[type="submit"]', 'input[type="submit"]', '#ewok-task-submit-done-button'].forEach(selector => {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.addEventListener('click', () => {
                    sessionStorage.setItem('submittedTask', 'true');
                });
            }
        });

        window.addEventListener('beforeunload', () => {
            if (sessionStorage.getItem('skipTaskCountOnce') === 'true') {
                sessionStorage.removeItem('skipTaskCountOnce');
                return;
            }

            if (sessionStorage.getItem('submittedTask') !== 'true') return;
            sessionStorage.removeItem('submittedTask');

            const data = initStorage();
            if (!data.taskHistory.includes(taskId)) {
                data.taskHistory.push(taskId);
                data.count++;
                data.achieved++;
                data.left = Math.max(0, data.target - data.achieved);
                saveTaskData(data);
            }
        });

        const data = initStorage();
        updateTaskUI(data);
    }

    function createCounterUI(data) {
        const progressPercent = Math.min(100, (data.achieved / data.target) * 100);

        const div = document.createElement('div');
        div.id = 'taskCounterV2';
        div.style.position = 'fixed';
        div.style.bottom = '100px';
        div.style.right = '20px';
        div.style.width = '200px';
        div.style.background = '#f8f9fa';
        div.style.border = '1px solid #ccc';
        div.style.borderRadius = '10px';
        div.style.padding = '12px';
        div.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        div.style.fontFamily = 'Arial, sans-serif';
        div.style.fontSize = '14px';
        div.style.zIndex = '9999';

        div.innerHTML =
            `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; font-size: 16px; color: #495057;">📊 Rater Dashboard</h3>
                <span style="font-size: 10px; color: #6c757d;">v0.4</span>
            </div>


            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>🎯 Target:</span>
                    <div style="display: flex; align-items: center;">
                        <input id="targetInputV2" type="number" value="${data.target}" style="width: 50px; text-align: right; margin-right: 5px; border: 1px solid #ced4da; border-radius: 3px; padding: 2px;">
                        <button id="saveTargetV2" style="background-color: #28a745; color: white; border: none; border-radius: 3px; padding: 2px 5px; font-size: 12px; cursor: pointer;">💾</button>
                    </div>
                </div>
                <div style="background: #e9ecef; height: 4px; border-radius: 3px; margin-top: 5px;">
                    <div  id="progressBarV2" style="background: ${progressPercent >= 100 ? '#28a745' : '#007bff'}; width: ${progressPercent}%; height: 100%; border-radius: 3px;"></div>
                </div>
            </div>


            <div style="background: #e9ecef; padding: 8px; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>✅ Achieved:</span>
                    <span id="achievedV2" style="font-weight: bold;">${data.achieved}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>⏳ Left:</span>
                    <span id="leftV2" style="font-weight: bold; color: ${data.left > 0 ? '#dc3545' : '#28a745'}">${data.left}</span>
                </div>
            </div>
        `;

        document.body.appendChild(div);

        document.getElementById('saveTargetV2').addEventListener('click', updateTarget);
        document.getElementById('targetInputV2').addEventListener('keypress', e => {
            if (e.key === 'Enter') updateTarget();
        });
    }

    function updateTarget() {
        const input = document.getElementById('targetInputV2');
        const newTarget = parseInt(input.value);
        if (!isNaN(newTarget) && newTarget > 0) {
            const data = initStorage();
            data.target = newTarget;
            data.left = Math.max(0, newTarget - data.achieved);
            saveTaskData(data);
            updateTaskUI(data);
        }
    }

    function updateTaskUI(data) {
        const percent = Math.min(100, (data.achieved / data.target) * 100);
        document.getElementById('achievedV2').textContent = data.achieved;
        const leftEl = document.getElementById('leftV2');
        leftEl.textContent = data.left;
        leftEl.style.color = data.left > 0 ? '#dc3545' : '#28a745';
        const bar = document.getElementById('progressBarV2');
        bar.style.width = `${percent}%`;
        bar.style.background = percent >= 100 ? '#28a745' : '#007bff';
    }

    function addResetButton() {
        const btn = document.createElement('button');
        btn.textContent = 'Reset All';
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
            if (confirm('Reset all progress?')) {
                const taskId = new URLSearchParams(window.location.search).get('taskIds');
                localStorage.removeItem(TASK_STORAGE_KEY);
                localStorage.removeItem(STOPWATCH_STORAGE_KEY); // ✅ Clear stopwatch too
                sessionStorage.setItem('skipTaskCountOnce', 'true');
                if (taskId) sessionStorage.setItem('skipCountForTaskId', taskId);
                location.reload();
            }
        });

        const container = document.getElementById('taskCounterV2');
        if (container) container.appendChild(btn);
    }

    function main() {
        const taskData = initStorage();
        createCounterUI(taskData);
        addResetButton();
        if (isTaskPage) setupTaskCountingOnUnload();
        Stopwatch.setup();
        // ✅ Signature at the very bottom of the panel
        const signature = document.createElement('div');
        signature.innerHTML = `
        <div style="font-size: 11px; color: #888; text-align: center; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #eee; font-style: italic;">
            Built with ❤️ by Sahil Khan
        </div>
    `;
        const container = document.getElementById('taskCounterV2');
        if (container) container.appendChild(signature);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(main, 100);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(main, 100));
    }
})();
