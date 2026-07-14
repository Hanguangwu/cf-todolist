document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginScreen = document.getElementById('login-screen');
    const todoApp = document.getElementById('todo-app');
    const secretKeyInput = document.getElementById('secret-key-input');
    const loginBtn = document.getElementById('login-btn');
    const userEmailDisplay = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');
    const newTodoForm = document.getElementById('new-todo-form');
    const newTodoInput = document.getElementById('new-todo-input');
    const newTodoType = document.getElementById('new-todo-type');
    const todoList = document.getElementById('todo-list');

    // --- State ---
    const state = {
        currentView: 'daily',
        daily: { date: new Date().toISOString().slice(0, 10) },
        weekly: getCurrentWeekInfo(),
        monthly: { month: new Date().toISOString().slice(0, 7) },
        kanban: { year: new Date().getFullYear() },
        analytics: { year: new Date().getFullYear() },
        chartInstances: {}
    };

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

    function formatDateShort(date) {
        const m = date.getMonth() + 1;
        const d = date.getDate();
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        return `${m}月${d}日 周${dayNames[date.getDay()]}`;
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
                const error = await response.json();
                alert(`错误: ${error.error}`);
                throw new Error(error.error);
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

        updateTodoStatus(id, status) {
            return this.request(`/todos/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status }),
            });
        },

        reorderTodo(id, data) {
            return this.request(`/todos/${id}/reorder`, {
                method: 'PUT',
                body: JSON.stringify(data),
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
            kanban: loadKanbanView,
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

    function createTaskTypeBadge(type) {
        const badge = document.createElement('span');
        badge.className = 'task-type-badge ' + type;
        const labels = { daily: '每日', weekly: '每周', monthly: '每月' };
        badge.textContent = labels[type] || type;
        return badge;
    }

    function createTodoListItem(todo, { showType = true, onToggle, onDelete } = {}) {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        li.dataset.id = todo.id;

        const contentSpan = document.createElement('span');
        contentSpan.className = 'content';
        contentSpan.textContent = todo.content;

        li.innerHTML = '<div class="checkbox"></div>';
        li.appendChild(contentSpan);

        if (showType && todo.task_type && todo.task_type !== 'daily') {
            li.appendChild(createTaskTypeBadge(todo.task_type));
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        li.appendChild(delBtn);

        const checkbox = li.querySelector('.checkbox');
        checkbox.addEventListener('click', () => {
            const newState = !todo.completed;
            (onToggle || toggleTodoCompletion)(todo.id, newState, li);
        });
        delBtn.addEventListener('click', () => {
            (onDelete || deleteTodoItem)(todo.id, li);
        });

        return li;
    }

    // --- Auth & Login (unchanged logic) ---

    function setLoginView(isLoggedIn) {
        if (isLoggedIn) {
            loginScreen.classList.add('hidden');
            todoApp.classList.remove('hidden');
            userEmailDisplay.textContent = '已登录';
            switchView('daily');
        } else {
            loginScreen.classList.remove('hidden');
            todoApp.classList.add('hidden');
            localStorage.removeItem('todo_token');
            Object.values(state.chartInstances).forEach(c => { if (c) c.destroy(); });
            state.chartInstances = {};
        }
    }

    async function handleLogin() {
        const secretKey = secretKeyInput.value.trim();
        if (!secretKey) {
            alert('请输入密钥。');
            return;
        }
        try {
            const data = await api.login(secretKey);
            localStorage.setItem('todo_token', data.token);
            secretKeyInput.value = '';
            setLoginView(true);
        } catch (error) {
            console.error('登录失败:', error);
        }
    }

    function handleLogout() {
        setLoginView(false);
    }

    // --- Daily View ---

    async function loadDailyView() {
        const date = state.daily.date;
        document.getElementById('daily-date-label').textContent = formatDateShort(new Date(date + 'T00:00:00'));

        try {
            const todos = await api.getTodos({ type: 'daily', date });
            renderDailyTodos(todos);
        } catch (error) {
            console.error('加载每日任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderDailyTodos(todos) {
        todoList.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        let completedCount = 0;
        todos.forEach(todo => {
            todoList.appendChild(createTodoListItem(todo, { showType: true }));
            if (todo.completed) completedCount++;
        });

        updateProgressBar('daily-progress-fill', 'daily-progress-label', completedCount, todos.length);
        document.getElementById('daily-empty').classList.toggle('visible', todos.length === 0);
    }

    function changeDate(delta) {
        const d = new Date(state.daily.date + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        state.daily.date = d.toISOString().slice(0, 10);
        loadDailyView();
    }

    function goToToday() {
        state.daily.date = new Date().toISOString().slice(0, 10);
        loadDailyView();
    }

    async function handleAddTodo(e) {
        e.preventDefault();
        const content = newTodoInput.value.trim();
        if (!content) return;

        const taskType = newTodoType.value;
        let targetDate;
        const now = new Date();

        if (taskType === 'daily') {
            targetDate = state.daily.date || now.toISOString().slice(0, 10);
        } else if (taskType === 'weekly') {
            const wn = getWeekNumber(now);
            targetDate = formatWeek(now.getFullYear(), wn);
        } else if (taskType === 'monthly') {
            targetDate = now.toISOString().slice(0, 7);
        }

        try {
            const newTodo = await api.createTodo({
                content,
                task_type: taskType,
                target_date: targetDate,
                status: 'todo'
            });
            if (state.currentView === 'daily') {
                todoList.appendChild(createTodoListItem(newTodo, { showType: true }));
                document.getElementById('daily-empty').classList.remove('visible');
                updateProgressBar('daily-progress-fill', 'daily-progress-label', 0, todoList.children.length);
            }
            newTodoInput.value = '';
        } catch (error) {
            console.error('创建 todo 失败:', error);
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
        const list = document.getElementById('weekly-todo-list');
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        let completedCount = 0;
        todos.forEach(todo => {
            list.appendChild(createTodoListItem(todo, { showType: true }));
            if (todo.completed) completedCount++;
        });

        updateProgressBar('weekly-progress-fill', 'weekly-progress-label', completedCount, todos.length);
        document.getElementById('weekly-empty').classList.toggle('visible', todos.length === 0);
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

    // --- Monthly View ---

    async function loadMonthlyView() {
        const month = state.monthly.month;
        const parts = month.split('-');
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        const label = `${y}年${m}月`;
        document.getElementById('monthly-date-label').textContent = label;

        try {
            const todos = await api.getTodos({ type: 'monthly', month });
            renderMonthlyTodos(todos);
        } catch (error) {
            console.error('加载每月任务失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderMonthlyTodos(todos) {
        const list = document.getElementById('monthly-todo-list');
        list.innerHTML = '';
        todos.sort((a, b) => (a.order || 0) - (b.order || 0) - (new Date(a.created_at) - new Date(b.created_at)));

        let completedCount = 0;
        todos.forEach(todo => {
            list.appendChild(createTodoListItem(todo, { showType: true }));
            if (todo.completed) completedCount++;
        });

        updateProgressBar('monthly-progress-fill', 'monthly-progress-label', completedCount, todos.length);
        document.getElementById('monthly-empty').classList.toggle('visible', todos.length === 0);
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
        state.monthly.month = new Date().toISOString().slice(0, 7);
        loadMonthlyView();
    }

    // --- Kanban View ---

    async function loadKanbanView() {
        const year = state.kanban.year;
        document.getElementById('kanban-year-label').textContent = `${year}年`;

        try {
            const todos = await api.getTodos({ type: 'kanban', year: String(year) });
            renderKanban(todos);
        } catch (error) {
            console.error('加载看板失败:', error);
            if (error.message && error.message.includes('认证失败')) handleLogout();
        }
    }

    function renderKanban(todos) {
        const columns = {
            todo: document.getElementById('kanban-todo'),
            in_progress: document.getElementById('kanban-in-progress'),
            done: document.getElementById('kanban-done'),
        };

        Object.values(columns).forEach(el => el.innerHTML = '');

        const grouped = { todo: [], in_progress: [], done: [] };
        todos.forEach(t => {
            const status = t.status || 'todo';
            if (grouped[status]) grouped[status].push(t);
            else grouped.todo.push(t);
        });

        let totalCount = 0;
        Object.keys(grouped).forEach(status => {
            grouped[status].sort((a, b) => (a.order || 0) - (b.order || 0));
            grouped[status].forEach(todo => {
                const card = createKanbanCard(todo);
                columns[status].appendChild(card);
                totalCount++;
            });
        });

        document.getElementById('kanban-empty').classList.toggle('visible', totalCount === 0);
    }

    function createKanbanCard(todo) {
        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.draggable = true;
        card.dataset.id = todo.id;
        card.dataset.status = todo.status || 'todo';

        const content = document.createElement('div');
        content.className = 'card-content';
        content.textContent = todo.content;
        card.appendChild(content);

        const meta = document.createElement('div');
        meta.className = 'card-meta';
        if (todo.task_type && todo.task_type !== 'daily') {
            meta.appendChild(createTaskTypeBadge(todo.task_type));
        }

        const dateSpan = document.createElement('span');
        dateSpan.style.color = '#aaa';
        dateSpan.style.fontSize = '0.75em';
        if (todo.target_date) {
            dateSpan.textContent = todo.target_date;
        }
        meta.appendChild(dateSpan);
        card.appendChild(meta);

        // Drag events
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({
                id: todo.id,
                sourceStatus: todo.status || 'todo'
            }));
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('.kanban-column').forEach(col => {
                col.classList.remove('drag-over');
            });
        });

        return card;
    }

    function setupKanbanDropZones() {
        document.querySelectorAll('.kanban-column').forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                column.classList.add('drag-over');
            });
            column.addEventListener('dragleave', () => {
                column.classList.remove('drag-over');
            });
            column.addEventListener('drop', async (e) => {
                e.preventDefault();
                column.classList.remove('drag-over');

                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const newStatus = column.dataset.status;
                if (data.sourceStatus === newStatus) {
                    const card = document.querySelector(`.kanban-card[data-id="${data.id}"]`);
                    if (card && card.parentElement) return;
                }

                try {
                    await api.updateTodoStatus(data.id, newStatus);
                    const card = document.querySelector(`.kanban-card[data-id="${data.id}"]`);
                    if (card) {
                        card.dataset.status = newStatus;
                        const targetContainer = column.querySelector('.kanban-cards');
                        targetContainer.appendChild(card);
                    }
                } catch (error) {
                    console.error('更新看板状态失败:', error);
                }
            });
        });
    }

    function changeKanbanYear(delta) {
        state.kanban.year += delta;
        loadKanbanView();
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
        // Summary cards
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

        // Streak display
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

        // Weekly ranking
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

        // Charts
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

    // --- Shared Actions ---

    async function toggleTodoCompletion(id, completed, li) {
        try {
            await api.updateTodo(id, completed);
            li.classList.toggle('completed', completed);
            const checkbox = li.querySelector('.checkbox');
            const newState = !completed;
            checkbox.onclick = () => toggleTodoCompletion(id, newState, li);
            // Refresh progress in current view
            if (state.currentView === 'daily') loadDailyView();
            else if (state.currentView === 'weekly') loadWeeklyView();
            else if (state.currentView === 'monthly') loadMonthlyView();
        } catch (error) {
            console.error('更新 todo 失败:', error);
        }
    }

    async function deleteTodoItem(id, li) {
        if (!confirm('确定要删除这项待办吗？')) return;
        try {
            await api.deleteTodo(id);
            li.remove();
            if (state.currentView === 'daily') loadDailyView();
            else if (state.currentView === 'weekly') loadWeeklyView();
            else if (state.currentView === 'monthly') loadMonthlyView();
            else if (state.currentView === 'kanban') loadKanbanView();
        } catch (error) {
            console.error('删除 todo 失败:', error);
        }
    }

    function updateProgressBar(fillId, labelId, completed, total) {
        const fill = document.getElementById(fillId);
        const label = document.getElementById(labelId);
        if (!fill || !label) return;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        fill.style.width = pct + '%';
        label.textContent = total > 0 ? `${completed}/${total} (${pct}%)` : '0%';
    }

    // --- Event Binding ---

    function init() {
        // Login
        loginBtn.addEventListener('click', handleLogin);
        secretKeyInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        logoutBtn.addEventListener('click', handleLogout);

        // Tab clicks
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        // Daily controls
        document.getElementById('daily-prev').addEventListener('click', () => changeDate(-1));
        document.getElementById('daily-next').addEventListener('click', () => changeDate(1));
        document.getElementById('daily-today').addEventListener('click', goToToday);

        // Weekly controls
        document.getElementById('weekly-prev').addEventListener('click', () => changeWeek(-1));
        document.getElementById('weekly-next').addEventListener('click', () => changeWeek(1));
        document.getElementById('weekly-current').addEventListener('click', goToCurrentWeek);

        // Monthly controls
        document.getElementById('monthly-prev').addEventListener('click', () => changeMonth(-1));
        document.getElementById('monthly-next').addEventListener('click', () => changeMonth(1));
        document.getElementById('monthly-current').addEventListener('click', goToCurrentMonth);

        // Kanban controls
        document.getElementById('kanban-year-prev').addEventListener('click', () => changeKanbanYear(-1));
        document.getElementById('kanban-year-next').addEventListener('click', () => changeKanbanYear(1));

        // Kanban drop zones
        setupKanbanDropZones();

        // Analytics controls
        document.getElementById('analytics-year-prev').addEventListener('click', () => changeAnalyticsYear(-1));
        document.getElementById('analytics-year-next').addEventListener('click', () => changeAnalyticsYear(1));

        // New todo form
        newTodoForm.addEventListener('submit', handleAddTodo);

        // Auto-init view state
        if (localStorage.getItem('todo_token')) {
            setLoginView(true);
        } else {
            setLoginView(false);
        }
    }

    init();
});
