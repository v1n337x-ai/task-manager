"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LabelList,
} from "recharts";

/**
 * Dashboard charts — PPT slide-3 style: severity DOUGHNUT with a tidy HTML
 * legend, status bars with on-bar labels, and a height-capped, internally
 * scrollable "top applications" bar panel. Long names always truncate
 * (tickFormatter) and the full value lives in the tooltip, so additional data
 * can NEVER make elements overlap.
 */

// VAPT severity palette (user-directed): Critical red · High orange ·
// Medium amber · Low green · Info blue.
const SEVERITY_COLORS = ["#C1272D", "#F7931E", "#FCEE21", "#39B54A", "#0070C0"];
const GRID = "#E7E1EE";
const AXIS = "#857896";
const INK = "#3D2054";

export interface ChartDatum {
  name: string;
  value: number;
}

const tooltipStyle = {
  background: "#FFFFFF",
  border: "1px solid #E7E1EE",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 4px 14px rgb(61 32 84 / 8%)",
} as const;

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max).trimEnd()}…` : value);

/* ---------------- Severity doughnut (PPT slide 3) ---------------- */

export function SeverityDoughnut({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <section className="panel flex flex-col px-5 py-4" data-testid="severity-doughnut">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Severity distribution</h2>
      <div className="relative mx-auto mt-3 h-[260px] w-full max-w-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="#FFFFFF"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={SEVERITY_COLORS[i % SEVERITY_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: INK, fontWeight: 500 }} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center KPI — floats over the doughnut hole, never collides with bars */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[34px] leading-none text-ink">{total}</span>
          <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">findings</span>
        </div>
      </div>
      {/* Legend with counts — HTML list, wraps cleanly, zero chart interference */}
      <ul className="mx-auto mt-3 flex w-full max-w-[340px] flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLORS[i % SEVERITY_COLORS.length] }} aria-hidden />
            <span className="font-medium">{d.name}</span>
            <span className="tabular-nums text-muted">{d.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Status bar chart (PPT slide 3) ---------------- */

const STATUS_COLORS = ["#2E86C1", "#2E862E", "#CF1325", "#E86B10", "#5D4A78"];

export function StatusBars({ data }: { data: ChartDatum[] }) {
  return (
    <section className="panel flex flex-col px-5 py-4" data-testid="status-bars">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Finding status</h2>
      <div className="mt-3 h-[318px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 26, right: 8, left: -14, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="name"
              interval={0}
              tickFormatter={(v: string) => truncate(String(v), 9)}
              tick={{ fill: AXIS, fontSize: 11 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
            />
            <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: INK, fontWeight: 500 }} cursor={{ fill: "#FBF8FD" }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={54} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" style={{ fill: INK, fontWeight: 700, fontSize: 12 }} />
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ---------------- Top applications bar (PPT slide register) ---------------- */

export function ApplicationBars({ data, title = "Findings by application" }: { data: ChartDatum[]; title?: string }) {
  return (
    <section className="panel flex flex-col px-5 py-4" data-testid="application-bars">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">{title}</h2>
      {data.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-muted">No findings registered yet.</p>
      ) : (
        /* Fixed visual height; more rows scroll INTERNALLY — the page never stretches. */
        <div className="mt-3 h-[420px] overflow-y-auto pr-1">
          <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40)} debounce={0}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={128}
                tickFormatter={(v: string) => truncate(String(v), 16)}
                tick={{ fill: INK, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${value as number} finding(s)`, "Total"]}
                labelFormatter={(label) => {
                  const full = data.find((d) => String(d.name) === String(label))?.name ?? String(label);
                  return full.length > 40 ? (
                    full
                  ) : (
                    <span style={{ color: INK, fontWeight: 600 }}>{full}</span>
                  );
                }}
                cursor={{ fill: "#FBF8FD" }}
              />
              <Bar dataKey="value" fill="#FF6D1F" radius={[0, 5, 5, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
