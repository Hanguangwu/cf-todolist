document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginScreen = document.getElementById('login-screen');
    const todoApp = document.getElementById('todo-app');
    const secretKeyInput = document.getElementById('secret-key-input');
    const loginBtn = document.getElementById('login-btn');
    const userEmailDisplay = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    // --- Week Calculation Utilities ---

    function getWeekDateRange(year, weekNum) {
        const jan1 = new Date(year, 0, 1);
        const dow = jan1.getDay();
        const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
        if (weekNum === 1) {
            return {
                start: new Date(year, 0, 1),
                end: new Date(year, 0, 1 + daysUntilSunday)
            };
        }
        const week2Start = new Date(year, 0, 1 + daysUntilSunday + 1);
        const start = new Date(week2Start);
        start.setDate(start.getDate() + (weekNum - 2) * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return { start, end };
    }

    function getWeekNumber(date) {
        const year = date.getFullYear();
        const jan1 = new Date(year, 0, 1);
        const dow = jan1.getDay();
        const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
        const week1End = new Date(year, 0, 1 + daysUntilSunday);
        if (date <= week1End) return 1;
        const week2Start = new Date(year, 0, 1 + daysUntilSunday + 1);
        const diffDays = Math.floor((date - week2Start) / (24 * 60 * 60 * 1000));
        return 2 + Math.floor(diffDays / 7);
    }

    function formatWeek(year, weekNum) {
        return `${year}-W${String(weekNum).padStart(2, '0')}`;
    }

    function parseWeek(weekStr) {
        const m = weekStr.match(/^(\d{4})-W(\d{2})$/);
        if (!m) return null;
        return { year: parseInt(m[1]), weekNum: parseInt(m[2]) };
    }

    function getCurrentWeekInfo() {
        const now = new Date();
        const wn = getWeekNumber(now);
        const range = getWeekDateRange(now.getFullYear(), wn);
        return {
            year: now.getFullYear(),
            weekNum: wn,
            label: `${now.getFullYear()}年 第${wn}周 (${formatDate(range.start)} - ${formatDate(range.end)})`
        };
    }

    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getTotalWeeksInYear(year) {
        const jan1 = new Date(year, 0, 1);
        const dow = jan1.getDay();
        const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
        const remainingDays = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 - 1 - daysUntilSunday : 365 - 1 - daysUntilSunday;
        return 1 + Math.ceil(remainingDays / 7);
    }

    function getLastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    // --- State ---
    const state = {
        currentView: 'daily',
        daily: { date: formatDate(new Date()) },
        weekly: getCurrentWeekInfo(),
        monthly: { month: formatDate(new Date()).slice(0, 7) },
        ongoing: {
            week: getCurrentWeekInfo(),
            month: formatDate(new Date()).slice(0, 7)
        },
        analytics: { year: new Date().getFullYear() },
        chartInstances: {}
    };

    // --- API Abstraction ---

    const api = {
        async request(endpoint, options = {}) {
            const token = localStorage.getItem('todo_token');
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers,
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const response = await fetch(`/api${endpoint}`, { ...options, headers });
            if (!response.ok) {
                let errorMsg = '请求失败';
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || `HTTP ${response.status}`;
                } catch (_) {
                    try {
                        const text = await response.text();
                        errorMsg = text || `HTTP ${response.status}`;
                    } catch (_) {
                        errorMsg = `HTTP ${response.status}`;
                    }
                }
                showError(errorMsg);
                throw new Error(errorMsg);
            }
            if (response.status === 204) return;
            return response.json();
        },

        login(secretKey) {
            return this.request('/login', {
                method: 'POST',
                body: JSON.stringify({ secret_key: secretKey }),
            });
        },

        getTodos(params = {}) {
            const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
            return this.request('/todos' + qs);
        },

        createTodo(data) {
            return this.request('/todos', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },

        updateTodo(id, completed) {
            return this.request(`/todos/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ completed }),
            });
        },

        deleteTodo(id) {
            return this.request(`/todos/${id}`, {
                method: 'DELETE',
            });
        },

        getAnalytics(year) {
            return this.request(`/analytics?year=${year}`);
        },
    };

    // --- View Switching ---

    function switchView(viewName) {
        state.currentView = viewName;

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });

        document.querySelectorAll('.view-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'view-' + viewName);
        });

        const loaders = {
            daily: loadDailyView,
            weekly: loadWeeklyView,
            monthly: loadMonthlyView,
            ongoing: loadOngoingView,
            analytics: loadAnalyticsView,
        };
        if (loaders[viewName]) loaders[viewName]();
    }

    // --- Common Render Helpers ---

    function escapeHTML(str) {
        return str.replace(/[&<>"']/g, function(match) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match];
        });
    }

    function createTodoListItem(todo) {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        li.dataset.id = todo.id;

        const checkbox = document.createElement('div');
        checkbox.className = 'checkbox';

        const contentSpan = document.createElement('span');
        contentSpan.className = 'content';
        contentSpan.textContent = todo.content;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';

        li.appendChild(checkbox);
        li.appendChild(contentSpan);
        li.appendChild(delBtn);

        checkbox.addEventListener('click', () => {
            toggleTodoCompletion(todo.id, li);
        });
        delBtn.addEventListener('click', () => {
            deleteTodoItem(todo.id, li);
        });

        return li;
    }

    // --- Auth & Login ---

    function setLoginView(isLoggedIn) {
        if (isLoggedIn) {
            loginScreen.classList.add('hidden');
            todoApp.classList.remove('hidden');
            document.body.classList.add('logged-in');
            userEmailDisplay.textContent = '已登录';
            switchView('daily');
        } else {
            loginScreen.classList.remove('hidden');
            todoApp.classList.add('hidden');
            document.body.classList.remove('logged-in');
            localStorage.removeItem('todo_token');
            Object.values(state.chartInstances).forEach(c => { if (c) c.destroy(); });
            state.chartInstances = {};
        }
    }

    function showError(msg) {
        const errEl = document.getElementById('login-error');
        if (errEl) {
            errEl.textContent = msg;
            errEl.classList.add('visible');
        } else {
            alert(msg);
        }
    }

    function clearError() {
        const errEl = document.getElementById('login-error');
        if (errEl) {
            errEl.textContent = '';
            errEl.classList.remove('visible');
        }
    }

    async function handleLogin() {
        const secretKey = secretKeyInput.value.trim();
        if (!secretKey) {
            showError('请输入密钥');
            return;
        }
        clearError();
        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';
        try {
            const data = await api.login(secretKey);
            localStorage.setItem('todo_token', data.token);
            secretKeyInput.value = '';
            setLoginView(true);
        } catch (error) {
            console.error('登录失败:', error);
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = '登录';
        }
    }

    function handleLogout() {
        setLoginView(false);
    }

    // --- Completion Toggle (fixed) ---

    async function toggleTodoCompletion(id, li) {
        const isCompleted = li.classList.contains('completed');
        const newState = !isCompleted;
        try {
            await api.updateTodo(id, newState ? 1 : 0);
            li.classList.toggle('completed', newState);
            updateProgressBarForCurrentView();
        } catch (error) {
            console.error('更新 todo 失败:', error);
        }
    }

    function updateProgressBarForCurrentView() {
        const view = state.currentView;
        if (view === 'daily') {
            updateProgressBar('daily-progress-fill', 'daily-progress-label', 'daily-list');
        } else if (view === 'weekly') {
            updateProgressBar('weekly-progress-fill', 'weekly-progress-label', 'weekly-list');
        } else if (view === 'monthly') {
            updateProgressBar('monthly-progress-fill', 'monthly-progress-label', 'monthly-list');
        }
    }

    async function deleteTodoItem(id, li) {
        if (!confirm('确定要删除这项待办吗？')) return;
        try {
            await api.deleteTodo(id);
            li.remove();
            updateProgressBarForCurrentView();
            updateEmptyHintForCurrentView();
        } catch (error) {
            console.error('删除 todo 失败:', error);
        }
    }

    function updateProgressBar(fillId, labelId, listId) {
        const fill = document.getElementById(fillId);
        const label = document.getElementById(labelId);
        const list = document.getElementById(listId);
        if (!fill || !label || !list) return;
        const items = list.querySelectorAll('.todo-item');
        const total = items.length;
        const completed = list.querySelectorAll('.todo-item.completed').length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        fill.style.width = pct + '%';
        label.textContent = total > 0 ? `${completed}/${total} (${pct}%)` : '0%';
    }

    function updateEmptyHintForCurrentView() {
        const view = state.currentView;
        const map = {
            daily: { list: 'daily-list', empty: 'daily-empty' },
            weekly: { list: 'weekly-list', empty: 'weekly-empty' },
            monthly: { list: 'monthly-list', empty: 'monthly-empty' },
        };
        const cfg = map[view];
        if (!cfg) return;
        const list = document.getElementById(cfg.list);
        const hint = document.getElementById(cfg.empty);
        if (list && hint) {
            hint.classList.toggle('visible', list.children.length === 0);
        }
    }

    // --- Daily View ---

    async function loadDailyView() {
        const date = state.daily.date;
        const picker = document.getElementById('daily-date-picker');
        if (picker) picker.value = date;

        try {
            const todos = await api.getTodos({ type: 'daily', date });
            renderDailyTodos(todos);
        } catch (error) {
            console.error('加载每日任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderDailyTodos(todos) {
        const list = document.getElementById('daily-list');
        if (!list) return;
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        todos.forEach(todo => {
            list.appendChild(createTodoListItem(todo));
        });

        updateProgressBar('daily-progress-fill', 'daily-progress-label', 'daily-list');
        const emptyHint = document.getElementById('daily-empty');
        if (emptyHint) emptyHint.classList.toggle('visible', todos.length === 0);
    }

    function changeDate(delta) {
        const d = new Date(state.daily.date + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        state.daily.date = formatDate(d);
        loadDailyView();
    }

    function goToToday() {
        const now = new Date();
        state.daily.date = formatDate(now);
        loadDailyView();
    }

    async function handleDailyAdd(e) {
        e.preventDefault();
        const input = document.getElementById('daily-input');
        const content = input.value.trim();
        if (!content) return;

        try {
            const newTodo = await api.createTodo({
                content,
                task_type: 'daily',
                target_date: state.daily.date,
                status: 'todo'
            });
            const list = document.getElementById('daily-list');
            list.appendChild(createTodoListItem(newTodo));
            document.getElementById('daily-empty').classList.remove('visible');
            updateProgressBar('daily-progress-fill', 'daily-progress-label', 'daily-list');
            input.value = '';
        } catch (error) {
            console.error('创建每日任务失败:', error);
        }
    }

    // --- Weekly View ---

    async function loadWeeklyView() {
        const { year, weekNum } = state.weekly;
        const range = getWeekDateRange(year, weekNum);
        const weekStr = formatWeek(year, weekNum);
        const label = `${year}年 第${weekNum}周 (${formatDate(range.start)} - ${formatDate(range.end)})`;
        document.getElementById('weekly-date-label').textContent = label;

        try {
            const todos = await api.getTodos({ type: 'weekly', week: weekStr });
            renderWeeklyTodos(todos);
        } catch (error) {
            console.error('加载每周任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderWeeklyTodos(todos) {
        const list = document.getElementById('weekly-list');
        if (!list) return;
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        todos.forEach(todo => {
            list.appendChild(createTodoListItem(todo));
        });

        updateProgressBar('weekly-progress-fill', 'weekly-progress-label', 'weekly-list');
        const emptyHint = document.getElementById('weekly-empty');
        if (emptyHint) emptyHint.classList.toggle('visible', todos.length === 0);
    }

    function changeWeek(delta) {
        const totalWeeks = getTotalWeeksInYear(state.weekly.year);
        let newWeek = state.weekly.weekNum + delta;
        let newYear = state.weekly.year;

        if (newWeek < 1) {
            newYear--;
            newWeek = getTotalWeeksInYear(newYear);
        } else if (newWeek > totalWeeks) {
            newYear++;
            newWeek = 1;
        }

        state.weekly.year = newYear;
        state.weekly.weekNum = newWeek;
        loadWeeklyView();
    }

    function goToCurrentWeek() {
        const now = new Date();
        state.weekly.year = now.getFullYear();
        state.weekly.weekNum = getWeekNumber(now);
        loadWeeklyView();
    }

    async function handleWeeklyAdd(e) {
        e.preventDefault();
        const input = document.getElementById('weekly-input');
        const content = input.value.trim();
        if (!content) return;

        const targetDate = formatWeek(state.weekly.year, state.weekly.weekNum);

        try {
            const newTodo = await api.createTodo({
                content,
                task_type: 'weekly',
                target_date: targetDate,
                status: 'todo'
            });
            const list = document.getElementById('weekly-list');
            list.appendChild(createTodoListItem(newTodo));
            document.getElementById('weekly-empty').classList.remove('visible');
            updateProgressBar('weekly-progress-fill', 'weekly-progress-label', 'weekly-list');
            input.value = '';
        } catch (error) {
            console.error('创建每周任务失败:', error);
        }
    }

    // --- Monthly View ---

    async function loadMonthlyView() {
        const month = state.monthly.month;
        const picker = document.getElementById('monthly-month-picker');
        if (picker) picker.value = month;

        try {
            const todos = await api.getTodos({ type: 'monthly', month });
            renderMonthlyTodos(todos);
        } catch (error) {
            console.error('加载每月任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderMonthlyTodos(todos) {
        const list = document.getElementById('monthly-list');
        if (!list) return;
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        todos.forEach(todo => {
            list.appendChild(createTodoListItem(todo));
        });

        updateProgressBar('monthly-progress-fill', 'monthly-progress-label', 'monthly-list');
        const emptyHint = document.getElementById('monthly-empty');
        if (emptyHint) emptyHint.classList.toggle('visible', todos.length === 0);
    }

    function changeMonth(delta) {
        const parts = state.monthly.month.split('-');
        let y = parseInt(parts[0]);
        let m = parseInt(parts[1]);
        m += delta;
        if (m < 1) { m = 12; y--; }
        if (m > 12) { m = 1; y++; }
        state.monthly.month = `${y}-${String(m).padStart(2, '0')}`;
        loadMonthlyView();
    }

    function goToCurrentMonth() {
        state.monthly.month = formatDate(new Date()).slice(0, 7);
        loadMonthlyView();
    }

    async function handleMonthlyAdd(e) {
        e.preventDefault();
        const input = document.getElementById('monthly-input');
        const content = input.value.trim();
        if (!content) return;

        try {
            const newTodo = await api.createTodo({
                content,
                task_type: 'monthly',
                target_date: state.monthly.month,
                status: 'todo'
            });
            const list = document.getElementById('monthly-list');
            list.appendChild(createTodoListItem(newTodo));
            document.getElementById('monthly-empty').classList.remove('visible');
            updateProgressBar('monthly-progress-fill', 'monthly-progress-label', 'monthly-list');
            input.value = '';
        } catch (error) {
            console.error('创建每月任务失败:', error);
        }
    }

    // --- Ongoing View ---

    async function loadOngoingView() {
        const { year, weekNum } = state.ongoing.week;
        const range = getWeekDateRange(year, weekNum);
        const weekStr = formatWeek(year, weekNum);
        const monthStr = state.ongoing.month;

        const weekLabel = `${year}年 第${weekNum}周`;
        document.getElementById('ongoing-week-label').textContent = weekLabel;
        document.getElementById('ongoing-week-range').textContent =
            `${formatDate(range.start)} - ${formatDate(range.end)}`;

        const monthParts = monthStr.split('-');
        document.getElementById('ongoing-month-label').textContent = `${monthParts[0]}年${monthParts[1]}月`;
        const lastDay = getLastDayOfMonth(parseInt(monthParts[0]), parseInt(monthParts[1]));
        document.getElementById('ongoing-month-range').textContent =
            `${monthStr}-01 ~ ${monthStr}-${String(lastDay).padStart(2, '0')}`;

        try {
            const [weekTodos, monthTodos] = await Promise.all([
                api.getTodos({ type: 'weekly', week: weekStr, completed: '0' }),
                api.getTodos({ type: 'monthly_all', month: monthStr, completed: '0' })
            ]);

            renderOngoingWeekTodos(weekTodos);
            renderOngoingMonthTodos(monthTodos);
        } catch (error) {
            console.error('加载进行中任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderOngoingWeekTodos(todos) {
        const list = document.getElementById('ongoing-week-list');
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        const seen = new Set();
        todos.forEach(todo => {
            if (seen.has(todo.id)) return;
            seen.add(todo.id);
            const li = createTodoListItem(todo);
            if (todo.task_type && todo.task_type !== 'daily') {
                const badge = document.createElement('span');
                badge.className = 'task-type-badge ' + todo.task_type;
                const labels = { weekly: '每周', monthly: '每月' };
                badge.textContent = labels[todo.task_type] || todo.task_type;
                li.querySelector('.content').after(badge);
            }
            list.appendChild(li);
        });

        document.getElementById('ongoing-week-empty').classList.toggle('visible', list.children.length === 0);
    }

    function renderOngoingMonthTodos(todos) {
        const list = document.getElementById('ongoing-month-list');
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        const seen = new Set();
        todos.forEach(todo => {
            if (seen.has(todo.id)) return;
            seen.add(todo.id);
            const li = createTodoListItem(todo);
            if (todo.task_type !== 'monthly') {
                const badge = document.createElement('span');
                badge.className = 'task-type-badge ' + todo.task_type;
                const labels = { daily: '每日', weekly: '每周' };
                badge.textContent = labels[todo.task_type] || todo.task_type;
                li.querySelector('.content').after(badge);
            }
            list.appendChild(li);
        });

        document.getElementById('ongoing-month-empty').classList.toggle('visible', list.children.length === 0);
    }

    function changeOngoingWeek(delta) {
        const totalWeeks = getTotalWeeksInYear(state.ongoing.week.year);
        let newWeek = state.ongoing.week.weekNum + delta;
        let newYear = state.ongoing.week.year;
        if (newWeek < 1) { newYear--; newWeek = getTotalWeeksInYear(newYear); }
        else if (newWeek > totalWeeks) { newYear++; newWeek = 1; }
        state.ongoing.week.year = newYear;
        state.ongoing.week.weekNum = newWeek;
        loadOngoingView();
    }

    function goToOngoingThisWeek() {
        const now = new Date();
        state.ongoing.week.year = now.getFullYear();
        state.ongoing.week.weekNum = getWeekNumber(now);
        loadOngoingView();
    }

    function changeOngoingMonth(delta) {
        const parts = state.ongoing.month.split('-');
        let y = parseInt(parts[0]);
        let m = parseInt(parts[1]);
        m += delta;
        if (m < 1) { m = 12; y--; }
        if (m > 12) { m = 1; y++; }
        state.ongoing.month = `${y}-${String(m).padStart(2, '0')}`;
        loadOngoingView();
    }

    function goToOngoingThisMonth() {
        state.ongoing.month = formatDate(new Date()).slice(0, 7);
        loadOngoingView();
    }

    // --- Analytics View ---

    async function loadAnalyticsView() {
        const year = state.analytics.year;
        document.getElementById('analytics-year-label').textContent = `${year}年`;

        try {
            const data = await api.getAnalytics(year);
            renderAnalytics(data);
        } catch (error) {
            console.error('加载分析数据失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderAnalytics(data) {
        const summaryHtml = `
            <div class="stats-card">
                <div class="stat-value">${data.summary.total_tasks}</div>
                <div class="stat-label">总任务</div>
            </div>
            <div class="stats-card">
                <div class="stat-value green">${data.summary.completed}</div>
                <div class="stat-label">已完成</div>
            </div>
            <div class="stats-card">
                <div class="stat-value orange">${Math.round(data.summary.completion_rate * 100)}%</div>
                <div class="stat-label">完成率</div>
            </div>
        `;
        document.getElementById('analytics-summary').innerHTML = summaryHtml;

        const streakHtml = `
            <div class="streak-title">🔥 连续完成</div>
            <div class="streak-numbers">
                <div class="streak-item">
                    <div class="number">${data.streak.current}</div>
                    <div class="label">当前连续</div>
                </div>
                <div class="streak-item">
                    <div class="number">${data.streak.longest}</div>
                    <div class="label">最长连续</div>
                </div>
            </div>
        `;
        document.getElementById('analytics-streak').innerHTML = streakHtml;

        const rankingHtml = `
            <h3>📅 周完成率排行</h3>
            <table>
                <thead>
                    <tr><th>周</th><th>完成率</th><th>进度</th></tr>
                </thead>
                <tbody>
                    ${(data.weekly_completion || []).sort((a, b) => b.rate - a.rate).slice(0, 10).map(w => `
                        <tr>
                            <td>${w.week}</td>
                            <td>${w.completed}/${w.total}</td>
                            <td>
                                <div class="rank-bar">
                                    <div class="rank-bar-fill" style="width:${Math.round(w.rate * 100)}%"></div>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        document.getElementById('analytics-weekly-rank').innerHTML = rankingHtml;

        renderTrendChart(data);
        renderTypeChart(data);
    }

    function renderTrendChart(data) {
        const canvas = document.getElementById('trend-chart');
        if (state.chartInstances.trend) {
            state.chartInstances.trend.destroy();
        }

        const months = (data.by_month || []).map(m => m.month);
        const totals = (data.by_month || []).map(m => m.total);
        const completed = (data.by_month || []).map(m => m.completed);

        const ctx = canvas.getContext('2d');
        state.chartInstances.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    {
                        label: '完成任务',
                        data: completed,
                        borderColor: '#4a90e2',
                        backgroundColor: 'rgba(74, 144, 226, 0.1)',
                        fill: true,
                        tension: 0.3,
                    },
                    {
                        label: '总任务',
                        data: totals,
                        borderColor: '#e67e22',
                        backgroundColor: 'rgba(230, 126, 34, 0.1)',
                        fill: true,
                        tension: 0.3,
                        borderDash: [5, 5],
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 12, font: { size: 11 } }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { font: { size: 10 }, stepSize: 1 }
                    },
                    x: {
                        ticks: { font: { size: 10 } }
                    }
                }
            }
        });
    }

    function renderTypeChart(data) {
        const canvas = document.getElementById('type-chart');
        if (state.chartInstances.type) {
            state.chartInstances.type.destroy();
        }

        const labels = [];
        const values = [];
        const colors = ['#3498db', '#e67e22', '#27ae60'];

        ['daily', 'weekly', 'monthly'].forEach(type => {
            if (data.by_type[type] && data.by_type[type].total > 0) {
                const names = { daily: '每日', weekly: '每周', monthly: '每月' };
                labels.push(names[type]);
                values.push(data.by_type[type].total);
            }
        });

        const ctx = canvas.getContext('2d');
        state.chartInstances.type = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.slice(0, values.length),
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 12, font: { size: 11 } }
                    }
                }
            }
        });
    }

    function changeAnalyticsYear(delta) {
        state.analytics.year += delta;
        loadAnalyticsView();
    }

    // --- Event Binding ---

    function init() {
        loginBtn.addEventListener('click', handleLogin);
        secretKeyInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        logoutBtn.addEventListener('click', handleLogout);

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        document.getElementById('daily-prev').addEventListener('click', () => changeDate(-1));
        document.getElementById('daily-next').addEventListener('click', () => changeDate(1));
        document.getElementById('daily-today').addEventListener('click', goToToday);
        document.getElementById('daily-date-picker').addEventListener('change', function () {
            if (this.value) {
                state.daily.date = this.value;
                loadDailyView();
            }
        });
        document.getElementById('daily-form').addEventListener('submit', handleDailyAdd);

        document.getElementById('weekly-prev').addEventListener('click', () => changeWeek(-1));
        document.getElementById('weekly-next').addEventListener('click', () => changeWeek(1));
        document.getElementById('weekly-current').addEventListener('click', goToCurrentWeek);

        const weeklyLabel = document.getElementById('weekly-date-label');
        const weeklyEdit = document.getElementById('weekly-week-edit');
        weeklyLabel.addEventListener('click', () => {
            weeklyEdit.value = state.weekly.weekNum;
            weeklyEdit.style.display = 'inline-block';
            weeklyLabel.style.display = 'none';
            weeklyEdit.focus();
            weeklyEdit.select();
        });
        function commitWeekEdit() {
            const val = parseInt(weeklyEdit.value);
            if (!isNaN(val) && val >= 1) {
                const totalWeeks = getTotalWeeksInYear(state.weekly.year);
                if (val <= totalWeeks) {
                    state.weekly.weekNum = val;
                    loadWeeklyView();
                }
            }
            weeklyEdit.style.display = 'none';
            weeklyLabel.style.display = 'inline';
        }
        weeklyEdit.addEventListener('blur', commitWeekEdit);
        weeklyEdit.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                weeklyEdit.blur();
            } else if (e.key === 'Escape') {
                weeklyEdit.style.display = 'none';
                weeklyLabel.style.display = 'inline';
            }
        });
        document.getElementById('weekly-form').addEventListener('submit', handleWeeklyAdd);

        document.getElementById('monthly-prev').addEventListener('click', () => changeMonth(-1));
        document.getElementById('monthly-next').addEventListener('click', () => changeMonth(1));
        document.getElementById('monthly-current').addEventListener('click', goToCurrentMonth);
        document.getElementById('monthly-month-picker').addEventListener('change', function () {
            if (this.value) {
                state.monthly.month = this.value;
                loadMonthlyView();
            }
        });
        document.getElementById('monthly-form').addEventListener('submit', handleMonthlyAdd);

        document.getElementById('ongoing-week-prev').addEventListener('click', () => changeOngoingWeek(-1));
        document.getElementById('ongoing-week-next').addEventListener('click', () => changeOngoingWeek(1));
        document.getElementById('ongoing-this-week').addEventListener('click', goToOngoingThisWeek);
        document.getElementById('ongoing-month-prev').addEventListener('click', () => changeOngoingMonth(-1));
        document.getElementById('ongoing-month-next').addEventListener('click', () => changeOngoingMonth(1));
        document.getElementById('ongoing-this-month').addEventListener('click', goToOngoingThisMonth);

        document.getElementById('analytics-year-prev').addEventListener('click', () => changeAnalyticsYear(-1));
        document.getElementById('analytics-year-next').addEventListener('click', () => changeAnalyticsYear(1));

        if (localStorage.getItem('todo_token')) {
            setLoginView(true);
        } else {
            setLoginView(false);
        }
    }

    init();
});
