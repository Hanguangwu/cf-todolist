/**
 * Welcome to Cloudflare Pages Functions.
 *
 * This is a single file that acts as the backend for the Todo List app.
 * It's deployed as a Cloudflare Worker alongside the static site.
 *
 * - It uses a router to handle different API endpoints (/login, /todos, etc.).
 * - It authenticates users with a simple token stored in Cloudflare KV.
 * - It persists todo items in Cloudflare D1.
 *
 * Bindings (configured in Cloudflare Pages dashboard):
 * - `DB`: The D1 database instance.
 * - `TODO_SESSIONS`: The KV namespace for storing session tokens.
 */

/**
 * SQL Migration (run in D1 Console):
 * ALTER TABLE todos ADD COLUMN task_type TEXT DEFAULT 'daily';
 * ALTER TABLE todos ADD COLUMN target_date TEXT;
 * ALTER TABLE todos ADD COLUMN status TEXT DEFAULT 'todo';
 * ALTER TABLE todos ADD COLUMN "order" INTEGER DEFAULT 0;
 */

// A simple router utility
const Router = () => {
    const routes = [];
    const add = (method, path, handler) => {
        routes.push({ method, path, handler });
    };
    const handler = async (request, env, ctx) => {
        const url = new URL(request.url);
        for (const route of routes) {
            // Match method
            if (request.method !== route.method) continue;

            // Match path using a simple pattern matcher
            const pattern = new RegExp(`^${route.path.replace(/:\w+/g, '([^/]+)')}$`);
            const match = url.pathname.match(pattern);
            
            if (match) {
                const params = {};
                const keys = (route.path.match(/:\w+/g) || []).map(key => key.substring(1));
                keys.forEach((key, i) => {
                    params[key] = match[i + 1];
                });
                
                return await route.handler({ request, env, ctx, params });
            }
        }
        return new Response('Not Found', { status: 404 });
    };
    return {
        get: (path, handler) => add('GET', path, handler),
        post: (path, handler) => add('POST', path, handler),
        put: (path, handler) => add('PUT', path, handler),
        delete: (path, handler) => add('DELETE', path, handler),
        handler,
    };
};

const router = Router();

// --- Week Calculation Utilities ---

/**
 * Get the date range for a given week number in a year.
 * Week 1 starts on Jan 1, ends on the first Sunday.
 * Week 2+ are Mon-Sun, 7 days each.
 * @param {number} year
 * @param {number} weekNum (1-indexed)
 * @returns {{ start: Date, end: Date }}
 */
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

/**
 * Get the week number for a given date.
 * @param {Date} date
 * @returns {number}
 */
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

/**
 * Format a year+week into "YYYY-WNN" format.
 * @param {number} year
 * @param {number} weekNum
 * @returns {string}
 */
function formatWeek(year, weekNum) {
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Parse a "YYYY-WNN" week string into { year, weekNum }.
 * @param {string} weekStr
 * @returns {{ year: number, weekNum: number } | null}
 */
function parseWeek(weekStr) {
    const m = weekStr.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return null;
    return { year: parseInt(m[1]), weekNum: parseInt(m[2]) };
}

/**
 * Get the last day of a month for a given year/month.
 * @param {number} year
 * @param {number} month (1-indexed)
 * @returns {number}
 */
function getLastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

// --- Middleware for Authentication ---

/**
 * Extracts the user email from the JWT-like token.
 * @param {Request} request
 * @param {object} env - Cloudflare environment variables
 * @returns {string|null} User email or null if invalid
 */
async function authenticateUser(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);
    
    const userEmail = await env.TODO_SESSIONS.get(token);
    return userEmail || null;
}

/**
 * JSON response helper.
 */
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Auth check helper — returns a 401 Response or null if authenticated.
 * @returns {Response|null}
 */
async function authGuard(request, env) {
    const userEmail = await authenticateUser(request, env);
    if (!userEmail) {
        return { userEmail: null, error: jsonResponse({ error: '认证失败' }, 401) };
    }
    return { userEmail, error: null };
}

// --- API Route Handlers ---

/**
 * POST /api/login
 * Authenticates using a secret key stored in env.APP_SECRET_KEY.
 * Configure APP_SECRET_KEY in Cloudflare Workers > Settings > Variables.
 */
router.post('/api/login', async ({ request, env }) => {
    const { secret_key } = await request.json();
    if (!secret_key || secret_key !== env.APP_SECRET_KEY) {
        return jsonResponse({ error: '密钥无效' }, 401);
    }

    const token = `token_${crypto.randomUUID()}`;

    await env.TODO_SESSIONS.put(token, 'default_user', { expirationTtl: 60 * 60 * 24 * 7 });

    return jsonResponse({ token });
});

/**
 * GET /api/todos
 * Fetches todos for the authenticated user with optional filtering.
 *
 * Query params:
 *   type: 'daily' | 'weekly' | 'monthly' | 'kanban' | 'all' (default)
 *   date: 'YYYY-MM-DD'        (type=daily)
 *   week: 'YYYY-WNN'          (type=weekly)
 *   month: 'YYYY-MM'          (type=monthly)
 *   year: 'YYYY'              (type=kanban)
 */
router.get('/api/todos', async ({ request, env }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all';
    const completedFilter = url.searchParams.get('completed');
    const baseColumns = 'id, content, completed, task_type, target_date, status, "order", created_at';

    let sql, binds;

    if (type === 'daily' && url.searchParams.get('date')) {
        const date = url.searchParams.get('date');
        sql = `SELECT ${baseColumns} FROM todos WHERE user_email = ? AND task_type = 'daily' AND target_date = ? ORDER BY "order" ASC, created_at ASC`;
        binds = [userEmail, date];

    } else if (type === 'weekly' && url.searchParams.get('week')) {
        const weekStr = url.searchParams.get('week');
        const parsed = parseWeek(weekStr);
        if (!parsed) return jsonResponse({ error: '无效的周参数' }, 400);
        const { start, end } = getWeekDateRange(parsed.year, parsed.weekNum);
        const startStr = start.toISOString().slice(0, 10);
        const endStr = end.toISOString().slice(0, 10);
        sql = `SELECT ${baseColumns} FROM todos WHERE user_email = ? AND (
            (task_type = 'weekly' AND target_date = ?) OR
            (task_type = 'daily' AND target_date >= ? AND target_date <= ?)
        ) ORDER BY "order" ASC, created_at ASC`;
        binds = [userEmail, weekStr, startStr, endStr];

    } else if (type === 'monthly' && url.searchParams.get('month')) {
        const month = url.searchParams.get('month');
        const parts = month.split('-');
        const year = parseInt(parts[0]);
        const mon = parseInt(parts[1]);
        const lastDay = getLastDayOfMonth(year, mon);
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
        sql = `SELECT ${baseColumns} FROM todos WHERE user_email = ? AND (
            (task_type = 'monthly' AND target_date = ?) OR
            (task_type = 'daily' AND target_date >= ? AND target_date <= ?)
        ) ORDER BY "order" ASC, created_at ASC`;
        binds = [userEmail, month, monthStart, monthEnd];

    } else if (type === 'kanban' && url.searchParams.get('year')) {
        const year = url.searchParams.get('year');
        sql = `SELECT ${baseColumns} FROM todos WHERE user_email = ? AND (target_date LIKE ? OR strftime('%Y', created_at) = ?) ORDER BY status, "order" ASC, created_at ASC`;
        binds = [userEmail, `${year}%`, year];

    } else {
        sql = `SELECT ${baseColumns} FROM todos WHERE user_email = ? ORDER BY created_at DESC`;
        binds = [userEmail];
    }

    let { results } = await env.DB.prepare(sql).bind(...binds).all();
    if (completedFilter !== null) {
        const compVal = parseInt(completedFilter);
        results = results.filter(t => t.completed === compVal);
    }
    return jsonResponse(results);
});

/**
 * POST /api/todos
 * Creates a new todo for the authenticated user.
 * Accepts optional fields: task_type, target_date, status
 */
router.post('/api/todos', async ({ request, env }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const body = await request.json();
    const { content, task_type, target_date, status } = body;
    if (!content) {
        return jsonResponse({ error: 'Content is required' }, 400);
    }

    const type = task_type || 'daily';
    let date = target_date;
    if (!date) {
        const now = new Date();
        if (type === 'daily') {
            date = now.toISOString().slice(0, 10);
        } else if (type === 'weekly') {
            const wn = getWeekNumber(now);
            date = formatWeek(now.getFullYear(), wn);
        } else if (type === 'monthly') {
            date = now.toISOString().slice(0, 7);
        }
    }
    const taskStatus = status || 'todo';

    const id = crypto.randomUUID();
    await env.DB.prepare(
        'INSERT INTO todos (id, user_email, content, task_type, target_date, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, userEmail, content, type, date, taskStatus).run();

    const { results } = await env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).all();

    return jsonResponse(results[0], 201);
});

/**
 * PUT /api/todos/:id
 * Updates a todo's completion status.
 */
router.put('/api/todos/:id', async ({ request, env, params }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const { id } = params;
    const { completed } = await request.json();
    
    await env.DB.prepare(
        'UPDATE todos SET completed = ? WHERE id = ? AND user_email = ?'
    ).bind(completed ? 1 : 0, id, userEmail).run();

    return new Response(null, { status: 204 });
});

/**
 * PUT /api/todos/:id/status
 * Updates a todo's kanban status (todo | in_progress | done).
 */
router.put('/api/todos/:id/status', async ({ request, env, params }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const { id } = params;
    const { status } = await request.json();
    const validStatuses = ['todo', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
        return jsonResponse({ error: '无效的状态值' }, 400);
    }

    const completed = status === 'done' ? 1 : 0;
    await env.DB.prepare(
        'UPDATE todos SET status = ?, completed = ? WHERE id = ? AND user_email = ?'
    ).bind(status, completed, id, userEmail).run();

    return new Response(null, { status: 204 });
});

/**
 * PUT /api/todos/:id/reorder
 * Updates a todo's order and optionally its status.
 */
router.put('/api/todos/:id/reorder', async ({ request, env, params }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const { id } = params;
    const { order, status } = await request.json();

    let sql = 'UPDATE todos SET "order" = ?';
    const binds = [order];
    if (status !== undefined) {
        const validStatuses = ['todo', 'in_progress', 'done'];
        if (!validStatuses.includes(status)) {
            return jsonResponse({ error: '无效的状态值' }, 400);
        }
        sql += ', status = ?';
        binds.push(status);
        if (status === 'done') {
            sql += ', completed = ?';
            binds.push(1);
        }
    }
    sql += ' WHERE id = ? AND user_email = ?';
    binds.push(id, userEmail);

    await env.DB.prepare(sql).bind(...binds).run();
    return new Response(null, { status: 204 });
});

/**
 * DELETE /api/todos/:id
 * Deletes a todo.
 */
router.delete('/api/todos/:id', async ({ request, env, params }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const { id } = params;

    await env.DB.prepare(
        'DELETE FROM todos WHERE id = ? AND user_email = ?'
    ).bind(id, userEmail).run();

    return new Response(null, { status: 204 });
});

/**
 * GET /api/analytics?year=2026
 * Returns statistical analysis for the given year.
 */
router.get('/api/analytics', async ({ request, env }) => {
    const auth = await authGuard(request, env);
    if (auth.error) return auth.error;
    const userEmail = auth.userEmail;

    const url = new URL(request.url);
    const year = parseInt(url.searchParams.get('year') || new Date().getFullYear());
    const yearStr = String(year);

    // Fetch all todos for this user in the given year
    const { results } = await env.DB.prepare(
        `SELECT id, content, completed, task_type, target_date, status, created_at 
         FROM todos WHERE user_email = ? AND (target_date LIKE ? OR strftime('%Y', created_at) = ?)`
    ).bind(userEmail, `${yearStr}%`, yearStr).all();

    // --- Summary ---
    const total = results.length;
    const completedTodos = results.filter(t => t.completed === 1);
    const completed = completedTodos.length;
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 1000 : 0;

    // --- By Type ---
    const byType = { daily: { total: 0, completed: 0 }, weekly: { total: 0, completed: 0 }, monthly: { total: 0, completed: 0 } };
    for (const t of results) {
        const type = t.task_type || 'daily';
        if (byType[type]) {
            byType[type].total++;
            if (t.completed === 1) byType[type].completed++;
        }
    }

    // --- By Month ---
    const monthMap = {};
    for (const t of results) {
        let month;
        if (t.task_type === 'daily' && t.target_date && t.target_date.length === 10) {
            month = t.target_date.slice(0, 7);
        } else if (t.task_type === 'monthly' && t.target_date && t.target_date.length === 7) {
            month = t.target_date;
        } else if (t.task_type === 'weekly' && t.target_date) {
            // Assign weekly tasks to the month containing the Monday of their week
            const parsed = parseWeek(t.target_date);
            if (parsed) {
                const range = getWeekDateRange(parsed.year, parsed.weekNum);
                month = range.start.toISOString().slice(0, 7);
            }
        } else {
            month = String(year) + '-01';
        }
        if (!monthMap[month]) monthMap[month] = { total: 0, completed: 0 };
        monthMap[month].total++;
        if (t.completed === 1) monthMap[month].completed++;
    }
    const byMonth = Object.keys(monthMap).sort().map(m => ({
        month: m,
        total: monthMap[m].total,
        completed: monthMap[m].completed,
        rate: monthMap[m].total > 0 ? Math.round((monthMap[m].completed / monthMap[m].total) * 1000) / 1000 : 0
    }));

    // --- By Week ---
    const weekMap = {};
    for (const t of results) {
        let week;
        if (t.task_type === 'weekly' && t.target_date) {
            week = t.target_date;
        } else if (t.task_type === 'daily' && t.target_date && t.target_date.length === 10) {
            const d = new Date(t.target_date);
            const wn = getWeekNumber(d);
            week = formatWeek(d.getFullYear(), wn);
        } else if (t.task_type === 'monthly' && t.target_date) {
            // For monthly tasks in weekly breakdown, distribute to weeks in that month
            continue;
        } else {
            continue;
        }
        if (week && week.startsWith(yearStr)) {
            if (!weekMap[week]) weekMap[week] = { total: 0, completed: 0 };
            weekMap[week].total++;
            if (t.completed === 1) weekMap[week].completed++;
        }
    }
    const byWeek = Object.keys(weekMap).sort().map(w => ({
        week: w,
        total: weekMap[w].total,
        completed: weekMap[w].completed,
        rate: weekMap[w].total > 0 ? Math.round((weekMap[w].completed / weekMap[w].total) * 1000) / 1000 : 0
    }));

    // --- Streak Calculation ---
    const completedByDate = {};
    for (const t of completedTodos) {
        if (t.task_type === 'daily' && t.target_date && t.target_date.length === 10) {
            completedByDate[t.target_date] = (completedByDate[t.target_date] || 0) + 1;
        }
    }

    let currentStreak = 0;
    const today = new Date();
    let checkDate = new Date(today);
    while (true) {
        const key = checkDate.toISOString().slice(0, 10);
        if (completedByDate[key]) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }

    let longestStreak = 0;
    let streak = 0;
    const sortedDates = Object.keys(completedByDate).sort();
    if (sortedDates.length > 0) {
        const startDate = new Date(sortedDates[0]);
        const endDate = new Date(sortedDates[sortedDates.length - 1]);
        const cursor = new Date(startDate);
        while (cursor <= endDate) {
            const key = cursor.toISOString().slice(0, 10);
            if (completedByDate[key]) {
                streak++;
                if (streak > longestStreak) longestStreak = streak;
            } else {
                streak = 0;
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }

    // --- Completion Trend (last 30 days) ---
    const trend = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        trend.push({ date: key, completed: completedByDate[key] || 0 });
    }

    // --- Weekly Completion ---
    const weeklyCompletion = Object.keys(weekMap).sort().map(w => ({
        week: w,
        total: weekMap[w].total,
        completed: weekMap[w].completed,
        rate: weekMap[w].total > 0 ? Math.round((weekMap[w].completed / weekMap[w].total) * 1000) / 1000 : 0
    }));

    return jsonResponse({
        year,
        summary: { total_tasks: total, completed, completion_rate: completionRate },
        by_type: byType,
        by_month: byMonth,
        by_week: byWeek,
        streak: { current: currentStreak, longest: longestStreak },
        completion_trend: trend,
        weekly_completion: weeklyCompletion,
    });
});

// --- Main Export ---
// This is the entry point for the Cloudflare Pages Function.
export async function onRequest(context) {
    // The `[[proxy]]` file route captures all requests to `/api/*`.
    return await router.handler(context.request, context.env, context);
}
