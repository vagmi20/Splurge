'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = { data: {}, charts: {}, activeTab: 'overview' };

const FREQ = {
  'one-time': 0,
  weekly: 52/12, biweekly: 26/12, semimonthly: 2,
  monthly: 1, quarterly: 1/3, annually: 1/12,
};

const CAT_COLORS = {
  Food:'#34d399', Gas:'#fbbf24', Utilities:'#60a5fa', Drinks:'#a855f7',
  Entertainment:'#a78bfa', Healthcare:'#fb7185', Clothing:'#38bdf8',
  Other:'#9ca3af', Alcohol:'#ec4899', Rent:'#f97316', 'Transit/Parking':'#2dd4bf',
  // Family book categories
  Groceries:'#34d399', Housing:'#f97316', Household:'#94a3b8', 'Kids & School':'#38bdf8',
  Insurance:'#60a5fa', Transportation:'#2dd4bf', 'Family Dining':'#fbbf24',
  'Family Trips':'#fb923c', 'Outings & Activities':'#a78bfa', 'Gifts & Celebrations':'#ec4899',
};
const PALETTE = ['#4f8ef7','#34d399','#f87171','#fbbf24','#a78bfa','#fb7185','#38bdf8','#86efac','#f97316','#ec4899'];

const VAC_COLOR = '#f97316';

// Returns how much has been saved toward a goal, auto-incrementing from start_date if set.
// Hard goals accrue at their fixed monthly. Soft goals accrue at the actual
// month-end sweep they received each month (which varies with that month's Needs
// spending), so the history reflects real swept dollars, not the raw target.
function goalCurrentSaved(g) {
  const initial = pa(g.saved);
  if (!g.start_date) return initial;
  const start = parseLocalDate(g.start_date);
  if (!start) return initial;
  const now = new Date();
  if (start > now) return initial;

  if (g.priority !== 'soft') {
    const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12
                        + (now.getMonth() - start.getMonth())
                        + (now.getDate() - start.getDate()) / 30.44;
    return initial + pa(g.monthly) * Math.max(0, monthsElapsed);
  }

  // Soft goal: sum the sweep received in each calendar month from start to now,
  // pro-rated by how much of that month falls inside [start, now].
  const needsCashByMonth = {};
  (state.data.spending||[]).forEach(s => {
    if (!s.date || bucketForCategory(s.category) !== 'needs') return;
    const key = s.date.slice(0,7); // YYYY-MM
    needsCashByMonth[key] = (needsCashByMonth[key]||0) + pa(s.amount);
  });

  let accrued = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= now) {
    const y = cursor.getFullYear(), mo = cursor.getMonth();
    const monthStart = new Date(y, mo, 1);
    const monthEnd   = new Date(y, mo + 1, 1); // exclusive
    const from = start > monthStart ? start : monthStart;
    const to   = now   < monthEnd   ? now   : monthEnd;
    const frac = Math.max(0, (to - from) / 86400000) / 30.44;
    const key  = `${y}-${String(mo+1).padStart(2,'0')}`;
    const swept = sweepDistribution(needsCashByMonth[key] || 0).funding[g.id] || 0;
    accrued += swept * frac;
    cursor = new Date(y, mo + 1, 1);
  }
  return initial + accrued;
}

const GOAL_META = {
  vehicle:   { icon:'🚗', color:'#fbbf24' },
  home:      { icon:'🏠', color:'#60a5fa' },
  emergency: { icon:'🛡', color:'#34d399' },
  medical:   { icon:'🏥', color:'#fb7185' },
  vacation:  { icon:'✈️', color:'#a78bfa' },
  education: { icon:'🎓', color:'#38bdf8' },
  other:     { icon:'📦', color:'#9ca3af' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = n => '$' + pa(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pa  = v  => parseFloat(String(v).replace(/[$,]/g,'')) || 0;
const monthlyAmt = p => pa(p.amount) * (FREQ[p.frequency] || 1);
const isFamilyBook = () => state.data._book === 'family';
// Paychecks are hidden in the Family book (SHOW_FAMILY_PAYCHECKS in web_app.py);
// while hidden they don't count toward its income.
const visiblePaychecks = () => state.data._show_paychecks === false ? [] : (state.data.paychecks||[]);
const membersMonthly = () => (state.data.members||[]).reduce((s,m)=>s+pa(m.contribution),0);
const totalMonthlyIncome = () => visiblePaychecks()
  .filter(p => p.frequency !== 'one-time')
  .reduce((s,p)=>s+monthlyAmt(p),0)
  + (isFamilyBook() ? membersMonthly() : 0);
// Escape text other family members typed before putting it in HTML
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
// Parse YYYY-MM-DD without timezone shifting (JS treats bare date strings as UTC)
const parseLocalDate = d => { if (!d) return null; const [y,m,day]=d.split('-').map(Number); return new Date(y,m-1,day); };
const thisMonth = d => { if (!d) return false; const [y,m]=d.split('-').map(Number); const t=new Date(); return y===t.getFullYear()&&m===t.getMonth()+1; };
// A future/upcoming expense is dated after today (e.g. flights booked for a later month)
const isFuture = d => { const pd = parseLocalDate(d); if (!pd) return false; const t = new Date(); t.setHours(0,0,0,0); return pd > t; };

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = '/login'; return new Promise(() => {}); }
  return r.json();
}

// ── Personal / Family book ────────────────────────────────────────────────────
async function switchBook(book) {
  await api('POST', '/api/book', { book });
  document.querySelectorAll('.book-toggle button').forEach(b => b.classList.toggle('active', b.dataset.book === book));
  // Reload so every tab, chart and form starts fresh from the other book
  location.reload();
}

async function fetchData() {
  state.data = await api('GET', '/api/data');
  renderAll();
}

function renderAll() {
  const tab = state.activeTab;
  if (tab === 'overview')       renderOverview();
  if (tab === 'members')        renderMembers();
  if (tab === 'paychecks')      renderPaychecks();
  if (tab === 'investments')    renderInvestments();
  if (tab === 'spending')       renderSpending();
  if (tab === 'subscriptions')  renderSubscriptions();
  if (tab === 'goals')          renderGoals();
  if (tab === 'history')        renderHistory();
  if (tab === 'vacations')      renderVacations();
  if (tab === 'split')          { tripSplitRender(); splitRenderPeople(); splitRenderItems(); splitRecalc(); }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + key).classList.add('active');
    state.activeTab = key;
    renderAll();
  });
});

// ── Overview ──────────────────────────────────────────────────────────────────
function renderOverview() {
  const d = state.data;
  document.getElementById('overview-date').textContent =
    new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

  const mi       = totalMonthlyIncome();
  const netWorth = (d.investments||[]).reduce((s,i)=>s+(i.type==='Real Estate'?realEstateCurrentValue(i):pa(i.value)),0);
  const spending = (d.spending||[]).filter(s=>thisMonth(s.date)).reduce((s,e)=>s+pa(e.amount),0);
  const subs     = (d.subscriptions||[]).filter(s=>s.active!==false).reduce((s,x)=>s+pa(x.amount),0);
  const net      = mi - spending - subs;

  // Goals summary for card
  const goals = d.goals || [];
  const totalTarget = goals.reduce((s,g)=>s+pa(g.target),0);
  const totalSaved  = goals.reduce((s,g)=>s+goalCurrentSaved(g),0);
  const goalsPct    = totalTarget > 0 ? Math.round(totalSaved/totalTarget*100) : 0;

  const cards = [
    { label:'Monthly Income',   value: fmt(mi),       color:'var(--green)',  sub: isFamilyBook() ? `From ${(d.members||[]).length} member${(d.members||[]).length===1?'':'s'}` : 'From paychecks' },
    { label:'Monthly Spending', value: fmt(spending),  color:'var(--red)',    sub:'This month logged' },
    { label:'Subscriptions',    value: fmt(subs),      color:'var(--yellow)', sub:`${(d.subscriptions||[]).filter(s=>s.active!==false).length} active` },
    { label:'Net Cash Flow',    value: fmt(net),       color: net>=0?'var(--green)':'var(--red)', sub:'Income − expenses' },
    { label:'Net Worth',        value: fmt(netWorth),  color:'var(--accent)', sub:'Total investments' },
    { label:'Goals Progress',   value: goalsPct+'%',   color:'var(--purple)', sub: goals.length ? `${fmt(totalSaved)} of ${fmt(totalTarget)}` : 'No goals set' },
  ];

  const el = document.getElementById('overview-cards');
  el.innerHTML = cards.map(c=>`
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value" style="color:${c.color}">${c.value}</div>
      <div class="card-sub">${c.sub}</div>
    </div>`).join('');

  renderCharts();
  renderGoalsStrip();
  renderVacationStrip();
  renderBudget();
}

// ── Goals strip on Overview ───────────────────────────────────────────────────
function renderGoalsStrip() {
  const goals = state.data.goals || [];
  const el = document.getElementById('overview-goals-strip');
  if (!goals.length) { el.innerHTML = ''; return; }

  const gf = computeGoalFunding();
  el.innerHTML = `
    <div class="goals-strip">
      <div class="goals-strip-title">Savings Goals</div>
      <div class="goals-strip-grid">
        ${goals.map(g => {
          const meta   = GOAL_META[g.category] || GOAL_META.other;
          const target = pa(g.target);
          const saved  = goalCurrentSaved(g);
          const pct    = target > 0 ? Math.min(Math.round(saved/target*100),100) : 0;
          const monthly = gf.funding[g.id] || 0;   // effective (hard = fixed, soft = swept)
          const remaining = target - saved;
          const mos = monthly > 0 ? Math.ceil(remaining / monthly) : null;
          return `
            <div class="goal-mini">
              <div class="goal-mini-name">${meta.icon} ${g.name}</div>
              <div class="goal-mini-bar">
                <div class="goal-mini-fill" style="width:${pct}%;background:${meta.color}"></div>
              </div>
              <div class="goal-mini-sub">
                <span style="color:${meta.color}">${pct}% saved</span>
                <span>${mos ? mos+'mo left' : fmt(saved)}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Vacation strip on Overview ────────────────────────────────────────────────
function renderVacationStrip() {
  const vacs = (state.data.vacations || []);
  const el = document.getElementById('overview-goals-strip');
  if (!vacs.length) return;

  const now = new Date();
  const relevant = vacs.filter(v => {
    if (!v.start_date) return false;
    const s = parseLocalDate(v.start_date);
    const e = parseLocalDate(v.end_date);
    // Show only active or upcoming vacations — never past ones
    if (!s) return false;
    const end = e || s;
    return end >= now;
  });
  if (!relevant.length) return;

  const strip = document.createElement('div');
  strip.className = 'goals-strip';
  strip.innerHTML = `
    <div class="goals-strip-title">Upcoming Vacations</div>
    <div class="goals-strip-grid">
      ${relevant.map(v => {
        const budget  = pa(v.budget);
        const spent   = vacationSpending(v);
        const pct     = budget > 0 ? Math.min(Math.round(spent / budget * 100), 100) : null;
        const s = parseLocalDate(v.start_date);
        const e = parseLocalDate(v.end_date);
        const isActive = s && e && now >= s && now <= e;
        const label = isActive ? 'Active' : s > now ? 'Upcoming' : 'Past';
        return `
          <div class="goal-mini">
            <div class="goal-mini-name">✈️ ${v.name}</div>
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px">${v.start_date} → ${v.end_date} · ${label}</div>
            ${pct !== null ? `
            <div class="goal-mini-bar">
              <div class="goal-mini-fill" style="width:${pct}%;background:${VAC_COLOR}"></div>
            </div>
            <div class="goal-mini-sub">
              <span style="color:${VAC_COLOR}">${pct}% used</span>
              <span>${fmt(spent)} / ${fmt(budget)}</span>
            </div>` : `<div style="font-size:11px;color:var(--muted)">${fmt(spent)} spent (no budget set)</div>`}
          </div>`;
      }).join('')}
    </div>`;

  // Insert after the goals strip if it exists, otherwise just append
  const goalsStripEl = el.querySelector('.goals-strip');
  if (goalsStripEl) {
    goalsStripEl.insertAdjacentElement('afterend', strip);
  } else {
    el.appendChild(strip);
  }
}

function renderCharts() {
  const d = state.data;

  // Category donut
  const catTotals = {};
  (d.spending||[]).forEach(s => { catTotals[s.category] = (catTotals[s.category]||0) + pa(s.amount); });
  const cats = Object.keys(catTotals);
  const vals = cats.map(c => catTotals[c]);

  if (state.charts.category) state.charts.category.destroy();
  const ctxCat = document.getElementById('chart-category');
  if (cats.length) {
    state.charts.category = new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: cats,
        datasets: [{ data: vals, backgroundColor: cats.map((c,i)=>CAT_COLORS[c]||PALETTE[i%PALETTE.length]), borderWidth: 0 }]
      },
      options: {
        plugins: { legend: { position:'right', labels:{ color:'#9ca3af', boxWidth:12, font:{size:11} } } },
        cutout: '60%',
        responsive: true, maintainAspectRatio: false,
      }
    });
  } else {
    ctxCat.parentElement.innerHTML = '<div class="empty">No spending data yet</div>';
  }

  // Monthly trend (last 6 months)
  const months = [];
  const monthTotals = {};
  for (let i=5; i>=0; i--) {
    const d2 = new Date(); d2.setMonth(d2.getMonth()-i);
    const key = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}`;
    const lbl = d2.toLocaleDateString('en-US',{month:'short',year:'2-digit'});
    months.push({ key, lbl });
    monthTotals[key] = 0;
  }
  (d.spending||[]).forEach(s => {
    if (!s.date) return;
    const k = s.date.slice(0,7);
    if (k in monthTotals) monthTotals[k] += pa(s.amount);
  });

  if (state.charts.trend) state.charts.trend.destroy();
  const ctxTrend = document.getElementById('chart-trend');
  if (ctxTrend) {
    state.charts.trend = new Chart(ctxTrend, {
      type: 'bar',
      data: {
        labels: months.map(m=>m.lbl),
        datasets: [{
          label: 'Spending',
          data: months.map(m=>monthTotals[m.key]),
          backgroundColor: months.map((_,i)=> i===5 ? 'rgba(79,142,247,.85)' : 'rgba(79,142,247,.35)'),
          borderRadius: 6,
        }]
      },
      options: {
        plugins: { legend:{ display:false } },
        scales: {
          x: { ticks:{ color:'#6b7280', font:{size:10} }, grid:{ display:false } },
          y: { ticks:{ color:'#6b7280', font:{size:10}, callback: v=>'$'+v.toLocaleString() }, grid:{ color:'#2d3148' } }
        },
        responsive: true, maintainAspectRatio: false,
      }
    });
  }
}

// ── Budget Allocation ─────────────────────────────────────────────────────────
const BUDGET_CONFIG = [
  { key:'needs',   label:'🏠 Needs',   color:'var(--accent)',  desc:'Gas, Transit/Parking, Utilities, Healthcare · Subs: Gym, Spotify, Claude, Phone · leftover → sweep',
    familyDesc:'Groceries, Housing, Utilities, Household, Kids & School, Healthcare, Insurance, Transportation · leftover → sweep' },
  { key:'wants',   label:'🎮 Wants',   color:'var(--yellow)', desc:'Food, Drinks, Clothing, Entertainment · Subs: HBO, Netflix, Six Flags · Goals: Vacation',
    familyDesc:'Family dinners, trips, outings & activities, gifts & celebrations, entertainment · Goals: Vacation' },
  { key:'savings', label:'💰 Savings', color:'var(--green)',  desc:'Investments · hard goals committed · leftover → sweep to soft goals',
    familyDesc:'Joint investments · family goals (college, home, emergency fund) · leftover → sweep to soft goals' },
];

// Goal category → budget bucket mapping (fallback when a goal has no explicit `bucket`)
const GOAL_BUDGET_MAP = {
  home:'needs', vehicle:'savings',
  vacation:'wants',
  medical:'savings', emergency:'savings', education:'savings', other:'savings',
};

// Subscription → budget bucket. Respects an explicit `bucket` field on the
// subscription record, otherwise Gym→needs and everything else→wants.
function subBucket(s) {
  return s.bucket || (s.category === 'Gym' ? 'needs' : 'wants');
}

// Distribute a goal's monthly contribution across budget buckets.
// Supports `bucket` (whole goal in one bucket) and `bucket_split`
// (e.g. House Payment: a fixed slice in Savings, the remainder flowing into
// the primary bucket so it can bleed through the roomy Needs headroom).
function goalBuckets(g) {
  const monthly = pa(g.monthly);
  const out = { needs:0, wants:0, savings:0 };
  const primary = g.bucket || GOAL_BUDGET_MAP[g.category] || 'savings';
  if (g.bucket_split) {
    const sav = Math.min(pa(g.bucket_split.savings || 0), monthly);
    const nds = Math.min(pa(g.bucket_split.needs || 0), monthly - sav);
    const wnt = Math.min(pa(g.bucket_split.wants || 0), monthly - sav - nds);
    out.savings += sav; out.needs += nds; out.wants += wnt;
    out[primary] += Math.max(0, monthly - sav - nds - wnt); // remainder → primary bucket
    return out;
  }
  out[primary] += monthly;
  return out;
}

// Primary budget bucket a HARD goal is committed from.
function goalPrimaryBucket(g) {
  return g.bucket || GOAL_BUDGET_MAP[g.category] || 'savings';
}

// Central month-end funding model.
// • HARD goals + investments are committed upfront from their bucket allocation.
// • SOFT goals are funded from the leftover "sweep pool" = unspent Savings
//   (alloc − investments − hard savings goals) + unspent Needs (alloc − actual
//   Needs spending − hard needs goals). The pool is distributed across soft
//   goals in proportion to each one's monthly target, capped at that target.
// Nothing is pre-committed for soft goals, so the budget can't overflow mid-month.
// Distribute one month's sweep given that month's Needs cash spend. Uses the
// current allocations/investments/subs/hard-goals (we don't store historical
// snapshots, same simplification as computeCarryover). Reused for the live month
// and for each past month when accruing soft-goal history.
function sweepDistribution(needsCash) {
  const d  = state.data;
  const mi = totalMonthlyIncome();
  const sl = d.budget_sliders || { needs:50, wants:30, savings:20 };
  const savingsAlloc = mi * (sl.savings||0)/100;
  const needsAlloc   = mi * (sl.needs||0)/100;

  const investMonthly = (d.investments||[]).reduce((s,i)=>s+pa(i.monthly_contribution),0);

  let needsSubs = 0, wantsSubs = 0;
  (d.subscriptions||[]).filter(s=>s.active!==false).forEach(s => {
    if (subBucket(s) === 'needs') needsSubs += pa(s.amount); else wantsSubs += pa(s.amount);
  });

  const goals  = d.goals || [];
  const isSoft = g => g.priority === 'soft';

  // Hard goals commit their monthly upfront, from their primary bucket
  let hardSavings = 0, hardNeeds = 0, hardWants = 0;
  goals.filter(g=>!isSoft(g)).forEach(g => {
    const b = goalPrimaryBucket(g);
    if (b === 'needs') hardNeeds += pa(g.monthly);
    else if (b === 'wants') hardWants += pa(g.monthly);
    else hardSavings += pa(g.monthly);
  });

  const savingsLeftover = Math.max(0, savingsAlloc - investMonthly - hardSavings);
  const needsLeftover   = Math.max(0, needsAlloc - needsCash - needsSubs - hardNeeds);
  const pool = savingsLeftover + needsLeftover;

  const softGoals = goals.filter(isSoft);
  const softTargetTotal = softGoals.reduce((s,g)=>s+pa(g.monthly),0);

  // Each soft goal has a pinned monthly sweep amount in dollars (`sweep_alloc`),
  // which the user drags directly. A goal with no pinned value yet defaults to
  // an equal-share water-fill of the pool capped at its target — the same
  // balanced split the old priority sliders gave at 50/50, so nothing shifts
  // until a slider is actually dragged.
  const allocs   = sl.sweep_alloc || {};
  const baseline = equalFillWaterfill(pool, softGoals); // {id: dollars}

  const funding = {};
  goals.forEach(g => { funding[g.id] = isSoft(g) ? 0 : pa(g.monthly); });

  const desired = {};
  softGoals.forEach(g => {
    const cap = pa(g.monthly);
    const v   = allocs[g.id] !== undefined ? Number(allocs[g.id]) : (baseline[g.id] || 0);
    desired[g.id] = Math.max(0, Math.min(cap, v || 0));
  });
  const desiredTotal = softGoals.reduce((s,g)=>s+desired[g.id],0);

  // The pinned amounts share the fixed pool. If they fit, each goal gets exactly
  // what's pinned and the remainder is buffer. If they exceed this month's pool
  // (e.g. income dropped since they were set), scale down proportionally and
  // flag the overage — the same "over the pool" warning as Needs/Wants/Savings.
  let poolOver = 0, distributed = 0;
  if (desiredTotal <= pool + 0.005) {
    softGoals.forEach(g => { funding[g.id] = desired[g.id]; });
    distributed = desiredTotal;
  } else {
    const scale = pool / desiredTotal;
    softGoals.forEach(g => { funding[g.id] = desired[g.id] * scale; });
    distributed = pool;
    poolOver = desiredTotal - pool;
  }

  return {
    funding, isSoft,
    savingsAlloc, needsAlloc, investMonthly,
    hardSavings, hardNeeds, hardWants,
    needsCash, needsSubs, wantsSubs,
    savingsLeftover, needsLeftover, pool,
    softGoals, softTargetTotal, distributed,
    desired, desiredTotal, poolOver,
    poolResidual: Math.max(0, pool - distributed),
  };
}

// Equal-share water-fill of `pool` across soft goals, each capped at its
// monthly target: everyone fills at the same rate, and a goal that hits its
// cap hands its remaining share back to the rest. Used both as the untouched
// default split and to auto-distribute the leftover pool across the goals the
// user isn't actively dragging.
function equalFillWaterfill(pool, softGoals) {
  const out  = {};
  const info = softGoals.map(g => ({ id: g.id, cap: pa(g.monthly), fill: 0 }));
  info.forEach(x => { out[x.id] = 0; });
  let left = Math.max(0, pool);
  let uncapped = info.filter(x => x.cap > 0);
  let guard = 0;
  while (left > 0.005 && uncapped.length && guard++ < 50) {
    const share = left / uncapped.length;
    const minRoom = Math.min(...uncapped.map(x => x.cap - x.fill));
    const step = Math.min(share, minRoom);
    uncapped.forEach(x => { x.fill += step; });
    left -= step * uncapped.length;
    uncapped = uncapped.filter(x => x.cap - x.fill > 0.005);
  }
  info.forEach(x => { out[x.id] = x.fill; });
  return out;
}

// This month's actual Needs cash spend (logged expenses in Needs categories).
function currentNeedsCash() {
  let needsCash = 0;
  (state.data.spending||[]).filter(s=>thisMonth(s.date)).forEach(s => {
    if (bucketForCategory(s.category) === 'needs') needsCash += pa(s.amount);
  });
  return needsCash;
}

function computeGoalFunding() {
  return sweepDistribution(currentNeedsCash());
}

function renderBudget() {
  const d   = state.data;
  const mi  = totalMonthlyIncome();
  const sl  = d.budget_sliders || { needs:50, wants:30, savings:20 };
  const allowBleed = sl.savings_bleed !== false; // default true

  // Actual spending from logged expenses (this month)
  const spendOnly = { needs:0, wants:0, savings:0 };
  (d.spending||[]).filter(s=>thisMonth(s.date)).forEach(s => {
    spendOnly[bucketForCategory(s.category)] += pa(s.amount);
  });

  // Fixed monthly commitments: subs + investments + HARD goals (committed
  // upfront). Soft goals are funded later from the month-end sweep pool (gf).
  const gf = computeGoalFunding();
  const fixed = { needs:0, wants:0, savings:0 };
  (d.subscriptions||[]).filter(s=>s.active!==false).forEach(s => {
    fixed[subBucket(s)] += pa(s.amount);
  });
  (d.investments||[]).forEach(i => { fixed.savings += pa(i.monthly_contribution); });
  (d.goals||[]).filter(g=>!gf.isSoft(g)).forEach(g => {
    fixed[goalPrimaryBucket(g)] += pa(g.monthly);
  });

  // Trips overlapping this month — kept for an INFORMATIONAL label only.
  // Trip expenses are already counted once in their own category bucket
  // (e.g. a flight → Needs, a dinner → Wants), so we do NOT re-add the trip
  // total here; doing so double-counted every trip expense (once by category,
  // once as vacation spend).
  const _now = new Date();
  const _curStart = new Date(_now.getFullYear(), _now.getMonth(), 1);
  const _curEnd   = new Date(_now.getFullYear(), _now.getMonth() + 1, 0);
  const _thisMonthVacs = (d.vacations||[]).filter(v => {
    if (!v.start_date) return false;
    const vs = parseLocalDate(v.start_date);
    const ve = v.end_date ? parseLocalDate(v.end_date) : vs;
    return vs && ve && vs <= _curEnd && ve >= _curStart;
  });
  // Actual spending logged during the trip (this month) — shown as a note, not added.
  const _vacActualTotal = _thisMonthVacs.reduce((sum, v) => {
    const vs = parseLocalDate(v.start_date);
    const ve = v.end_date ? parseLocalDate(v.end_date) : vs;
    return sum + (d.spending||[]).filter(sp => {
      if (!sp.date) return false;
      const sd = parseLocalDate(sp.date);
      return sd >= vs && sd <= ve && sd >= _curStart && sd <= _curEnd;
    }).reduce((s, sp) => s + pa(sp.amount), 0);
  }, 0);

  // Goal contributions per bucket — HARD goals only (soft goals appear in the
  // Month-End Sweep panel, not as committed bucket line-items).
  const goalByBucket = { needs:0, wants:0, savings:0 };
  (d.goals||[]).filter(g=>!gf.isSoft(g)).forEach(g => {
    goalByBucket[goalPrimaryBucket(g)] += pa(g.monthly);
  });

  // Total spent = actual spending + fixed
  const spent = {
    needs:   spendOnly.needs   + fixed.needs,
    wants:   spendOnly.wants   + fixed.wants,
    savings: spendOnly.savings + fixed.savings,
  };

  // Unspent Needs & Savings are reserved for the month-end sweep to soft goals,
  // so both fill to the brim ($0 free) rather than showing idle headroom.
  const reserved = { needs: gf.needsLeftover, wants: 0, savings: gf.savingsLeftover };

  // One-time paychecks this month boost wants headroom (bonus / freelance income)
  const oneTimeBonus = visiblePaychecks()
    .filter(p => p.frequency === 'one-time' && thisMonth(p.next_date))
    .reduce((s, p) => s + pa(p.amount), 0);

  // Savings bleed: if savings exceed their allocation, excess reduces wants headroom
  const savingsAlloc   = mi * (sl.savings||0) / 100;
  const savingsOver    = allowBleed ? Math.max(0, spent.savings - savingsAlloc) : 0;

  // Needs bleed: if needs exceed their allocation (e.g. big goal like house payment),
  // the overflow eats into savings headroom first, then wants
  const allowNeedsBleed = sl.needs_bleed === true;
  const needsAlloc      = mi * (sl.needs||0) / 100;
  const needsOver       = allowNeedsBleed ? Math.max(0, spent.needs - needsAlloc) : 0;
  // Needs overflow can only absorb the *free* headroom left in Savings (alloc
  // minus what savings already spends), so it never drives Savings falsely
  // negative — anything beyond that free room cascades into Wants.
  const savingsFree      = Math.max(0, savingsAlloc - spent.savings);
  const needsIntoSavings = Math.min(needsOver, savingsFree);
  const needsIntoWants   = Math.max(0, needsOver - needsIntoSavings);

  const total_pct = (sl.needs||0) + (sl.wants||0) + (sl.savings||0);

  const el = document.getElementById('overview-budget');
  el.innerHTML = `
    <div class="budget-card">
      <h2>Budget Allocation</h2>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;padding:10px 14px;background:var(--card);border-radius:8px;font-size:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="bleed-toggle" ${allowBleed?'checked':''} style="cursor:pointer;accent-color:var(--green)">
          <label for="bleed-toggle" style="cursor:pointer;color:var(--muted)">
            <span style="color:var(--green);font-weight:600">Savings safety valve</span> — if Savings ever runs over its allocation, the excess spills into Wants instead of showing red
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="needs-bleed-toggle" ${allowNeedsBleed?'checked':''} style="cursor:pointer;accent-color:var(--accent)">
          <label for="needs-bleed-toggle" style="cursor:pointer;color:var(--muted)">
            <span style="color:var(--accent);font-weight:600">Needs safety valve</span> — if actual Needs spending exceeds its allocation, the overage draws from Savings headroom first, then Wants (soft goals normally absorb the slack, so this only fires on a genuine overspend)
          </label>
        </div>
      </div>
      ${BUDGET_CONFIG.map(cfg => {
        const pct   = sl[cfg.key] || 0;
        const alloc = mi * pct / 100;
        const s     = spent[cfg.key] || 0;
        // Effective alloc after bleed adjustments
        let effectiveAlloc = alloc;
        if (cfg.key === 'wants')   effectiveAlloc = Math.max(0, alloc - savingsOver - needsIntoWants) + oneTimeBonus;
        if (cfg.key === 'savings') effectiveAlloc = Math.max(0, alloc - needsIntoSavings);
        const rsv   = reserved[cfg.key] || 0;   // reserved for month-end sweep
        const rem   = effectiveAlloc - s - rsv;
        const pused = effectiveAlloc > 0 ? Math.min(((s + rsv) / effectiveAlloc) * 100, 100) : (s > 0 ? 100 : 0);
        const isSavings = cfg.key === 'savings';
        const isNeeds   = cfg.key === 'needs';
        // Savings never "over" when savings-bleed on; needs never "over" when needs-bleed on
        const over  = (isSavings && allowBleed) || (isNeeds && allowNeedsBleed) ? false : s > effectiveAlloc;
        // "80%+ used" warns on real discretionary spend only — a bucket that's
        // full because its slack is reserved for the sweep isn't overspending.
        const realUsedPct = effectiveAlloc > 0 ? (s / effectiveAlloc) * 100 : 0;
        const warn  = !isSavings && rsv <= 0.005 && realUsedPct > 80 && !over;
        const filledByReserve = rsv > 0.005 && rem > -0.005;
        const barColor = over ? 'var(--red)' : warn ? 'var(--yellow)' : (isSavings && s > alloc) || filledByReserve ? 'var(--green)' : cfg.color;
        const statusColor = over ? 'var(--red)' : (rem > -0.005 || isSavings) ? 'var(--green)' : 'var(--red)';

        const gAmt = goalByBucket[cfg.key] || 0;
        const invAmt = cfg.key === 'savings' ? (d.investments||[]).reduce((sum,i)=>sum+pa(i.monthly_contribution),0) : 0;
        const vacAmtForBucket = cfg.key === 'wants' ? _vacActualTotal : 0;

        const goalNames = (d.goals||[])
          .filter(g => !gf.isSoft(g) && goalPrimaryBucket(g) === cfg.key && pa(g.monthly) > 0)
          .map(g => `${GOAL_META[g.category]?.icon||'📦'} ${g.name} (${fmt(g.monthly)}/mo)`)
          .join(', ');
        const vacNames = _thisMonthVacs.map(v => `✈️ ${v.name} (${fmt(v.budget)})`).join(', ');

        const statusText = isSavings && allowBleed && s > alloc
          ? `💚 ${fmt(s - alloc)} over target — great!`
          : isNeeds && allowNeedsBleed && s > alloc
            ? `💧 ${fmt(s - alloc)} over — bleeding into savings/wants`
            : over
              ? `⚠ OVER by ${fmt(Math.abs(rem))}`
              : warn ? `⚠ 80%+ used  ·  ${fmt(rem)} left`
              : filledByReserve ? `${fmt(rsv)} left for the month`
              : `${fmt(rem)} remaining${cfg.key==='wants'&&(savingsOver>0||needsIntoWants>0)?' (after overflow adjustments)':''}`;

        let bleedNote = '';
        if (cfg.key === 'wants' && (savingsOver > 0 || needsIntoWants > 0 || oneTimeBonus > 0)) {
          const parts = [];
          if (savingsOver   > 0) parts.push(`${fmt(savingsOver)} savings overflow`);
          if (needsIntoWants > 0) parts.push(`${fmt(needsIntoWants)} needs overflow`);
          const drains = parts.length ? `<div style="font-size:11px;color:var(--yellow);margin-top:3px">⬆ ${parts.join(' + ')} absorbed</div>` : '';
          const bonus  = oneTimeBonus > 0 ? `<div style="font-size:11px;color:var(--green);margin-top:3px">💸 +${fmt(oneTimeBonus)} one-time bonus added to headroom</div>` : '';
          bleedNote = drains + bonus;
        }
        if (cfg.key === 'savings' && needsIntoSavings > 0) {
          bleedNote = `<div style="font-size:11px;color:var(--accent);margin-top:3px">⬆ ${fmt(needsIntoSavings)} needs overflow absorbed from savings headroom</div>`;
        }
        if (rsv > 0.005) {
          bleedNote += `<div style="font-size:11px;color:var(--purple);margin-top:3px">🧹 ${fmt(rsv)} reserved for month-end sweep to soft goals</div>`;
        }

        const fixedBreakdown = (fixed[cfg.key] > 0) ? `
          <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
            ${invAmt > 0          ? `<span>📈 Investments: <strong style="color:var(--yellow)">${fmt(invAmt)}</strong></span>` : ''}
            ${gAmt > 0            ? `<span>🎯 Goals: <strong style="color:var(--purple)">${fmt(gAmt)}</strong>${goalNames ? ` — ${goalNames}` : ''}</span>` : ''}
            ${vacAmtForBucket > 0 ? `<span title="Already counted in each expense's own category — shown here for reference, not added again.">✈️ Vacation spend this month: <strong style="color:${VAC_COLOR}">${fmt(vacAmtForBucket)}</strong> <em style="color:var(--muted);font-weight:400">(already in categories)</em>${vacNames ? ` — ${vacNames}` : ''}</span>` : ''}
          </div>` : '';

        return `
          <div class="budget-row">
            <div class="budget-row-header">
              <div>
                <div class="budget-row-label" style="color:${cfg.color}">${cfg.label}</div>
                <div style="font-size:11px;color:var(--muted)">${isFamilyBook() ? cfg.familyDesc : cfg.desc}</div>
              </div>
              <div>
                <div class="budget-row-pct" style="color:${cfg.color}" id="pct-${cfg.key}">${pct}%</div>
                <div class="budget-row-dollar" id="dollar-${cfg.key}">= ${fmt(alloc)}/mo</div>
              </div>
            </div>
            <input type="range" min="0" max="100" value="${pct}"
              style="accent-color:${cfg.color}"
              oninput="sliderInput('${cfg.key}',this.value)">
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pused}%;background:${barColor}"></div>
            </div>
            <div class="budget-status" style="color:${statusColor}">
              Spent: ${fmt(spendOnly[cfg.key])} cash + ${fmt(fixed[cfg.key])} fixed = ${fmt(s)}  ·  ${statusText}
            </div>
            ${bleedNote}
            ${fixedBreakdown}
          </div>`;
      }).join('')}
      ${gf.softGoals.length ? `
      <div style="border:1px dashed var(--purple);border-radius:10px;padding:12px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:15px">🧹</span>
          <strong style="color:var(--purple)">Month-End Sweep → Soft Goals</strong>
          <span id="sweep-pool" style="margin-left:auto;font-weight:700;color:var(--purple)">${fmt(gf.pool)} pool</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
          Savings leftover ${fmt(gf.savingsLeftover)} + Needs leftover ${fmt(gf.needsLeftover)} — swept in before the next month starts${gf.softGoals.length>1?'. Drag each goal\'s <strong>monthly amount</strong> — they share the pool, so raising one automatically lowers the others':''}
        </div>
        ${gf.softGoals.map(g => {
          const amt = gf.funding[g.id]||0, tgt = pa(g.monthly);
          const p = tgt>0?Math.min(Math.round(amt/tgt*100),100):0;
          const meta = GOAL_META[g.category]||GOAL_META.other;
          const dval = Math.round(gf.desired[g.id]||0);
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:12px">
              <span>${meta.icon} ${g.name}</span>
              <span id="sweep-amt-${g.id}" style="color:var(--purple)"><strong>${fmt(amt)}</strong> / ${fmt(tgt)} target</span>
            </div>
            <div class="progress-bar" style="margin-top:3px"><div id="sweep-bar-${g.id}" class="progress-fill" style="width:${p}%;background:var(--purple)"></div></div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
              <input id="sweep-sld-${g.id}" type="range" min="0" max="${Math.max(1,Math.round(tgt))}" step="1" value="${dval}" style="accent-color:var(--purple);flex:1"
                oninput="sweepAllocInput('${g.id}',this.value)" onchange="saveSliders()">
              <span id="sweep-val-${g.id}" style="font-size:12px;color:var(--purple);width:70px;text-align:right;font-weight:600">${fmt(dval)}/mo</span>
            </div>
          </div>`;
        }).join('')}
        <div id="sweep-used" style="font-size:12px;font-weight:600;margin-top:6px;color:${gf.desiredTotal > gf.pool + 0.5 ? 'var(--red)':'var(--green)'}">
          ${gf.desiredTotal > gf.pool + 0.5 ? `⚠ ${fmt(gf.desiredTotal)} allocated / ${fmt(gf.pool)} pool — over by ${fmt(gf.poolOver)}` : `${fmt(gf.desiredTotal)} allocated / ${fmt(gf.pool)} pool`}
        </div>
        <div id="sweep-residual" style="font-size:11px;color:var(--green);margin-top:4px">${gf.poolResidual > 0.5 ? `＋ ${fmt(gf.poolResidual)} left in the pool after these goals — extra buffer` : ''}</div>
      </div>` : ''}
      <div class="slider-total" id="slider-total" style="color:${total_pct===100?'var(--green)':total_pct>100?'var(--red)':'var(--yellow)'}">
        Total: ${total_pct}%  ${total_pct===100?'✓ Fully allocated':total_pct>100?`⚠ Over by ${total_pct-100}%`:`(${100-total_pct}% unallocated)`}
      </div>
      <button class="btn btn-accent" style="margin-top:12px;width:100%;justify-content:center" onclick="saveSliders()">Save Allocation</button>
    </div>
  `;

  // Wire up bleed toggles (re-render budget when toggled)
  document.getElementById('bleed-toggle').addEventListener('change', function() {
    const vals = getSliderValues();
    vals.savings_bleed = this.checked;
    api('POST', '/api/budget_sliders', vals).then(() => {
      state.data.budget_sliders = { ...state.data.budget_sliders, ...vals };
      renderBudget();
    });
  });
  document.getElementById('needs-bleed-toggle').addEventListener('change', function() {
    const vals = getSliderValues();
    vals.needs_bleed = this.checked;
    api('POST', '/api/budget_sliders', vals).then(() => {
      state.data.budget_sliders = { ...state.data.budget_sliders, ...vals };
      renderBudget();
    });
  });

  injectCarryover();
}

function sliderInput(key, val) {
  const mi = totalMonthlyIncome();
  document.getElementById('pct-'+key).textContent = val + '%';
  document.getElementById('dollar-'+key).textContent = '= ' + fmt(mi * val / 100) + '/mo';
  const sliders = {};
  BUDGET_CONFIG.forEach(cfg => {
    const el = document.querySelector(`input[oninput*="${cfg.key}"]`);
    if (el) sliders[cfg.key] = parseInt(el.value);
  });
  const t = BUDGET_CONFIG.reduce((sum, cfg) => sum + (sliders[cfg.key]||0), 0);
  const el = document.getElementById('slider-total');
  if (el) {
    el.textContent = `Total: ${t}%  ${t===100?'✓ Fully allocated':t>100?`⚠ Over by ${t-100}%`:`(${100-t}% unallocated)`}`;
    el.style.color = t===100?'var(--green)':t>100?'var(--red)':'var(--yellow)';
  }
}

function getSliderValues() {
  const vals = {};
  BUDGET_CONFIG.forEach(cfg => {
    const el = document.querySelector(`input[oninput*="sliderInput('${cfg.key}"]`);
    vals[cfg.key] = el ? parseInt(el.value) : (state.data.budget_sliders||{})[cfg.key]||0;
  });
  const bleedEl = document.getElementById('bleed-toggle');
  vals.savings_bleed = bleedEl ? bleedEl.checked : ((state.data.budget_sliders||{}).savings_bleed !== false);
  const needsBleedEl = document.getElementById('needs-bleed-toggle');
  vals.needs_bleed = needsBleedEl ? needsBleedEl.checked : ((state.data.budget_sliders||{}).needs_bleed === true);
  // Preserve the per-goal pinned sweep amounts (set live by the sweep sliders)
  vals.sweep_alloc = (state.data.budget_sliders||{}).sweep_alloc || {};
  return vals;
}

// Drag a soft goal's monthly sweep dollars directly. The dragged goal is
// pinned to `val`; whatever pool is left (pool − val) is water-filled across
// the OTHER soft goals, capped at each one's target — so raising one goal
// automatically lowers the rest, the way Needs/Wants/Savings share a fixed
// slice. Persisted on the slider's change event.
function sweepAllocInput(goalId, val) {
  val = Math.max(0, parseInt(val) || 0);
  const gf0    = computeGoalFunding();
  const pool   = gf0.pool;
  const sl     = state.data.budget_sliders = state.data.budget_sliders || {};
  const allocs = sl.sweep_alloc = sl.sweep_alloc || {};

  const others    = gf0.softGoals.filter(g => g.id !== goalId);
  const remaining = Math.max(0, pool - val);
  const filled    = equalFillWaterfill(remaining, others);

  allocs[goalId] = val;
  others.forEach(g => { allocs[g.id] = Math.floor(filled[g.id] || 0); });

  refreshSweepPanel(computeGoalFunding());
}

// Update the sweep panel's live figures (amounts, bars, slider positions,
// pool-usage flag) in place, without re-rendering the whole budget card.
function refreshSweepPanel(gf) {
  gf.softGoals.forEach(g => {
    const amt = gf.funding[g.id]||0, tgt = pa(g.monthly);
    const dval = Math.round(gf.desired[g.id]||0);
    const amtEl = document.getElementById('sweep-amt-'+g.id);
    const barEl = document.getElementById('sweep-bar-'+g.id);
    const valEl = document.getElementById('sweep-val-'+g.id);
    const sldEl = document.getElementById('sweep-sld-'+g.id);
    if (amtEl) amtEl.innerHTML = `<strong>${fmt(amt)}</strong> / ${fmt(tgt)} target`;
    if (barEl) barEl.style.width = (tgt>0?Math.min(Math.round(amt/tgt*100),100):0)+'%';
    if (valEl) valEl.textContent = `${fmt(dval)}/mo`;
    // Don't yank the thumb out from under the slider the user is dragging
    if (sldEl && document.activeElement !== sldEl) sldEl.value = dval;
  });
  const usedEl = document.getElementById('sweep-used');
  if (usedEl) {
    const over = gf.desiredTotal > gf.pool + 0.5;
    usedEl.innerHTML = over
      ? `⚠ ${fmt(gf.desiredTotal)} allocated / ${fmt(gf.pool)} pool — over by ${fmt(gf.poolOver)}`
      : `${fmt(gf.desiredTotal)} allocated / ${fmt(gf.pool)} pool`;
    usedEl.style.color = over ? 'var(--red)' : 'var(--green)';
  }
  const resEl = document.getElementById('sweep-residual');
  if (resEl) resEl.textContent = gf.poolResidual > 0.5 ? `＋ ${fmt(gf.poolResidual)} left in the pool after these goals — extra buffer` : '';
}

async function saveSliders() {
  const vals = getSliderValues();
  // Only sum the three numeric budget buckets (not boolean flags)
  const t = BUDGET_CONFIG.reduce((sum, cfg) => sum + (vals[cfg.key]||0), 0);
  if (t > 100) { alert(`Sliders total ${t}% — cannot exceed 100%.`); return; }
  await api('POST', '/api/budget_sliders', vals);
  state.data.budget_sliders = vals;
  renderBudget();
}

// ── Family members ────────────────────────────────────────────────────────────
function renderMembers() {
  const d       = state.data;
  const members = d.members || [];
  const total   = membersMonthly();
  const monthSpend = (d.spending||[]).filter(s=>thisMonth(s.date));
  const spentBy = u => monthSpend.filter(s=>s.added_by===u).reduce((t,s)=>t+pa(s.amount),0);
  const bucketTotal = b => monthSpend.filter(s=>bucketForCategory(s.category)===b).reduce((t,s)=>t+pa(s.amount),0);

  document.getElementById('members-summary').innerHTML = [
    { label:'Members',             value: String(members.length),    color:'var(--accent)' },
    { label:'Family Budget',       value: fmt(total)+'/mo',          color:'var(--green)',  sub:'Sum of contributions' },
    { label:'Needs Spent',         value: fmt(bucketTotal('needs')), color:'var(--accent)', sub:'This month' },
    { label:'Wants Spent',         value: fmt(bucketTotal('wants')), color:'var(--yellow)', sub:'Dinners, trips, outings…' },
  ].map(c=>`<div class="card"><div class="card-label">${c.label}</div><div class="card-value" style="color:${c.color}">${c.value}</div>${c.sub?`<div class="card-sub">${c.sub}</div>`:''}</div>`).join('');

  const list = document.getElementById('members-list');
  if (!members.length) {
    list.innerHTML = '<div class="empty">No members yet. Click "+ Add Member" to add the people who share this budget.</div>';
    return;
  }
  list.innerHTML = members.map(m => {
    const share = total > 0 ? Math.round(pa(m.contribution) / total * 100) : 0;
    const meta = [
      m.username ? `🔑 Signs in as <strong>${esc(m.username)}</strong>` : 'No login',
      m.username ? `${fmt(spentBy(m.username))} logged this month` : '',
      m.notes ? esc(m.notes) : '',
    ].filter(Boolean).join(' · ');
    return `
    <div class="item-card">
      <div class="item-main">
        <div class="item-name">${esc(m.name)}</div>
        <div class="item-meta">${meta}</div>
      </div>
      <div class="item-right">
        <div class="item-value" style="color:var(--green)">${fmt(m.contribution)}/mo</div>
        <div class="item-sub">${share}% of family budget</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-icon" id="mem-edit-${m.id}">Edit</button>
        <button class="btn btn-danger" id="mem-del-${m.id}" title="Remove from the family budget (their login stays)">✕</button>
      </div>
    </div>`;
  }).join('');
  members.forEach(m => {
    document.getElementById(`mem-edit-${m.id}`).addEventListener('click', () => editMember(m));
    document.getElementById(`mem-del-${m.id}`).addEventListener('click', () => {
      if (confirm(`Remove ${m.name} from the family budget? Their login and personal book are kept.`)) del('members', m.id);
    });
  });
}

// Login dropdown: no login, an existing account not linked to another member, or a new one
function fillMemberLoginSelect(current) {
  const linked = new Set((state.data.members||[]).map(m=>m.username).filter(u => u && u !== current));
  const opts = [['', 'No login (e.g. a child)']];
  (state.data._accounts||[]).filter(a => !linked.has(a.username))
    .forEach(a => opts.push([a.username, `${a.display_name} (${a.username})`]));
  opts.push(['__new__', '+ Create a new login…']);
  document.getElementById('mem-login').innerHTML =
    opts.map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  document.getElementById('mem-login').value = current || '';
  memberLoginChanged();
}

function memberLoginChanged() {
  document.getElementById('mem-new-login').style.display =
    document.getElementById('mem-login').value === '__new__' ? 'block' : 'none';
}

function newMember() { editMember({}); }

function editMember(m) {
  document.getElementById('mem-id').value       = m.id || '';
  document.getElementById('mem-name').value     = m.name || '';
  document.getElementById('mem-contrib').value  = m.contribution || '';
  document.getElementById('mem-notes').value    = m.notes || '';
  document.getElementById('mem-username').value = '';
  document.getElementById('mem-password').value = '';
  document.getElementById('mem-hint').value     = '';
  document.getElementById('mem-contrib-preview').style.display = 'none';
  fillMemberLoginSelect(m.username || '');
  openModal('modal-member');
}

document.getElementById('mem-contrib')?.addEventListener('input', function() {
  const preview = document.getElementById('mem-contrib-preview');
  const val = this.value.trim();
  const result = /[+\-*/]/.test(val) ? evalExpr(val) : null;
  if (result !== null) { preview.textContent = '= ' + fmt(result); preview.style.display = 'block'; }
  else preview.style.display = 'none';
});

async function saveMember() {
  const login  = document.getElementById('mem-login').value;
  const contribRaw = document.getElementById('mem-contrib').value.trim();
  const rec = {
    id:           document.getElementById('mem-id').value,
    name:         document.getElementById('mem-name').value.trim(),
    contribution: contribRaw ? (evalExpr(contribRaw) ?? pa(contribRaw)) : 0,
    notes:        document.getElementById('mem-notes').value.trim(),
    username:     login === '__new__' ? '' : login,
  };
  if (login === '__new__') {
    rec.new_login = {
      username: document.getElementById('mem-username').value.trim(),
      password: document.getElementById('mem-password').value,
      hint:     document.getElementById('mem-hint').value.trim(),
    };
  }
  const r = await api('POST', '/api/members', rec);
  if (!r.ok) { alert(r.error || 'Could not save member'); return; }
  closeModal('modal-member');
  await fetchData();
}

// ── Paychecks ─────────────────────────────────────────────────────────────────
const _pcRegistry = {};
function renderPaychecks() {
  const list = document.getElementById('paycheck-list');
  const pcs  = state.data.paychecks || [];
  if (!pcs.length) { list.innerHTML = '<div class="empty">No paychecks yet. Click "+ Add Paycheck" to get started.</div>'; return; }
  pcs.forEach(p => { _pcRegistry[p.id] = p; });
  list.innerHTML = pcs.map(p => {
    const isOneTime = p.frequency === 'one-time';
    const freqLabel = isOneTime ? 'One-Time' : (p.frequency||'monthly').charAt(0).toUpperCase()+(p.frequency||'monthly').slice(1);
    const dateLabel = isOneTime
      ? (p.next_date ? `Date: ${p.next_date}` : '')
      : `Next: ${p.next_date||'—'}`;
    return `
    <div class="item-card">
      <div class="item-main">
        <div class="item-name">${p.name}${isOneTime ? ' <span class="badge badge-blue">One-Time</span>' : ''}</div>
        <div class="item-meta">${freqLabel}${dateLabel ? ' · ' + dateLabel : ''}</div>
        ${p.notes ? `<div class="item-meta">${p.notes}</div>` : ''}
      </div>
      <div class="item-right">
        <div class="item-value" style="color:var(--green)">${fmt(p.amount)}</div>
        <div class="item-sub">${isOneTime ? 'not recurring' : fmt(monthlyAmt(p))+'/mo'}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-icon" id="pc-edit-${p.id}">Edit</button>
        <button class="btn btn-danger" id="pc-del-${p.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  pcs.forEach(p => {
    document.getElementById(`pc-edit-${p.id}`).addEventListener('click', () => editPaycheck(_pcRegistry[p.id]));
    document.getElementById(`pc-del-${p.id}`).addEventListener('click', () => del('paychecks', p.id));
  });
}

function editPaycheck(p) {
  document.getElementById('pc-id').value     = p.id || '';
  document.getElementById('pc-name').value   = p.name || '';
  document.getElementById('pc-amount').value = p.amount || '';
  document.getElementById('pc-freq').value   = p.frequency || 'biweekly';
  document.getElementById('pc-date').value   = p.next_date || today();
  document.getElementById('pc-notes').value  = p.notes || '';
  openModal('modal-paycheck');
}

async function savePaycheck() {
  const rec = {
    id:         document.getElementById('pc-id').value || undefined,
    name:       document.getElementById('pc-name').value.trim() || 'Paycheck',
    amount:     document.getElementById('pc-amount').value.trim() || '0',
    frequency:  document.getElementById('pc-freq').value,
    next_date:  document.getElementById('pc-date').value || today(),
    notes:      document.getElementById('pc-notes').value.trim(),
  };
  await api('POST', '/api/paychecks', rec);
  closeModal('modal-paycheck');
  await fetchData();
}

// ── Projections helpers ───────────────────────────────────────────────────────
// Returns the assumed annual RoR (%) for an investment.
// Explicit inv.ror takes priority; otherwise falls back to name/type heuristics.
function defaultRoR(inv) {
  const explicit = pa(inv.ror);
  if (explicit > 0) return explicit;
  const name = (inv.name || '').toLowerCase();
  // User-specified: DCU Money Market ~1.7% APY, DCU CDR ~3.2%
  if (name.includes('money market')) return 1.7;
  if (name.includes('cdr'))          return 3.2;
  if (name.includes('cd ') || name.includes(' cd')) return 3.2;
  // Type-based defaults
  const typeMap = {
    '401(k)':10, 'Roth IRA':10, 'Traditional IRA':9,
    'Brokerage':10, 'HSA':6, '529':7,
    'Crypto':15, 'Real Estate':4, 'Other':5,
  };
  return typeMap[inv.type] || 8;
}

// Compound growth with monthly contributions: standard FV formula
// FV(n months) = P·(1+r)^n + PMT·((1+r)^n − 1)/r   where r = annual/12
function projectValue(principal, monthlyContrib, annualRoR, years) {
  const r = annualRoR / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal + monthlyContrib * n;
  return principal * Math.pow(1 + r, n) +
         monthlyContrib * (Math.pow(1 + r, n) - 1) / r;
}

const INV_COLORS = ['#4f8ef7','#34d399','#fbbf24','#f87171','#a78bfa','#fb7185','#38bdf8','#f97316'];

let _projHorizon = 30; // default years shown

function renderProjections() {
  const invs = state.data.investments || [];
  if (!invs.length) return;

  // Horizon selector buttons
  const horizons = [5, 10, 20, 30];
  const btnEl = document.getElementById('proj-horizon-btns');
  if (btnEl) {
    btnEl.innerHTML = horizons.map(h => `
      <button class="btn btn-sm ${h===_projHorizon?'btn-accent':'btn-outline'}"
        id="proj-h-${h}" onclick="setProjHorizon(${h})">${h} Years</button>`).join('');
  }

  // Build yearly data points 0 … _projHorizon
  const years = Array.from({length: _projHorizon + 1}, (_,i) => i);

  const datasets = invs.map((inv, idx) => {
    const ror = defaultRoR(inv);
    const color = INV_COLORS[idx % INV_COLORS.length];
    const startVal = inv.type === 'Real Estate' ? realEstateCurrentValue(inv) : pa(inv.value);
    return {
      label: inv.name,
      ror,
      data: years.map(y => Math.round(projectValue(startVal, pa(inv.monthly_contribution), ror, y))),
      borderColor: color,
      backgroundColor: color + '18',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
    };
  });

  // Total line
  const totalData = years.map(y =>
    invs.reduce((sum, inv) => {
      const startVal = inv.type === 'Real Estate' ? realEstateCurrentValue(inv) : pa(inv.value);
      return sum + projectValue(startVal, pa(inv.monthly_contribution), defaultRoR(inv), y);
    }, 0)
  );
  datasets.push({
    label: '★ Total Portfolio',
    data: totalData.map(v => Math.round(v)),
    borderColor: '#ffffff',
    backgroundColor: 'rgba(255,255,255,.05)',
    borderWidth: 3,
    pointRadius: 0,
    tension: 0.4,
  });

  // Chart
  if (state.charts.projections) state.charts.projections.destroy();
  const ctx = document.getElementById('chart-projections');
  if (!ctx) return;
  state.charts.projections = new Chart(ctx, {
    type: 'line',
    data: { labels: years.map(y => y === 0 ? 'Now' : `Yr ${y}`), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { position:'right', labels:{ color:'#9ca3af', boxWidth:12, font:{size:10} } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { ticks:{ color:'#6b7280', font:{size:10}, maxTicksLimit:10 }, grid:{ color:'#2d3148' } },
        y: {
          ticks: { color:'#6b7280', font:{size:10},
            callback: v => v >= 1e6 ? '$'+(v/1e6).toFixed(1)+'M' : '$'+(v/1e3).toFixed(0)+'k' },
          grid: { color:'#2d3148' },
        },
      },
    },
  });

  // Milestone table
  const milestones = [1, 5, 10, 20, 30].filter(y => y <= _projHorizon || y === _projHorizon);
  const mEl = document.getElementById('projections-milestones');
  if (!mEl) return;

  const fmt2 = v => v >= 1e6
    ? '$' + (v/1e6).toFixed(2) + 'M'
    : '$' + Math.round(v).toLocaleString();

  mEl.innerHTML = `
    <div class="card" style="overflow-x:auto">
      <div class="section-title" style="margin-bottom:12px">Milestone Projections</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="color:var(--muted);border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:6px 10px">Account</th>
            <th style="text-align:right;padding:6px 8px">Rate</th>
            ${milestones.map(y=>`<th style="text-align:right;padding:6px 8px">${y}yr</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${invs.map((inv, idx) => {
            const ror = defaultRoR(inv);
            const color = INV_COLORS[idx % INV_COLORS.length];
            const startVal = inv.type === 'Real Estate' ? realEstateCurrentValue(inv) : pa(inv.value);
            return `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:7px 10px;color:${color};font-weight:500">${inv.name}</td>
              <td style="text-align:right;padding:7px 8px;color:var(--muted)">${ror}%</td>
              ${milestones.map(y=>`<td style="text-align:right;padding:7px 8px;color:var(--text)">
                ${fmt2(projectValue(startVal, pa(inv.monthly_contribution), ror, y))}
              </td>`).join('')}
            </tr>`;
          }).join('')}
          <tr style="background:rgba(255,255,255,.04);font-weight:700">
            <td style="padding:8px 10px;color:#fff">★ Total</td>
            <td style="text-align:right;padding:8px;color:var(--muted)">blended</td>
            ${milestones.map(y=>`<td style="text-align:right;padding:8px;color:var(--green)">
              ${fmt2(invs.reduce((s,inv)=>{const sv=inv.type==='Real Estate'?realEstateCurrentValue(inv):pa(inv.value);return s+projectValue(sv,pa(inv.monthly_contribution),defaultRoR(inv),y);},0))}
            </td>`).join('')}
          </tr>
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:11px;color:var(--muted)">
        ⚠ Projections are illustrative only — they assume constant contributions and fixed returns. Markets fluctuate. Taxes, fees, and inflation are not modelled.
      </div>
    </div>`;
}

function setProjHorizon(h) {
  _projHorizon = h;
  renderProjections();
}

// ── Investments ───────────────────────────────────────────────────────────────
const _invRegistry = {};

// Investment types that are locked by default (retirement / tax-advantaged /
// illiquid). Used only as a fallback when an investment has no explicit
// `liquidity` field — the user can always override per account.
const LOCKED_TYPES = new Set(['401(k)','Roth IRA','Traditional IRA','HSA','529','Real Estate']);

// 'soft' = can withdraw anytime · 'locked' = restricted for a period.
function investLiquidity(i) {
  if (i.liquidity === 'soft' || i.liquidity === 'locked') return i.liquidity;
  return LOCKED_TYPES.has(i.type) ? 'locked' : 'soft';
}

// Current value, using the auto-compounded figure for Real Estate.
function investDisplayVal(i) {
  return (i.type === 'Real Estate' && i.date_added) ? realEstateCurrentValue(i) : pa(i.value);
}

// "🔓 unlocks in 8mo" / "🔒 unlocked" style note from a lock_until date.
function lockUntilNote(i) {
  if (!i.lock_until) return '';
  const until = parseLocalDate(i.lock_until);
  if (!until) return '';
  const now = new Date();
  const label = until.toLocaleDateString(undefined, { month:'short', year:'numeric' });
  if (until <= now) return `<span style="color:var(--green)">🔓 unlocked (matured ${label})</span>`;
  const months = Math.max(1, Math.round((until - now) / (1000*60*60*24*30.44)));
  const dur = months >= 12 ? `${Math.floor(months/12)}y ${months%12}mo` : `${months}mo`;
  return `<span style="color:var(--muted)">unlocks ${label} · ~${dur} left</span>`;
}

function renderInvestments() {
  const invs = state.data.investments || [];
  const totalVal     = invs.reduce((s,i)=>s+pa(i.value),0);
  const totalContrib = invs.reduce((s,i)=>s+pa(i.monthly_contribution),0);
  const lockedVal    = invs.filter(i=>investLiquidity(i)==='locked').reduce((s,i)=>s+investDisplayVal(i),0);
  const softVal      = invs.filter(i=>investLiquidity(i)==='soft').reduce((s,i)=>s+investDisplayVal(i),0);

  document.getElementById('investment-summary').innerHTML = [
    { label:'Total Portfolio', value: fmt(totalVal),       color:'var(--yellow)', sub:'Current value' },
    { label:'💧 Liquid (soft)', value: fmt(softVal),        color:'var(--green)',  sub:'Withdraw anytime' },
    { label:'🔒 Locked',       value: fmt(lockedVal),      color:'var(--accent)', sub:'Restricted access' },
    { label:'Monthly Contrib', value: fmt(totalContrib),   color:'var(--purple)', sub:'Into investments' },
  ].map(c=>`<div class="card">
    <div class="card-label">${c.label}</div>
    <div class="card-value" style="color:${c.color}">${c.value}</div>
    <div class="card-sub">${c.sub}</div>
  </div>`).join('');

  const list = document.getElementById('investment-list');
  if (!invs.length) { list.innerHTML='<div class="empty">No investments yet.</div>'; renderProjections(); return; }
  invs.forEach(i => { _invRegistry[i.id] = i; });

  const invCard = i => {
    const isRE = i.type === 'Real Estate' && i.date_added;
    const displayVal = investDisplayVal(i);
    const reNote = isRE ? (() => {
      const added = parseLocalDate(i.date_added);
      const now = new Date();
      const months = (now.getFullYear()-added.getFullYear())*12+(now.getMonth()-added.getMonth());
      return months > 0
        ? `<div class="item-meta" style="color:var(--muted);font-size:11px">📈 Base ${fmt(i.value)} · compounded ${months}mo @ ${defaultRoR(i)}%/yr</div>`
        : '';
    })() : '';
    const lockNote = lockUntilNote(i);
    return `
    <div class="item-card" id="inv-card-${i.id}">
      <div class="item-main">
        <div class="item-name">${i.name}</div>
        <div class="item-meta">Type: ${i.type||'—'} · <span style="color:var(--green)">${defaultRoR(i)}% RoR/yr</span>${lockNote?` · ${lockNote}`:''}</div>
        ${reNote}
        ${i.notes?`<div class="item-meta">${i.notes}</div>`:''}
      </div>
      <div class="item-right">
        <div class="item-value" id="inv-val-${i.id}"
          style="color:var(--yellow);cursor:pointer;border-bottom:1px dashed rgba(251,191,36,.4)"
          title="Click to edit value">${fmt(displayVal)}</div>
        <div class="item-sub" id="inv-contrib-${i.id}"
          style="cursor:pointer;border-bottom:1px dashed rgba(107,114,128,.4)"
          title="Click to edit monthly contribution">+${fmt(i.monthly_contribution)}/mo</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-icon" id="inv-editbtn-${i.id}">Edit All</button>
        <button class="btn btn-danger" id="inv-delbtn-${i.id}">✕</button>
      </div>
    </div>`;
  };

  // Group into Locked vs Soft, each with a subtotal header.
  const groups = [
    { key:'locked', title:'🔒 Locked Investments', hint:'Restricted until maturity / retirement', color:'var(--accent)',
      items: invs.filter(i=>investLiquidity(i)==='locked'), total: lockedVal },
    { key:'soft', title:'💧 Soft Investments', hint:'Liquid — can withdraw anytime', color:'var(--green)',
      items: invs.filter(i=>investLiquidity(i)==='soft'), total: softVal },
  ];
  list.innerHTML = groups.filter(g=>g.items.length).map(g => `
    <div class="inv-group" style="margin-bottom:18px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
        <div><span style="font-weight:700;color:${g.color}">${g.title}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:8px">${g.hint}</span></div>
        <div style="font-weight:700;color:${g.color}">${fmt(g.total)} <span style="font-size:11px;color:var(--muted);font-weight:400">· ${g.items.length}</span></div>
      </div>
      ${g.items.map(invCard).join('')}
    </div>`).join('');

  invs.forEach(i => {
    document.getElementById(`inv-val-${i.id}`)
      .addEventListener('click', function() { inlineEditInv(i.id, 'value', this); });
    document.getElementById(`inv-contrib-${i.id}`)
      .addEventListener('click', function() { inlineEditInv(i.id, 'monthly_contribution', this); });
    document.getElementById(`inv-editbtn-${i.id}`)
      .addEventListener('click', () => editInvestment(_invRegistry[i.id]));
    document.getElementById(`inv-delbtn-${i.id}`)
      .addEventListener('click', () => del('investments', i.id));
  });

  renderProjections();
}

function inlineEditInv(id, field, el) {
  const inv = _invRegistry[id];
  if (el.querySelector('input')) return;
  const curVal  = pa(inv[field]);
  const origHTML = el.innerHTML;

  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';

  const input = document.createElement('input');
  input.type  = 'text'; input.value = curVal.toFixed(2);
  input.style.cssText = 'width:130px;background:var(--card2);border:1px solid var(--accent);color:var(--text);border-radius:6px;padding:3px 8px;font-size:14px;font-weight:700';

  const preview = document.createElement('span');
  preview.style.cssText = 'font-size:12px;color:var(--green);display:none';

  const save   = Object.assign(document.createElement('button'),{textContent:'✓',className:'btn btn-sm btn-green'});
  const cancel = Object.assign(document.createElement('button'),{textContent:'✕',className:'btn btn-sm btn-danger'});
  save.style.padding = cancel.style.padding = '2px 8px';

  wrap.append(input, preview, save, cancel);
  el.appendChild(wrap);
  input.focus(); input.select();

  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (/[+\-*/]/.test(v)) {
      const r = evalExpr(v);
      if (r !== null) { preview.textContent = '= ' + fmt(r); preview.style.display = 'inline'; }
      else preview.style.display = 'none';
    } else { preview.style.display = 'none'; }
  });

  const doSave = async () => {
    const raw = input.value.trim() || '0';
    const resolved = evalExpr(raw);
    const amount = resolved !== null ? resolved.toFixed(2) : pa(raw).toFixed(2);
    await api('POST', '/api/investments', { ...inv, [field]: amount });
    await fetchData();
  };
  const doCancel = () => { el.innerHTML = origHTML; };
  save.onclick = doSave; cancel.onclick = doCancel;
  input.addEventListener('keydown', e => { if(e.key==='Enter') doSave(); if(e.key==='Escape') doCancel(); });
}

function editInvestment(i) {
  document.getElementById('inv-id').value      = i.id || '';
  document.getElementById('inv-name').value    = i.name || '';
  document.getElementById('inv-type').value    = i.type || '401(k)';
  document.getElementById('inv-value').value   = pa(i.value).toFixed(2);
  document.getElementById('inv-value-preview').style.display = 'none';
  document.getElementById('inv-contrib').value = pa(i.monthly_contribution).toFixed(2);
  document.getElementById('inv-contrib-preview').style.display = 'none';
  document.getElementById('inv-ror').value     = pa(i.ror) > 0 ? pa(i.ror) : defaultRoR(i);
  document.getElementById('inv-date-added').value = i.date_added || today();
  document.getElementById('inv-notes').value   = i.notes || '';
  const liq = i.id ? investLiquidity(i) : 'soft';
  document.getElementById('inv-liquidity').value = liq;
  document.getElementById('inv-lock-until').value = i.lock_until || '';
  document.getElementById('inv-lock-row').style.display = liq === 'locked' ? 'block' : 'none';
  const isRE = (i.type || '') === 'Real Estate';
  document.getElementById('inv-date-row').style.display = isRE ? 'block' : 'none';
  openModal('modal-investment');
}

// Show/hide date row when type changes in the modal
document.getElementById('inv-type').addEventListener('change', function() {
  document.getElementById('inv-date-row').style.display = this.value === 'Real Estate' ? 'block' : 'none';
});

// Show/hide the "locked until" row based on the liquidity choice
document.getElementById('inv-liquidity').addEventListener('change', function() {
  document.getElementById('inv-lock-row').style.display = this.value === 'locked' ? 'block' : 'none';
});

// Live preview for investment value/contrib fields
['inv-value', 'inv-contrib'].forEach(inputId => {
  document.getElementById(inputId).addEventListener('input', function() {
    const previewId = inputId + '-preview';
    const preview = document.getElementById(previewId);
    const val = this.value.trim();
    if (/[+\-*/]/.test(val)) {
      const result = evalExpr(val);
      if (result !== null) { preview.textContent = '= ' + fmt(result); preview.style.display = 'block'; }
      else preview.style.display = 'none';
    } else { preview.style.display = 'none'; }
  });
});

async function saveInvestment() {
  const rawValue  = document.getElementById('inv-value').value.trim();
  const rawContrib = document.getElementById('inv-contrib').value.trim();
  const evalValue  = evalExpr(rawValue);
  const evalContrib = evalExpr(rawContrib);
  const type = document.getElementById('inv-type').value;
  const rec = {
    id:                   document.getElementById('inv-id').value || undefined,
    name:                 document.getElementById('inv-name').value.trim() || 'Investment',
    type,
    value:                evalValue  !== null ? evalValue.toFixed(2)  : (pa(rawValue).toFixed(2)  || '0'),
    monthly_contribution: evalContrib !== null ? evalContrib.toFixed(2) : (pa(rawContrib).toFixed(2) || '0'),
    ror:                  document.getElementById('inv-ror').value.trim() || '',
    notes:                document.getElementById('inv-notes').value.trim(),
    liquidity:            document.getElementById('inv-liquidity').value,
    lock_until:           document.getElementById('inv-liquidity').value === 'locked'
                            ? (document.getElementById('inv-lock-until').value || '') : '',
    ...(type === 'Real Estate' ? { date_added: document.getElementById('inv-date-added').value || today() } : {}),
  };
  await api('POST', '/api/investments', rec);
  closeModal('modal-investment');
  await fetchData();
}

// ── Real Estate auto-compounding ──────────────────────────────────────────────
// Returns the current compounded value for a Real Estate investment based on
// months elapsed since date_added and its RoR. Falls back to stored value.
function realEstateCurrentValue(inv) {
  if (inv.type !== 'Real Estate' || !inv.date_added) return pa(inv.value);
  const added = parseLocalDate(inv.date_added);
  if (!added) return pa(inv.value);
  const now = new Date();
  const months = (now.getFullYear() - added.getFullYear()) * 12 + (now.getMonth() - added.getMonth());
  if (months <= 0) return pa(inv.value);
  const ror = defaultRoR(inv) / 100 / 12;
  return pa(inv.value) * Math.pow(1 + ror, months);
}

// ── Math expression evaluator (safe: only numbers and +-*/.()) ───────────────
function evalExpr(str) {
  const s = str.replace(/[$,\s]/g, '');
  if (!s) return null;
  if (!/^[\d+\-*/().]+$/.test(s)) return null;
  try {
    const result = Function('"use strict"; return (' + s + ')')();
    return (typeof result === 'number' && isFinite(result)) ? result : null;
  } catch { return null; }
}

// ── Spending ──────────────────────────────────────────────────────────────────
function renderSpending() {
  const d = state.data;
  const entries = d.spending || [];
  const cats = d.spending_categories || [];

  const filter = document.getElementById('spend-cat-filter');
  const modalCat = document.getElementById('sp-cat');
  const curFilter = filter.value;
  filter.innerHTML = '<option value="">All Categories</option>' + cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  filter.value = curFilter;
  modalCat.innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');

  const thisM = entries.filter(s=>thisMonth(s.date));
  const total = thisM.reduce((s,e)=>s+pa(e.amount),0);
  const allTotal = entries.reduce((s,e)=>s+pa(e.amount),0);
  const upcoming = entries.filter(s=>isFuture(s.date));
  const upcomingTotal = upcoming.reduce((s,e)=>s+pa(e.amount),0);

  document.getElementById('spending-summary').innerHTML = [
    { label:'This Month', value: fmt(total),                                     color:'var(--red)' },
    { label:'Upcoming',   value: fmt(upcomingTotal),                             color:'var(--purple)', sub: `${upcoming.length} scheduled` },
    { label:'All Time',   value: fmt(allTotal),                                  color:'var(--muted)' },
    { label:'Entries',    value: String(entries.length),                        color:'var(--accent)' },
  ].map(c=>`<div class="card"><div class="card-label">${c.label}</div><div class="card-value" style="color:${c.color}">${c.value}</div>${c.sub?`<div class="card-sub">${c.sub}</div>`:''}</div>`).join('');

  const rangeV = (document.getElementById('spend-range')||{}).value || 'month';
  const rangeFilter = rangeV==='upcoming' ? (e=>isFuture(e.date))
                    : rangeV==='all'      ? (()=>true)
                    :                       (e=>thisMonth(e.date));

  const catF  = filter.value;
  const sortV = document.getElementById('spend-sort').value;
  let shown = entries.filter(rangeFilter);
  if (catF) shown = shown.filter(e => e.category === catF);
  if (sortV==='date-desc')   shown.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if (sortV==='date-asc')    shown.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if (sortV==='amount-desc') shown.sort((a,b)=>pa(b.amount)-pa(a.amount));

  const list = document.getElementById('spending-list');
  if (!shown.length) {
    const emptyMsg = rangeV==='upcoming' ? 'No upcoming expenses scheduled. Log an expense with a future date to see it here.'
                   : rangeV==='all'      ? 'No expenses found.'
                   :                       'No expenses found.';
    list.innerHTML=`<div class="empty">${emptyMsg}</div>`; return;
  }
  const _spReg = {};
  const slice = shown.slice(0,100);
  slice.forEach(s => { _spReg[s.id] = s; });
  list.innerHTML = slice.map(s => {
    const col = CAT_COLORS[s.category] || 'var(--muted)';
    return `
    <div class="item-card">
      <div class="item-main">
        <div class="item-name" style="color:${col}">● ${s.category}${s.combined?` <span class="badge badge-blue">${s.item_count} items</span>`:''}</div>
        <div class="item-meta">${s.date||'—'}${s.notes?' · '+s.notes:''}${d._book==='family'&&s.added_by?' · added by '+s.added_by:''}</div>
      </div>
      <div class="item-right"><div class="item-value" style="color:var(--red)">${fmt(s.amount)}</div></div>
      <div class="item-actions">
        <button class="btn btn-icon" id="sp-edit-${s.id}">Edit</button>
        <button class="btn btn-danger" id="sp-del-${s.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  slice.forEach(s => {
    document.getElementById(`sp-edit-${s.id}`).addEventListener('click', () => editSpending(_spReg[s.id]));
    document.getElementById(`sp-del-${s.id}`).addEventListener('click', () => del('spending', s.id));
  });
}

function clearSpendingForm() {
  document.getElementById('sp-id').value     = '';
  document.getElementById('sp-cat').value    = (state.data.spending_categories||['Food'])[0];
  document.getElementById('sp-amount').value = '';
  document.getElementById('sp-amount-preview').style.display = 'none';
  document.getElementById('sp-date').value   = today();
  document.getElementById('sp-notes').value  = '';
  document.getElementById('sp-combined').checked = false;
  document.getElementById('sp-count').value  = 1;
  document.getElementById('sp-count-row').style.display = 'none';
  updateVacationHint();
}

function newSpending() {
  clearSpendingForm();
  openModal('modal-spending');
}

function editSpending(s) {
  document.getElementById('sp-id').value     = s.id || '';
  document.getElementById('sp-cat').value    = s.category || 'Food';
  document.getElementById('sp-amount').value = s.amount || '';
  document.getElementById('sp-date').value   = s.date || today();
  document.getElementById('sp-notes').value  = s.notes || '';
  const combined = !!s.combined;
  document.getElementById('sp-combined').checked = combined;
  document.getElementById('sp-count').value  = s.item_count || 1;
  document.getElementById('sp-count-row').style.display = combined ? 'block' : 'none';
  updateVacationHint();
  openModal('modal-spending');
}

document.getElementById('sp-combined').addEventListener('change', function() {
  document.getElementById('sp-count-row').style.display = this.checked ? 'block' : 'none';
});

document.getElementById('sp-date').addEventListener('input', updateVacationHint);

document.getElementById('sp-amount').addEventListener('input', function() {
  const preview = document.getElementById('sp-amount-preview');
  const val = this.value.trim();
  // Only show preview when the input looks like an expression (contains an operator)
  if (/[+\-*/]/.test(val)) {
    const result = evalExpr(val);
    if (result !== null) {
      preview.textContent = '= ' + fmt(result);
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  } else {
    preview.style.display = 'none';
  }
});

// ── Vacation helpers ──────────────────────────────────────────────────────────
function getVacationForDate(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  return (state.data.vacations || []).find(v => {
    const s = parseLocalDate(v.start_date);
    const e = parseLocalDate(v.end_date);
    return s && e && d >= s && d <= e;
  }) || null;
}

function vacationSpending(vac) {
  const s = parseLocalDate(vac.start_date);
  const e = parseLocalDate(vac.end_date);
  if (!s || !e) return 0;
  return (state.data.spending || []).filter(sp => {
    if (!sp.date) return false;
    const d = parseLocalDate(sp.date);
    return d >= s && d <= e;
  }).reduce((sum, sp) => sum + pa(sp.amount), 0);
}

function updateVacationHint() {
  const date  = document.getElementById('sp-date').value;
  const hint  = document.getElementById('sp-vacation-hint');
  const name  = document.getElementById('sp-vacation-name');
  const vac   = getVacationForDate(date);
  if (vac) {
    name.textContent = vac.name;
    hint.style.display = 'block';
  } else {
    hint.style.display = 'none';
  }
}

// ── Vacations ─────────────────────────────────────────────────────────────────
const _vacReg = {};

function renderVacations() {
  const vacs = state.data.vacations || [];
  const now  = new Date();

  const totalBudget = vacs.reduce((s, v) => s + pa(v.budget), 0);
  const totalSpent  = vacs.reduce((s, v) => s + vacationSpending(v), 0);
  const activeCount = vacs.filter(v => {
    const s = parseLocalDate(v.start_date);
    const e = parseLocalDate(v.end_date);
    return s && e && now >= s && now <= e;
  }).length;

  document.getElementById('vacation-summary').innerHTML = [
    { label: 'Total Budget',  value: fmt(totalBudget),              color: VAC_COLOR },
    { label: 'Total Spent',   value: fmt(totalSpent),               color: 'var(--red)' },
    { label: 'Remaining',     value: fmt(totalBudget - totalSpent), color: (totalBudget - totalSpent) >= 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'Trips',         value: String(vacs.length),           color: 'var(--accent)', sub: activeCount ? `${activeCount} active` : '' },
  ].map(c => `<div class="card">
    <div class="card-label">${c.label}</div>
    <div class="card-value" style="color:${c.color}">${c.value}</div>
    ${c.sub ? `<div class="card-sub">${c.sub}</div>` : ''}
  </div>`).join('');

  const list = document.getElementById('vacation-list');
  if (!vacs.length) {
    list.innerHTML = '<div class="empty">No vacations yet. Click "+ Add Vacation" to start tracking a trip.</div>';
    return;
  }

  vacs.forEach(v => { _vacReg[v.id] = v; });

  // Sort: active first, then upcoming, then past
  const sorted = [...vacs].sort((a, b) => {
    const statusScore = v => {
      const s = parseLocalDate(v.start_date);
      const e = parseLocalDate(v.end_date);
      if (s && e && now >= s && now <= e) return 0;
      if (s && now < s) return 1;
      return 2;
    };
    return statusScore(a) - statusScore(b) || (a.start_date || '').localeCompare(b.start_date || '');
  });

  list.innerHTML = sorted.map(v => {
    const budget    = pa(v.budget);
    const spent     = vacationSpending(v);
    const pct       = budget > 0 ? Math.min(Math.round(spent / budget * 100), 100) : 0;
    const remaining = budget - spent;
    const over      = budget > 0 && spent > budget;
    const s = parseLocalDate(v.start_date);
    const e = parseLocalDate(v.end_date);
    const isActive   = s && e && now >= s && now <= e;
    const isUpcoming = s && now < s;
    const days       = (s && e) ? Math.round((e - s) / 86400000) + 1 : 0;
    const barColor   = over ? 'var(--red)' : pct > 80 ? 'var(--yellow)' : VAC_COLOR;
    const statusBadge = isActive
      ? `<span class="badge badge-green">Active</span>`
      : isUpcoming
        ? `<span class="badge badge-blue">Upcoming</span>`
        : `<span class="badge badge-muted">Past</span>`;

    // Category breakdown for expenses in this vacation's date range
    const catTotals = {};
    (state.data.spending || []).filter(sp => {
      if (!sp.date || !s || !e) return false;
      const d = parseLocalDate(sp.date);
      return d >= s && d <= e;
    }).forEach(sp => {
      catTotals[sp.category] = (catTotals[sp.category] || 0) + pa(sp.amount);
    });
    const catBreakdown = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `<span class="vac-cat-chip" style="color:${CAT_COLORS[cat]||'var(--muted)'}">● ${cat} <strong>${fmt(amt)}</strong></span>`)
      .join('');

    return `
      <div class="vac-card">
        <div class="goal-card-header">
          <div>
            <div class="goal-name">✈️ ${v.name}</div>
            <div class="goal-meta">${v.start_date||'?'} → ${v.end_date||'?'}${days ? ` · ${days} day${days !== 1 ? 's' : ''}` : ''}${v.notes ? ' · ' + v.notes : ''}</div>
          </div>
          <div class="goal-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${statusBadge}
            ${budget > 0 ? `<div class="goal-pct" style="color:${barColor}">${pct}%</div>
            <div class="goal-amounts">${fmt(spent)} of ${fmt(budget)}</div>` : `<div style="font-size:12px;color:var(--muted)">${fmt(spent)} spent</div>`}
          </div>
        </div>
        ${budget > 0 ? `
        <div class="goal-progress">
          <div class="goal-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="goal-footer">
          <span style="color:${over ? 'var(--red)' : 'var(--muted)'}">
            ${over ? `⚠ Over by ${fmt(Math.abs(remaining))}` : `${fmt(remaining)} remaining`}
          </span>
          <span>Budget: <strong style="color:${VAC_COLOR}">${fmt(budget)}</strong></span>
        </div>` : `<div style="font-size:12px;color:var(--muted);margin-top:4px">No budget set — tracking spending only</div>`}
        ${catBreakdown ? `<div class="vac-cat-row">${catBreakdown}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-icon btn-sm" id="vac-edit-${v.id}">Edit</button>
          <button class="btn btn-danger btn-sm" id="vac-del-${v.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  sorted.forEach(v => {
    document.getElementById(`vac-edit-${v.id}`).addEventListener('click', () => editVacation(_vacReg[v.id]));
    document.getElementById(`vac-del-${v.id}`).addEventListener('click', () => del('vacations', v.id));
  });
}

function openVacationModal() {
  clearVacationForm();
  openModal('modal-vacation');
}

function clearVacationForm() {
  document.getElementById('vac-id').value     = '';
  document.getElementById('vac-name').value   = '';
  document.getElementById('vac-start').value  = '';
  document.getElementById('vac-end').value    = '';
  document.getElementById('vac-budget').value = '';
  document.getElementById('vac-notes').value  = '';
}

function editVacation(v) {
  document.getElementById('vac-id').value     = v.id || '';
  document.getElementById('vac-name').value   = v.name || '';
  document.getElementById('vac-start').value  = v.start_date || '';
  document.getElementById('vac-end').value    = v.end_date || '';
  document.getElementById('vac-budget').value = pa(v.budget) > 0 ? pa(v.budget).toFixed(2) : '';
  document.getElementById('vac-notes').value  = v.notes || '';
  openModal('modal-vacation');
}

async function saveVacation() {
  const name = document.getElementById('vac-name').value.trim();
  const start = document.getElementById('vac-start').value;
  const end   = document.getElementById('vac-end').value;
  if (!name)  { alert('Please enter a vacation name.'); return; }
  if (!start) { alert('Please choose a start date.'); return; }
  if (!end)   { alert('Please choose an end date.'); return; }
  if (start > end) { alert('End date must be on or after start date.'); return; }
  const rec = {
    id:         document.getElementById('vac-id').value || undefined,
    name,
    start_date: start,
    end_date:   end,
    budget:     document.getElementById('vac-budget').value.trim() || '0',
    notes:      document.getElementById('vac-notes').value.trim(),
  };
  await api('POST', '/api/vacations', rec);
  closeModal('modal-vacation');
  clearVacationForm();
  await fetchData();
}

async function saveSpending() {
  const combined = document.getElementById('sp-combined').checked;
  const rawAmount = document.getElementById('sp-amount').value.trim();
  const evaluated = evalExpr(rawAmount);
  const amount = evaluated !== null ? evaluated.toFixed(2) : (pa(rawAmount).toFixed(2) || '0');
  const rec = {
    id:         document.getElementById('sp-id').value || undefined,
    category:   document.getElementById('sp-cat').value,
    amount,
    date:       document.getElementById('sp-date').value || today(),
    notes:      document.getElementById('sp-notes').value.trim(),
    combined,
    item_count: combined ? parseInt(document.getElementById('sp-count').value)||1 : 1,
  };
  await api('POST', '/api/spending', rec);
  closeModal('modal-spending');
  clearSpendingForm();
  await fetchData();
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
function renderSubscriptions() {
  const subs   = state.data.subscriptions || [];
  const active = subs.filter(s=>s.active!==false);
  const totalMonthly = active.reduce((s,x)=>s+pa(x.amount),0);

  document.getElementById('subscription-summary').innerHTML = [
    { label:'Monthly Cost', value: fmt(totalMonthly),    color:'var(--yellow)' },
    { label:'Annual Cost',  value: fmt(totalMonthly*12), color:'var(--red)',   sub:'All active' },
    { label:'Active',       value: String(active.length),color:'var(--green)' },
    { label:'Total',        value: String(subs.length),  color:'var(--accent)' },
  ].map(c=>`<div class="card"><div class="card-label">${c.label}</div><div class="card-value" style="color:${c.color}">${c.value}</div>${c.sub?`<div class="card-sub">${c.sub}</div>`:''}</div>`).join('');

  const list = document.getElementById('subscription-list');
  if (!subs.length) { list.innerHTML='<div class="empty">No subscriptions yet.</div>'; return; }
  const _subReg = {};
  subs.forEach(s => { _subReg[s.id] = s; });
  list.innerHTML = subs.map(s => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-name">${s.name}</div>
        <div class="item-meta">${s.category||'—'}</div>
        ${s.notes?`<div class="item-meta">${s.notes}</div>`:''}
      </div>
      <div class="item-right">
        <div class="item-value" style="color:${s.active!==false?'var(--green)':'var(--muted)'}">${fmt(s.amount)}/mo</div>
        <div class="item-sub">${fmt(pa(s.amount)*12)}/yr</div>
      </div>
      <div class="item-actions">
        <span class="badge ${s.active!==false?'badge-green':'badge-muted'}">${s.active!==false?'Active':'Paused'}</span>
        <button class="btn btn-icon" id="sub-edit-${s.id}">Edit</button>
        <button class="btn btn-danger" id="sub-del-${s.id}">✕</button>
      </div>
    </div>`).join('');
  subs.forEach(s => {
    document.getElementById(`sub-edit-${s.id}`).addEventListener('click', () => editSubscription(_subReg[s.id]));
    document.getElementById(`sub-del-${s.id}`).addEventListener('click', () => del('subscriptions', s.id));
  });
}

function editSubscription(s) {
  document.getElementById('sub-id').value    = s.id || '';
  document.getElementById('sub-name').value  = s.name || '';
  document.getElementById('sub-amount').value= s.amount || '';
  document.getElementById('sub-cat').value   = s.category || 'Entertainment';
  document.getElementById('sub-notes').value = s.notes || '';
  document.getElementById('sub-active').checked = s.active !== false;
  openModal('modal-subscription');
}

async function saveSubscription() {
  const rec = {
    id:       document.getElementById('sub-id').value || undefined,
    name:     document.getElementById('sub-name').value.trim() || 'Subscription',
    amount:   document.getElementById('sub-amount').value.trim() || '0',
    category: document.getElementById('sub-cat').value,
    notes:    document.getElementById('sub-notes').value.trim(),
    active:   document.getElementById('sub-active').checked,
  };
  await api('POST', '/api/subscriptions', rec);
  closeModal('modal-subscription');
  await fetchData();
}

// ── Goals ─────────────────────────────────────────────────────────────────────
const _goalReg = {};

function renderGoals() {
  const goals = state.data.goals || [];
  const mi    = totalMonthlyIncome();

  const gf = computeGoalFunding();
  const totalTarget  = goals.reduce((s,g)=>s+pa(g.target),0);
  const totalSaved   = goals.reduce((s,g)=>s+goalCurrentSaved(g),0);
  const totalMonthly = goals.reduce((s,g)=>s+(gf.funding[g.id]||0),0);

  document.getElementById('goals-summary').innerHTML = [
    { label:'Total Target',    value: fmt(totalTarget),  color:'var(--accent)' },
    { label:'Total Saved',     value: fmt(totalSaved),   color:'var(--green)' },
    { label:'Monthly Toward Goals', value: fmt(totalMonthly), color:'var(--purple)',
      sub: mi>0 ? `${Math.round(totalMonthly/mi*100)}% of income` : '' },
    { label:'Goals',           value: String(goals.length), color:'var(--yellow)' },
  ].map(c=>`<div class="card"><div class="card-label">${c.label}</div><div class="card-value" style="color:${c.color}">${c.value}</div>${c.sub?`<div class="card-sub">${c.sub}</div>`:''}</div>`).join('');

  const list = document.getElementById('goals-list');
  if (!goals.length) {
    list.innerHTML = '<div class="empty">No goals yet. Add a car fund, down payment, emergency fund, or anything you\'re saving toward.</div>';
    return;
  }

  goals.forEach(g => { _goalReg[g.id] = g; });

  list.innerHTML = goals.map(g => {
    const meta    = GOAL_META[g.category] || GOAL_META.other;
    const target  = pa(g.target);
    const saved   = goalCurrentSaved(g);
    const isSoft  = g.priority === 'soft';
    const monthly = gf.funding[g.id] || 0;   // effective funding (hard = fixed, soft = swept)
    const pct     = target > 0 ? Math.min(Math.round(saved/target*100),100) : 0;
    const remain  = Math.max(0, target - saved);
    const mos     = monthly > 0 ? Math.ceil(remain / monthly) : null;
    const yrs     = mos ? (mos/12).toFixed(1) : null;
    const eta     = mos ? (mos < 24 ? `${mos} months` : `${yrs} years`) : '—';
    const typeBadge = `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;margin-left:6px;background:${isSoft?'rgba(167,139,250,.18)':'rgba(52,211,153,.18)'};color:${isSoft?'var(--purple)':'var(--green)'}">${isSoft?'SOFT · swept':'HARD · fixed'}</span>`;
    const autoNote = g.start_date
      ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">📅 Since ${g.start_date} · ${fmt(pa(g.saved))} initial + ${fmt(saved - pa(g.saved))} accrued</div>`
      : '';

    return `
      <div class="goal-card">
        <div class="goal-card-header">
          <div>
            <div class="goal-name">${meta.icon} ${g.name}${typeBadge}</div>
            <div class="goal-meta">${g.notes||''}</div>
            ${autoNote}
          </div>
          <div class="goal-right">
            <div class="goal-pct" style="color:${meta.color}">${pct}%</div>
            <div class="goal-amounts">${fmt(saved)} of ${fmt(target)}</div>
          </div>
        </div>
        <div class="goal-progress">
          <div class="goal-fill" style="width:${pct}%;background:${meta.color}"></div>
        </div>
        <div class="goal-footer">
          <span>${fmt(remain)} remaining</span>
          <span>${fmt(monthly)}/mo ${isSoft?'(swept)':'(fixed)'} · ETA: <strong style="color:${meta.color}">${eta}</strong></span>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-icon btn-sm" id="goal-edit-${g.id}">Edit</button>
          <button class="btn btn-danger btn-sm" id="goal-del-${g.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  goals.forEach(g => {
    document.getElementById(`goal-edit-${g.id}`).addEventListener('click', () => editGoal(_goalReg[g.id]));
    document.getElementById(`goal-del-${g.id}`).addEventListener('click', () => del('goals', g.id));
  });
}

function editGoal(g) {
  document.getElementById('goal-id').value      = g.id || '';
  document.getElementById('goal-name').value    = g.name || '';
  document.getElementById('goal-cat').value     = g.category || 'other';
  document.getElementById('goal-start').value   = g.start_date || '';
  document.getElementById('goal-target').value  = pa(g.target) || '';
  document.getElementById('goal-saved').value   = pa(g.saved) || '';
  document.getElementById('goal-monthly').value = pa(g.monthly) || '';
  document.getElementById('goal-priority').value = g.priority === 'soft' ? 'soft' : 'hard';
  document.getElementById('goal-notes').value   = g.notes || '';
  openModal('modal-goal');
}

async function saveGoal() {
  const rec = {
    id:         document.getElementById('goal-id').value || undefined,
    name:       document.getElementById('goal-name').value.trim() || 'Goal',
    category:   document.getElementById('goal-cat').value,
    start_date: document.getElementById('goal-start').value || undefined,
    target:     document.getElementById('goal-target').value.trim() || '0',
    saved:      document.getElementById('goal-saved').value.trim() || '0',
    monthly:    document.getElementById('goal-monthly').value.trim() || '0',
    priority:   document.getElementById('goal-priority').value || 'hard',
    notes:      document.getElementById('goal-notes').value.trim(),
  };
  await api('POST', '/api/goals', rec);
  closeModal('modal-goal');
  await fetchData();
}

// ── History ───────────────────────────────────────────────────────────────────
function initHistory() {
  // Default to the full current calendar month
  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
  document.getElementById('hist-from').value = from.toISOString().slice(0,10);
  document.getElementById('hist-to').value   = to.toISOString().slice(0,10);
}

function setRange(arg) {
  const now  = new Date();
  let from, to = new Date();
  if (arg === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (arg === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31);
  } else if (arg >= 9999) {
    from = new Date(2000, 0, 1);
  } else {
    from = new Date(); from.setDate(from.getDate() - arg);
  }
  document.getElementById('hist-from').value = from.toISOString().slice(0,10);
  document.getElementById('hist-to').value   = to.toISOString().slice(0,10);
  renderHistory();
}

function renderLiquidReserves() {
  const d   = state.data;
  const el  = document.getElementById('liquid-reserves-section');
  if (!el) return;

  // Identify money market / liquid savings accounts by name
  const mmAccounts = (d.investments || []).filter(inv =>
    /money.?market|savings|mma/i.test(inv.name)
  );
  if (!mmAccounts.length) { el.innerHTML = ''; return; }

  const totalBalance = mmAccounts.reduce((s, inv) => s + pa(inv.value), 0);
  const totalMonthly = mmAccounts.reduce((s, inv) => s + pa(inv.monthly_contribution), 0);

  // Prior-month budget surplus (flood-in) is unspent cash — counts as liquid headroom
  const carryover  = computeCarryover();
  const carryTotal = carryover.needs + carryover.wants + carryover.savings;
  const effectiveBalance = totalBalance + carryTotal;

  // Project balance forward: compound monthly at each account's RoR (default 4.5% for MM)
  function projectBalance(inv, months, monthlyOverride) {
    const r = pa(inv.ror) > 0 ? pa(inv.ror) : 4.5;
    const monthlyRate = r / 100 / 12;
    const pv = pa(inv.value);
    const c  = monthlyOverride !== undefined ? monthlyOverride : pa(inv.monthly_contribution);
    if (monthlyRate === 0) return pv + c * months;
    return pv * Math.pow(1 + monthlyRate, months)
         + c * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
  }

  // Projection assumes $1,000/mo target deposit (planning figure only — doesn't touch the investments tab)
  const PROJECTED_MONTHLY = 1000;
  const projMonthlyPerAccount = mmAccounts.length > 0 ? PROJECTED_MONTHLY / mmAccounts.length : 0;

  function totalProjected(months) {
    return mmAccounts.reduce((s, inv) => s + projectBalance(inv, months, projMonthlyPerAccount), 0);
  }

  const horizons = [
    { label: 'Now',    months: 0   },
    { label: '1 Year', months: 12  },
    { label: '2 Years',months: 24  },
    { label: '5 Years',months: 60  },
    { label: '10 Years',months:120 },
  ];

  const MM_COLOR = '#38bdf8';

  el.innerHTML = `
    <div class="section-title">💧 Liquid Reserves — Money Market</div>
    <p class="muted" style="font-size:12px;margin-bottom:12px">
      These accounts earn interest but have no withdrawal penalty — accessible anytime as extra income or for large payments.
      Projections assume <strong style="color:${MM_COLOR}">${fmt(PROJECTED_MONTHLY)}/mo</strong> deposited and each account's set return rate (default <strong style="color:${MM_COLOR}">4.5% APY</strong> if none set). Actual recorded contributions are unchanged.
    </p>
    <div class="cards-row" style="margin-bottom:16px">
      ${mmAccounts.map(inv => `
        <div class="card">
          <div class="card-label">${inv.name}</div>
          <div class="card-value" style="color:${MM_COLOR}">${fmt(pa(inv.value))}</div>
          <div class="card-sub">actual +${fmt(pa(inv.monthly_contribution))}/mo · projected +${fmt(PROJECTED_MONTHLY)}/mo · ${pa(inv.ror) > 0 ? pa(inv.ror)+'%' : '4.5%'} APY</div>
        </div>`).join('')}
      <div class="card">
        <div class="card-label">Total Liquid Balance</div>
        <div class="card-value" style="color:${MM_COLOR}">${fmt(effectiveBalance)}</div>
        <div class="card-sub" style="display:flex;flex-direction:column;gap:2px">
          <span>${fmt(totalBalance)} in accounts · +${fmt(totalMonthly)}/mo</span>
          ${carryTotal > 0 ? `<span style="color:var(--green)">+${fmt(carryTotal)} flood-in surplus
            ${carryover.needs > 0 ? `· Needs ${fmt(carryover.needs)}` : ''}
            ${carryover.wants > 0 ? `· Wants ${fmt(carryover.wants)}` : ''}
            ${carryover.savings > 0 ? `· Savings ${fmt(carryover.savings)}` : ''}
          </span>` : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="margin-bottom:14px">Projected Balance</div>
      <div style="display:flex;gap:0;flex-wrap:wrap;border-radius:10px;overflow:hidden;border:1px solid var(--border)">
        ${horizons.map((h, i) => {
          const bal = totalProjected(h.months) + carryTotal;
          const gain = bal - effectiveBalance;
          return `
            <div style="flex:1;min-width:110px;padding:14px 16px;background:${i===0?'var(--card)':'var(--bg)'};border-right:${i<horizons.length-1?'1px solid var(--border)':'none'}">
              <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${h.label}</div>
              <div style="font-size:17px;font-weight:800;color:${MM_COLOR}">${fmt(bal)}</div>
              ${gain > 0 ? `<div style="font-size:10px;color:var(--green);margin-top:2px">+${fmt(gain)} growth</div>` : ''}
            </div>`;
        }).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px">
        ✦ Includes money market balance${carryTotal > 0 ? ` + ${fmt(carryTotal)} unspent from prior months` : ''} — accessible anytime without penalty.
      </div>
    </div>`;
}

function renderHistory() {
  renderLiquidReserves();
  renderYearlyTable();

  const d = state.data;
  const fromStr = document.getElementById('hist-from').value;
  const toStr   = document.getElementById('hist-to').value;
  if (!fromStr || !toStr) return;

  const from  = parseLocalDate(fromStr);
  const to    = parseLocalDate(toStr);
  const days  = (to - from) / 86400000 + 1;
  const mi    = totalMonthlyIncome();

  // Scale income by months in range (days / 30.44), min label shows the math
  const months     = days / 30.44;
  const incomeEst  = mi * months;

  // Actual spending in range
  const rangeSpend = (d.spending||[]).filter(s => {
    if (!s.date) return false;
    const x = parseLocalDate(s.date);
    return x >= from && x <= to;
  }).reduce((s,e)=>s+pa(e.amount),0);

  // Fixed monthly costs scaled to the range
  const activeSubs = (d.subscriptions||[]).filter(s=>s.active!==false).reduce((s,x)=>s+pa(x.amount),0);
  const contribs   = (d.investments||[]).reduce((s,i)=>s+pa(i.monthly_contribution),0);
  const goalContrib= (d.goals||[]).reduce((s,g)=>s+pa(g.monthly),0);
  const fixedExp   = (activeSubs + contribs + goalContrib) * months;
  const net        = incomeEst - rangeSpend - fixedExp;

  // Format the month count nicely for the sub-label
  const moLabel = months < 1.05 ? '1 month' :
                  months < 12   ? `${months.toFixed(1)} months` :
                  `${(months/12).toFixed(1)} years`;

  document.getElementById('history-summary').innerHTML = [
    { label:'Projected Income',   value: fmt(incomeEst),  color:'var(--green)',  sub:`${fmt(mi)}/mo × ${moLabel}` },
    { label:'Logged Spending',    value: fmt(rangeSpend), color:'var(--red)',    sub:'Actual entries in range' },
    { label:'Fixed Costs',        value: fmt(fixedExp),   color:'var(--yellow)', sub:'Subs + investments + goals (scaled)' },
    { label:'Net',                value: fmt(net),        color: net>=0?'var(--green)':'var(--red)', sub:'Projected − spending − fixed' },
  ].map(c=>`<div class="card">
    <div class="card-label">${c.label}</div>
    <div class="card-value" style="color:${c.color}">${c.value}</div>
    <div class="card-sub">${c.sub}</div>
  </div>`).join('');

  // Spending breakdown by category
  const catTotals = {};
  (d.spending||[]).filter(s => {
    if (!s.date) return false;
    const x = parseLocalDate(s.date);
    return x >= from && x <= to;
  }).forEach(s => { catTotals[s.category] = (catTotals[s.category]||0) + pa(s.amount); });

  const bd = document.getElementById('history-breakdown');
  if (!Object.keys(catTotals).length) { bd.innerHTML = '<div class="empty">No spending in this period.</div>'; return; }

  const sorted = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const maxAmt = sorted[0][1];

  // Individual expenses in the selected range (newest first)
  const rangeItems = (d.spending||[]).filter(s => {
    if (!s.date) return false;
    const x = parseLocalDate(s.date);
    return x >= from && x <= to;
  }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  bd.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div class="section-title" style="margin-bottom:12px">Spending by Category</div>
      ${sorted.map(([cat, amt]) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="width:120px;font-size:13px;color:${CAT_COLORS[cat]||'var(--muted)'}">${cat}</div>
          <div style="flex:1;background:var(--border);border-radius:4px;height:8px;overflow:hidden">
            <div style="width:${(amt/maxAmt*100).toFixed(1)}%;height:100%;background:${CAT_COLORS[cat]||PALETTE[0]};border-radius:4px"></div>
          </div>
          <div style="width:80px;text-align:right;font-size:13px;color:var(--red);font-weight:600">${fmt(amt)}</div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="section-title" style="margin:0">Expenses in Range</div>
        <span class="muted" style="font-size:12px">${rangeItems.length} ${rangeItems.length===1?'entry':'entries'} · ${fmt(rangeSpend)}</span>
      </div>
      <div style="max-height:380px;overflow-y:auto">
        ${rangeItems.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
            <div style="width:84px;font-size:12px;color:var(--muted);white-space:nowrap">${s.date}</div>
            <div style="width:130px;font-size:12px;color:${CAT_COLORS[s.category]||'var(--muted)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.category}</div>
            <div style="flex:1;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.notes||''}</div>
            <div style="font-size:13px;font-weight:600;color:var(--red);white-space:nowrap">${fmt(pa(s.amount))}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderYearlyTable() {
  const d         = state.data;
  const mi        = totalMonthlyIncome();
  const annualSubs = (d.subscriptions||[]).filter(s=>s.active!==false).reduce((s,x)=>s+pa(x.amount),0) * 12;

  const years = new Set([new Date().getFullYear()]);
  (d.spending||[]).forEach(s => { if (s.date) { const x=parseLocalDate(s.date); if(x) years.add(x.getFullYear()); } });

  const rows = Array.from(years).sort((a,b)=>b-a).map(yr => {
    const isCurrent = yr === new Date().getFullYear();
    const months    = isCurrent ? new Date().getMonth() + 1 : 12;
    const projIncome = mi * months;
    const ytdSpend  = (d.spending||[])
      .filter(s => { if(!s.date) return false; const x=parseLocalDate(s.date); return x&&x.getFullYear()===yr; })
      .reduce((s,e)=>s+pa(e.amount),0);
    const ytdSubs   = annualSubs * (months / 12);
    const net       = projIncome - ytdSpend - ytdSubs;
    return { yr, isCurrent, months, projIncome, annualIncome: mi*12, ytdSpend, ytdSubs, net };
  });

  const el = document.getElementById('yearly-table');
  if (!rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="yearly-table">
      <table>
        <thead><tr>
          <th>Year</th><th>Projected Income</th><th>Actual Spending</th>
          <th>Subscriptions</th><th>Est. Net Savings</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr class="${r.isCurrent?'yr-current':''}">
              <td><strong>${r.yr}</strong>${r.isCurrent?` <span class="badge badge-blue">YTD (${r.months}mo)</span>`:''}</td>
              <td style="color:var(--green)">${fmt(r.projIncome)}${r.isCurrent?`<div style="font-size:10px;color:var(--muted)">Full yr: ${fmt(r.annualIncome)}</div>`:''}</td>
              <td style="color:var(--red)">${fmt(r.ytdSpend)}</td>
              <td style="color:var(--yellow)">${fmt(r.ytdSubs)}</td>
              <td style="color:${r.net>=0?'var(--green)':'var(--red)'};font-weight:600">${fmt(r.net)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  const hidden = document.querySelector(`#${id} input[type=hidden]`);
  if (hidden) hidden.value = '';
}
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }

// ── Import ────────────────────────────────────────────────────────────────────
function openImportModal() {
  document.getElementById('import-file').value = '';
  const status = document.getElementById('import-status');
  status.style.display = 'none'; status.textContent = '';
  openModal('modal-import');
}

async function submitImport() {
  const fileInput = document.getElementById('import-file');
  const merge     = document.getElementById('import-mode').value;
  const status    = document.getElementById('import-status');

  if (!fileInput.files.length) { alert('Please select an Excel file first.'); return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  status.style.display = 'block';
  status.style.background = 'rgba(79,142,247,.1)';
  status.style.color = 'var(--accent)';
  status.textContent = 'Importing…';

  try {
    const res = await fetch(`/api/import?merge=${merge}`, { method:'POST', body: formData });
    const json = await res.json();
    if (json.ok) {
      const c = json.counts;
      status.style.background = 'rgba(52,211,153,.1)';
      status.style.color = 'var(--green)';
      status.textContent = `✓ Imported — Paychecks: ${c.paychecks||0}, Investments: ${c.investments||0}, Spending: ${c.spending||0}  (${json.merge?'merged':'replaced'})`;
      await fetchData();
    } else {
      status.style.background = 'rgba(248,113,113,.1)';
      status.style.color = 'var(--red)';
      status.textContent = '✕ ' + (json.error || 'Import failed');
    }
  } catch(e) {
    status.style.background = 'rgba(248,113,113,.1)';
    status.style.color = 'var(--red)';
    status.textContent = '✕ Network error: ' + e.message;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function del(collection, id) {
  const endpoints = {
    paychecks:'/api/paychecks/', investments:'/api/investments/', members:'/api/members/',
    spending:'/api/spending/', subscriptions:'/api/subscriptions/',
    goals:'/api/goals/', vacations:'/api/vacations/',
  };
  await api('DELETE', endpoints[collection] + id);
  await fetchData();
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportData() { window.location.href = '/api/export'; }

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initHistory();
  fetchData();
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1: Prior-Month Budget Carryover ("Flood-in")
// ══════════════════════════════════════════════════════════════════════════════

const CAT_MAP_BUCKETS = {
  needs:   ['Gas','Transit/Parking','Utilities','Healthcare','Car Services','Rent'],
  wants:   ['Food','Alcohol','Entertainment','Clothing','Drinks','Other'],
  savings: [],
};

// Family book: household essentials are Needs; shared fun (family dinners,
// trips, outings, celebrations) is Wants. Anything not listed falls back to the
// personal mapping above, then to Wants.
const FAMILY_BUCKETS = {
  needs:   ['Groceries','Housing','Utilities','Household','Kids & School','Healthcare',
            'Insurance','Transportation','Rent','Gas','Transit/Parking','Car Services'],
  wants:   ['Family Dining','Family Trips','Outings & Activities','Gifts & Celebrations',
            'Entertainment','Food','Drinks','Alcohol','Clothing','Other'],
  savings: [],
};

function bucketForCategory(cat) {
  const maps = isFamilyBook() ? [FAMILY_BUCKETS, CAT_MAP_BUCKETS] : [CAT_MAP_BUCKETS];
  for (const map of maps) {
    for (const [b, cats] of Object.entries(map)) {
      if (cats.includes(cat)) return b;
    }
  }
  return 'wants';
}

/**
 * Compute surplus from prior months.
 * Returns {needs, wants, savings} — each is the cumulative unspent surplus.
 */
function computeCarryover() {
  const d  = state.data;
  const mi = totalMonthlyIncome();
  const sl = d.budget_sliders || { needs:50, wants:30, savings:20 };

  // Group spending by year-month
  const byMonth = {};
  (d.spending || []).forEach(s => {
    if (!s.date) return;
    const [y, m] = s.date.split('-').map(Number);
    const key = `${y}-${String(m).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(s);
  });

  const now   = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const surplus = { needs:0, wants:0, savings:0 };

  // Fixed monthly commitments (subs + investments + goals) — same as renderBudget
  const fixedMonthly = { needs:0, wants:0, savings:0 };
  (d.subscriptions||[]).filter(s=>s.active!==false).forEach(s => {
    fixedMonthly[subBucket(s)] += pa(s.amount);
  });
  (d.investments||[]).forEach(i => { fixedMonthly.savings += pa(i.monthly_contribution); });
  (d.goals||[]).forEach(g => {
    const gb = goalBuckets(g);
    fixedMonthly.needs += gb.needs; fixedMonthly.wants += gb.wants; fixedMonthly.savings += gb.savings;
  });

  for (const [key, records] of Object.entries(byMonth)) {
    if (key >= curKey) continue; // skip current month and future

    const alloc = { needs:0, wants:0, savings:0 };
    for (const b of ['needs','wants','savings']) {
      alloc[b] = mi * (sl[b] || 0) / 100;
    }

    const spent = { needs:0, wants:0, savings:0 };
    records.forEach(s => {
      spent[bucketForCategory(s.category)] += pa(s.amount);
    });
    // Add fixed costs
    for (const b of ['needs','wants','savings']) {
      spent[b] += fixedMonthly[b];
    }

    // Only Wants carries surplus forward as flood-in. Needs and Savings are
    // filled to the brim from each month's income and never accumulate.
    const wantsDiff = alloc.wants - spent.wants;
    if (wantsDiff > 0) surplus.wants += wantsDiff;
  }

  return surplus;
}

/**
 * Inject carryover info into the budget card.
 * Called after renderBudget() builds the DOM.
 */
function injectCarryover() {
  const surplus = computeCarryover();
  const total   = surplus.needs + surplus.wants + surplus.savings;
  if (total <= 0) return;

  const card = document.querySelector('.budget-card');
  if (!card) return;

  // Insert banner after <h2>
  const h2 = card.querySelector('h2');
  if (!h2) return;

  const banner = document.createElement('div');
  banner.style.cssText = 'margin-bottom:14px;padding:10px 14px;background:rgba(52,211,153,.08);border:1px solid var(--green);border-radius:10px;font-size:13px';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:16px">💧</span>
      <strong style="color:var(--green)">Flood-in: Prior-Month Surplus</strong>
      <span style="margin-left:auto;font-weight:700;color:var(--green)">${fmt(total)} available</span>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted)">
      ${surplus.needs  > 0 ? `<span>Needs <strong style="color:var(--green)">${fmt(surplus.needs)}</strong></span>` : ''}
      ${surplus.wants  > 0 ? `<span>Wants <strong style="color:var(--green)">${fmt(surplus.wants)}</strong></span>` : ''}
      ${surplus.savings> 0 ? `<span>Savings <strong style="color:var(--green)">${fmt(surplus.savings)}</strong></span>` : ''}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px">Unspent from prior months — available as extra headroom if you go over budget</div>
  `;
  h2.insertAdjacentElement('afterend', banner);

  // Update each row's "remaining" status to factor in carryover
  for (const b of ['needs','wants','savings']) {
    if (surplus[b] <= 0) continue;
    const statusEl = document.querySelector(`.budget-status`);
    // Find the status div for this specific bucket row
    const rowLabel = card.querySelector(`[id="pct-${b}"]`);
    if (!rowLabel) continue;
    const row = rowLabel.closest('.budget-row');
    if (!row) continue;
    const statusDiv = row.querySelector('.budget-status');
    if (!statusDiv) continue;

    const carry = surplus[b];
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--green);margin-top:3px;display:flex;align-items:center;gap:5px';
    note.innerHTML = `<span class="carryover-badge">💧 ${fmt(carry)} flood-in from prior months</span>`;
    statusDiv.insertAdjacentElement('afterend', note);
  }
}

// injectCarryover() is called at the end of renderBudget() below (see edit in renderBudget)

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2: Receipt Splitter
// ══════════════════════════════════════════════════════════════════════════════

const splitState = {
  people: [],   // [{id, name}]
  items:  [],   // [{id, name, price, assignees:[personId,...]}]
  file:   null,
};

let _splitPersonIdCounter = 1;
let _splitItemIdCounter   = 1;

function splitHandleDrop(e) {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) splitSetFile(f);
}

function splitFileChosen(input) {
  if (input.files[0]) splitSetFile(input.files[0]);
}

function splitSetFile(f) {
  splitState.file = f;
  const img = document.getElementById('split-preview-img');
  const txt = document.getElementById('split-upload-text');
  img.src = URL.createObjectURL(f);
  img.style.display = 'block';
  txt.style.display = 'none';
  document.getElementById('split-parse-btn').disabled = false;
}

function splitClearAll() {
  // Only confirm if there's something to lose.
  if ((splitState.people.length || splitState.items.length || splitState.file) &&
      !confirm('Clear all people, items, and the receipt? This cannot be undone.')) {
    return;
  }

  // Reset state
  splitState.people = [];
  splitState.items  = [];
  splitState.file   = null;
  _splitPersonIdCounter = 1;
  _splitItemIdCounter   = 1;

  // Reset the upload zone
  const img = document.getElementById('split-preview-img');
  const txt = document.getElementById('split-upload-text');
  img.src = '';
  img.style.display = 'none';
  txt.style.display = '';
  document.getElementById('split-file-input').value = '';
  document.getElementById('split-parse-btn').disabled = true;
  document.getElementById('split-parse-status').textContent = '';

  // Reset tax / tip inputs
  document.getElementById('split-tax').value = '';
  document.getElementById('split-tip').value = '';
  document.getElementById('split-tip-proportional').checked = false;

  // Re-render everything
  splitRenderPeople();
  splitRenderItems();
  splitRecalc();
}

async function splitParseReceipt() {
  if (!splitState.file) return;
  const btn    = document.getElementById('split-parse-btn');
  const status = document.getElementById('split-parse-status');
  btn.disabled = true;
  status.textContent = 'Parsing…';

  const fd = new FormData();
  fd.append('image', splitState.file);

  try {
    const r    = await fetch('/api/parse-receipt', { method:'POST', body:fd });
    const json = await r.json();
    if (!json.ok) { status.textContent = '✕ ' + (json.error||'Failed'); btn.disabled=false; return; }

    // Pre-fill items
    if (Array.isArray(json.items)) {
      json.items.forEach(it => {
        splitState.items.push({ id: _splitItemIdCounter++, name: it.name||'Item', price: pa(it.price)||0, assignees:[] });
      });
    }
    // Pre-fill tax/tip
    if (json.tax  != null) document.getElementById('split-tax').value  = pa(json.tax).toFixed(2);
    if (json.tip  != null) document.getElementById('split-tip').value  = pa(json.tip).toFixed(2);

    status.textContent = `✓ Found ${splitState.items.length} item(s)`;
    splitRenderItems();
    splitRecalc();
  } catch(e) {
    status.textContent = '✕ ' + e.message;
  }
  btn.disabled = false;
}

function splitAddPerson() {
  const name = prompt('Person name:');
  if (!name || !name.trim()) return;
  splitState.people.push({ id: _splitPersonIdCounter++, name: name.trim() });
  splitRenderPeople();
  splitRenderItems(); // refresh assignee buttons
  splitRecalc();
}

function splitRemovePerson(id) {
  splitState.people = splitState.people.filter(p => p.id !== id);
  splitState.items.forEach(it => { it.assignees = it.assignees.filter(a => a !== id); });
  splitRenderPeople();
  splitRenderItems();
  splitRecalc();
}

function splitRenderPeople() {
  const el = document.getElementById('split-people-list');
  if (!splitState.people.length) {
    el.innerHTML = '<span class="muted" style="font-size:13px">Add people to split with</span>';
    return;
  }
  el.innerHTML = splitState.people.map(p => `
    <span class="split-person-chip">
      ${p.name}
      <span class="remove-btn" onclick="splitRemovePerson(${p.id})">×</span>
    </span>`).join('');
}

function splitAddItem() {
  const name  = prompt('Item name:');
  if (!name || !name.trim()) return;
  const price = parseFloat(prompt('Price ($):') || '0') || 0;
  splitState.items.push({ id: _splitItemIdCounter++, name: name.trim(), price, assignees:[] });
  splitRenderItems();
  splitRecalc();
}

function splitRemoveItem(id) {
  splitState.items = splitState.items.filter(it => it.id !== id);
  splitRenderItems();
  splitRecalc();
}

function splitToggleAssignee(itemId, personId) {
  const item = splitState.items.find(it => it.id === itemId);
  if (!item) return;
  const idx = item.assignees.indexOf(personId);
  if (idx >= 0) item.assignees.splice(idx, 1);
  else item.assignees.push(personId);
  splitRenderItems();
  splitRecalc();
}

function splitRenderItems() {
  const el = document.getElementById('split-items-list');
  if (!splitState.items.length) {
    el.innerHTML = '<span class="muted" style="font-size:13px">Parse a receipt or add items manually</span>';
    return;
  }
  el.innerHTML = splitState.items.map(item => `
    <div class="split-item-row">
      <div>
        <div style="font-size:13px;font-weight:600">${item.name}</div>
        <div class="split-assignees">
          ${splitState.people.map(p => `
            <button class="split-assignee-btn ${item.assignees.includes(p.id)?'active':''}"
              onclick="splitToggleAssignee(${item.id},${p.id})">${p.name}</button>
          `).join('')}
          ${splitState.people.length === 0 ? '<span style="font-size:11px;color:var(--muted)">Add people first</span>' : ''}
        </div>
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">${fmt(item.price)}</div>
      <button onclick="splitRemoveItem(${item.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px">×</button>
    </div>`).join('');
}

function splitQuickTip(pct) {
  const subtotal = splitState.items.reduce((s,it)=>s+it.price, 0);
  const tax = pa(document.getElementById('split-tax').value) || 0;
  document.getElementById('split-tip').value = ((subtotal + tax) * pct / 100).toFixed(2);
  splitRecalc();
}

function splitRecalc() {
  const tax  = pa(document.getElementById('split-tax').value) || 0;
  const tip  = pa(document.getElementById('split-tip').value) || 0;
  const prop = document.getElementById('split-tip-proportional').checked;
  const subtotal = splitState.items.reduce((s,it)=>s+it.price, 0);
  const total    = subtotal + tax + tip;

  const el = document.getElementById('split-summary-content');
  if (!splitState.people.length || !splitState.items.length) {
    el.innerHTML = '<span class="muted" style="font-size:13px">Add people and items to see the split</span>';
    return;
  }

  // Per-person item subtotals
  const personSubtotals = {};
  splitState.people.forEach(p => { personSubtotals[p.id] = 0; });

  splitState.items.forEach(item => {
    const assigned = item.assignees.length > 0 ? item.assignees : splitState.people.map(p=>p.id);
    const share = item.price / assigned.length;
    assigned.forEach(pid => { personSubtotals[pid] = (personSubtotals[pid]||0) + share; });
  });

  const personTotals = {};
  splitState.people.forEach(p => {
    const sub = personSubtotals[p.id] || 0;
    let taxShare, tipShare;
    if (prop && subtotal > 0) {
      const ratio = sub / subtotal;
      taxShare = tax * ratio;
      tipShare = tip * ratio;
    } else {
      taxShare = tax / splitState.people.length;
      tipShare = tip / splitState.people.length;
    }
    personTotals[p.id] = { sub, tax: taxShare, tip: tipShare, total: sub + taxShare + tipShare };
  });

  const unassignedItems = splitState.items.filter(it => it.assignees.length === 0);

  el.innerHTML = `
    ${splitState.people.map(p => {
      const t = personTotals[p.id];
      return `<div class="split-summary-row">
        <div>
          <div style="font-weight:700;font-size:15px">${p.name}</div>
          <div style="font-size:11px;color:var(--muted)">
            Items ${fmt(t.sub)}
            ${tax > 0 ? ` · Tax ${fmt(t.tax)}` : ''}
            ${tip > 0 ? ` · Tip ${fmt(t.tip)}` : ''}
          </div>
        </div>
        <div style="font-size:18px;font-weight:800;color:var(--accent)">${fmt(t.total)}</div>
      </div>`;
    }).join('')}
    <div style="display:flex;justify-content:space-between;padding:10px 14px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);margin-top:4px">
      <span>Total</span>
      <span style="font-weight:700;color:var(--fg)">${fmt(total)}</span>
    </div>
    ${unassignedItems.length ? `<div style="font-size:12px;color:var(--yellow);margin-top:6px">⚠ ${unassignedItems.length} unassigned item(s) split equally among all people</div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3: Persistent Trip Splits (Ubers / meals someone fronts for the group)
// Model (state.data.trip_splits[]):
//   { id, name, vacation_id, people:[{id,name}],
//     items:[{id, name, amount, payer:personId, participants:[personId,...]}] }
// Each item: `payer` fronted `amount`; every `participant` owes an equal share.
// Settle-up nets each person (paid − owed) and suggests minimal transfers.
// ══════════════════════════════════════════════════════════════════════════════

let _activeTripSplit = null;
const _tsUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function tripSplits() { return state.data.trip_splits || (state.data.trip_splits = []); }
function activeTripSplit() {
  const list = tripSplits();
  return list.find(s => s.id === _activeTripSplit) || null;
}

async function tripSplitSave(split) {
  const res = await api('POST', '/api/trip_splits', split);
  if (!split.id && res && res.id) split.id = res.id;
  return split.id;
}
async function tripSplitPersist(split) { await tripSplitSave(split); tripSplitRender(); }

function tripSplitNew() {
  const name = prompt('Trip split name (e.g. "Beach weekend"):');
  if (!name || !name.trim()) return;
  // Offer to link an existing vacation by matching name, else leave unlinked
  const vac = (state.data.vacations || []).find(v =>
    (v.name || '').toLowerCase().includes(name.trim().toLowerCase()) ||
    name.trim().toLowerCase().includes((v.name || '').toLowerCase()));
  const split = { id: '', name: name.trim(), vacation_id: vac ? vac.id : null, people: [], items: [] };
  tripSplits().push(split);
  tripSplitSave(split).then(() => { _activeTripSplit = split.id; tripSplitRender(); });
}

function tripSplitDelete(id) {
  const s = tripSplits().find(x => x.id === id);
  if (!s) return;
  if (!confirm(`Delete trip split "${s.name}"? This can't be undone.`)) return;
  state.data.trip_splits = tripSplits().filter(x => x.id !== id);
  if (_activeTripSplit === id) _activeTripSplit = null;
  api('DELETE', `/api/trip_splits/${id}`).then(tripSplitRender);
}

function tripSplitSelect(id) { _activeTripSplit = id; tripSplitRender(); }

// Net "total shared" of a split (item amounts, incl. any rounding credits).
function tripSplitTotal(s) { return round2((s.items || []).reduce((a, it) => a + pa(it.amount), 0)); }

// Set a finished trip aside: it moves to the "Past trips" strip and the editor
// switches to the next active split so the workspace is clear for the next trip.
function tripSplitArchive(id) {
  const s = tripSplits().find(x => x.id === id); if (!s) return;
  s.archived = true;
  const next = tripSplits().find(x => !x.archived);
  _activeTripSplit = next ? next.id : null;   // clear editor when nothing active remains
  tripSplitPersist(s);
}
function tripSplitUnarchive(id) {
  const s = tripSplits().find(x => x.id === id); if (!s) return;
  s.archived = false; _activeTripSplit = id;
  tripSplitPersist(s);
}

function tripSplitAddPerson() {
  const s = activeTripSplit(); if (!s) return;
  const name = prompt('Person name:');
  if (!name || !name.trim()) return;
  s.people.push({ id: _tsUid(), name: name.trim() });
  tripSplitPersist(s);
}

function tripSplitRemovePerson(pid) {
  const s = activeTripSplit(); if (!s) return;
  s.people = s.people.filter(p => p.id !== pid);
  s.items.forEach(it => {
    if (it.payer === pid) it.payer = null;
    it.participants = (it.participants || []).filter(a => a !== pid);
  });
  tripSplitPersist(s);
}

function tripSplitAddItem() {
  const s = activeTripSplit(); if (!s) return;
  if (!s.people.length) { alert('Add people first.'); return; }
  const name = prompt('What was it? (e.g. "Uber to airport")');
  if (!name || !name.trim()) return;
  const amount = parseFloat(prompt('Amount ($):') || '0') || 0;
  // Default: whoever is first paid; everyone shares.
  s.items.push({ id: _tsUid(), name: name.trim(), amount,
    payer: s.people[0].id, participants: s.people.map(p => p.id) });
  tripSplitPersist(s);
}

function tripSplitRemoveItem(iid) {
  const s = activeTripSplit(); if (!s) return;
  s.items = s.items.filter(it => it.id !== iid);
  tripSplitPersist(s);
}

function tripSplitSetPayer(iid, pid) {
  const s = activeTripSplit(); if (!s) return;
  const it = s.items.find(x => x.id === iid); if (!it) return;
  it.payer = pid;
  tripSplitPersist(s);
}

function tripSplitSetAmount(iid, val) {
  const s = activeTripSplit(); if (!s) return;
  const it = s.items.find(x => x.id === iid); if (!it) return;
  it.amount = pa(val) || 0;
  tripSplitSave(s); // don't re-render (keep input focus); summary updates on blur
  tripSplitRenderSummary(s);
}

function tripSplitToggleParticipant(iid, pid) {
  const s = activeTripSplit(); if (!s) return;
  const it = s.items.find(x => x.id === iid); if (!it) return;
  it.participants = it.participants || [];
  const i = it.participants.indexOf(pid);
  if (i >= 0) it.participants.splice(i, 1); else it.participants.push(pid);
  tripSplitPersist(s);
}

function tripSplitToggleAll(iid) {
  const s = activeTripSplit(); if (!s) return;
  const it = s.items.find(x => x.id === iid); if (!it) return;
  it.participants = (it.participants || []).length === s.people.length ? [] : s.people.map(p => p.id);
  tripSplitPersist(s);
}

// Net each person and reduce to a minimal set of "A pays B" transfers.
function tripSplitSettle(s) {
  const paid = {}, owed = {};
  s.people.forEach(p => { paid[p.id] = 0; owed[p.id] = 0; });
  s.items.forEach(it => {
    const parts = (it.participants || []).filter(pid => paid.hasOwnProperty(pid));
    if (it.payer && paid.hasOwnProperty(it.payer)) paid[it.payer] += pa(it.amount);
    if (parts.length) { const share = pa(it.amount) / parts.length; parts.forEach(pid => owed[pid] += share); }
  });
  const net = {}; // + => others owe them, − => they owe
  s.people.forEach(p => { net[p.id] = round2(paid[p.id] - owed[p.id]); });

  const debtors  = s.people.filter(p => net[p.id] < -0.005).map(p => ({ id: p.id, amt: -net[p.id] }));
  const creditors = s.people.filter(p => net[p.id] >  0.005).map(p => ({ id: p.id, amt:  net[p.id] }));
  const transfers = [];
  let di = 0, ci = 0, guard = 0;
  while (di < debtors.length && ci < creditors.length && guard++ < 500) {
    const pay = Math.min(debtors[di].amt, creditors[ci].amt);
    transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: round2(pay) });
    debtors[di].amt -= pay; creditors[ci].amt -= pay;
    if (debtors[di].amt < 0.005) di++;
    if (creditors[ci].amt < 0.005) ci++;
  }
  const total = s.items.reduce((a, it) => a + pa(it.amount), 0);
  return { paid, owed, net, transfers, total };
}
function round2(n) { return Math.round(n * 100) / 100; }

function tripSplitRender() {
  const root = document.getElementById('trip-splits-root');
  if (!root) return;
  const list = tripSplits();
  if (!list.length) {
    root.innerHTML = `<div class="empty" style="padding:20px;text-align:center;color:var(--muted)">No trip splits yet. Click “+ New Trip Split” to start.</div>`;
    return;
  }
  const active   = list.filter(s => !s.archived);
  const archived = list.filter(s => s.archived);
  if (!activeTripSplit()) _activeTripSplit = active.length ? active[0].id : null;

  const tabs = active.length
    ? active.map(s => `<button class="btn btn-sm ${s.id === _activeTripSplit ? 'btn-accent' : 'btn-outline'}"
        onclick="tripSplitSelect('${s.id}')">${s.name}</button>`).join('')
    : '<span class="muted" style="font-size:13px">No active trip splits — start a new one, or reopen a past trip below.</span>';

  const pastStrip = archived.length ? `
    <div style="margin-top:24px;border-top:1px dashed var(--border);padding-top:14px">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📦 Past trips (settled)</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${archived.map(s => `<button class="btn btn-sm ${s.id === _activeTripSplit ? 'btn-accent' : 'btn-outline'}"
          style="opacity:.8" onclick="tripSplitSelect('${s.id}')">✓ ${s.name} · ${fmt(tripSplitTotal(s))}</button>`).join('')}
      </div>
    </div>` : '';

  root.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${tabs}</div>
    <div id="trip-split-editor"></div>
    ${pastStrip}`;
  tripSplitRenderEditor();
}

function nameOf(s, pid) { const p = s.people.find(x => x.id === pid); return p ? p.name : '—'; }

function tripSplitRenderEditor() {
  const host = document.getElementById('trip-split-editor');
  const s = activeTripSplit();
  if (!host || !s) return;
  const vac = (state.data.vacations || []).find(v => v.id === s.vacation_id);

  const people = s.people.map(p => `
    <span class="split-person-chip">${p.name}
      <span class="remove-btn" onclick="tripSplitRemovePerson('${p.id}')">×</span></span>`).join('')
    || '<span class="muted" style="font-size:13px">Add who was on the trip</span>';

  // Rounding-credit rows are auto-managed adjustments — keep them out of the
  // item list and surface them as a single note instead.
  const realItems  = s.items.filter(it => !String(it.name).startsWith('Rounding credit'));
  const roundItems = s.items.filter(it =>  String(it.name).startsWith('Rounding credit'));
  const absorbed   = round2(-roundItems.reduce((a, it) => a + pa(it.amount), 0));

  const items = realItems.length ? realItems.map(it => {
    const parts = it.participants || [];
    const allOn = parts.length === s.people.length && s.people.length > 0;
    const payerSel = `<select onchange="tripSplitSetPayer('${it.id}', this.value)" style="font-size:12px;padding:2px 4px">
        ${s.people.map(p => `<option value="${p.id}" ${p.id === it.payer ? 'selected' : ''}>${p.name}</option>`).join('')}
      </select>`;
    const partBtns = s.people.map(p => `
      <button class="split-assignee-btn ${parts.includes(p.id) ? 'active' : ''}"
        onclick="tripSplitToggleParticipant('${it.id}','${p.id}')">${p.name}</button>`).join('');
    return `<div class="split-item-row" style="align-items:flex-start">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${it.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">
          Paid by ${payerSel}
          &nbsp;·&nbsp; Split among
          <button class="split-assignee-btn ${allOn ? 'active' : ''}" onclick="tripSplitToggleAll('${it.id}')">Everyone</button>
        </div>
        <div class="split-assignees">${partBtns}</div>
      </div>
      <div style="white-space:nowrap">
        $<input type="number" value="${pa(it.amount).toFixed(2)}" step="0.01" min="0" style="width:80px;font-weight:700"
           oninput="tripSplitSetAmount('${it.id}', this.value)">
      </div>
      <button onclick="tripSplitRemoveItem('${it.id}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px">×</button>
    </div>`;
  }).join('') : '<span class="muted" style="font-size:13px">No items yet — add the Ubers and meals you fronted.</span>';

  const settled = !!s.archived;
  const roundingNote = absorbed > 0.005 ? `
    <div style="margin-top:10px;font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px">
      🔧 Rounding applied — each person rounded down to whole dollars; you absorbed <strong style="color:var(--yellow)">${fmt(absorbed)}</strong> in cents.
    </div>` : '';

  host.innerHTML = `
    <div class="card" ${settled ? 'style="border:1px solid var(--green)"' : ''}>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div class="section-title" style="margin:0">${s.name}
          ${settled ? '<span style="font-size:11px;color:var(--green);border:1px solid var(--green);border-radius:10px;padding:1px 8px;margin-left:6px;font-weight:600">✓ Settled</span>' : ''}
          ${vac ? ` <span style="font-size:12px;color:var(--muted);font-weight:400">· linked to ✈️ ${vac.name}</span>` : ''}</div>
        <div style="display:flex;gap:8px">
          ${settled
            ? `<button class="btn btn-outline btn-sm" onclick="tripSplitUnarchive('${s.id}')">↩ Reopen</button>`
            : `<button class="btn btn-outline btn-sm" onclick="tripSplitArchive('${s.id}')" style="color:var(--green)">✓ Mark settled</button>`}
          <button class="btn btn-outline btn-sm" onclick="tripSplitDelete('${s.id}')" style="color:var(--red)">Delete</button>
        </div>
      </div>
      ${settled ? '<div style="font-size:12px;color:var(--muted)">Set aside — requests sent. Reopen to make changes.</div>' : ''}
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="section-title" style="margin:0">People</div>
        <button class="btn btn-outline btn-sm" onclick="tripSplitAddPerson()">+ Add Person</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${people}</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="section-title" style="margin:0">Shared Items</div>
        <button class="btn btn-outline btn-sm" onclick="tripSplitAddItem()">+ Add Item</button>
      </div>
      <div>${items}</div>
      ${roundingNote}
    </div>

    <div class="card" style="margin-top:16px" id="trip-split-summary"></div>`;
  tripSplitRenderSummary(s);
}

function tripSplitRenderSummary(s) {
  const host = document.getElementById('trip-split-summary');
  if (!host) return;
  if (!s.people.length || !s.items.length) {
    host.innerHTML = `<div class="section-title" style="margin-bottom:6px">Settle Up</div>
      <span class="muted" style="font-size:13px">Add people and items to see who owes whom.</span>`;
    return;
  }
  const { net, transfers, total } = tripSplitSettle(s);
  const balances = s.people.map(p => {
    const n = net[p.id] || 0;
    const color = n > 0.005 ? 'var(--green)' : n < -0.005 ? 'var(--red)' : 'var(--muted)';
    const label = n > 0.005 ? `is owed ${fmt(n)}` : n < -0.005 ? `owes ${fmt(-n)}` : 'settled';
    return `<div class="split-summary-row">
      <div style="font-weight:700;font-size:15px">${p.name}</div>
      <div style="font-size:14px;font-weight:700;color:${color}">${label}</div>
    </div>`;
  }).join('');
  const settle = transfers.length
    ? transfers.map(t => `<div style="display:flex;justify-content:space-between;padding:8px 14px;font-size:14px">
        <span><strong>${nameOf(s, t.from)}</strong> → <strong>${nameOf(s, t.to)}</strong></span>
        <span style="font-weight:800;color:var(--accent)">${fmt(t.amount)}</span></div>`).join('')
    : '<div style="padding:8px 14px;font-size:13px;color:var(--green)">✓ All settled up.</div>';

  host.innerHTML = `
    <div class="section-title" style="margin-bottom:10px">Settle Up <span style="font-size:12px;color:var(--muted);font-weight:400">· ${fmt(total)} total shared</span></div>
    ${balances}
    <div style="border-top:1px solid var(--border);margin:10px 0 4px;padding-top:8px">
      <div style="font-size:12px;color:var(--muted);padding:0 14px 4px">Suggested payments</div>
      ${settle}
    </div>`;
}
