"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

/** Dashboard charts — typed data only, severity palette from the PPT. */
export function DashboardCharts({
  severity,
  status,
  applications,
}: {
  severity: { name: string; value: number }[];
  status: { name: string; value: number }[];
  applications: { name: string; value: number }[];
}) {
  const severityColors = ["#CF1325", "#E86B10", "#F5A623", "#4A90D9", "#9E9E9E"];
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <section className="panel px-4 py-3" aria-label="Severity distribution">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Severity distribution</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={severity}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
            <XAxis dataKey="name" tick={{ fill: "#7A7A7A", fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fill: "#7A7A7A", fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value">
              {severity.map((entry, i) => (
                <Cell key={entry.name} fill={severityColors[i % severityColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="panel px-4 py-3" aria-label="Status distribution">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Finding status</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={status}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
            <XAxis dataKey="name" tick={{ fill: "#7A7A7A", fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fill: "#7A7A7A", fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#1A73E8" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="panel px-4 py-3" aria-label="Findings by application">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Findings by application</h2>
        {applications.length === 0 ? (
          <p className="mt-8 text-center text-[13px] text-muted">No findings yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, applications.length * 34)}>
            <BarChart data={applications} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
              <XAxis type="number" allowDecimals={false} tick={{ fill: "#7A7A7A", fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#1F1F1F", fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#CF1325" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  );
}
