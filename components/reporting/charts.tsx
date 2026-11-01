"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

/**
 * Chart components (Phase 7 §20-§21) — typed structured data only; the VAPT
 * severity palette from the Phase 1 design tokens.
 */
export const SEVERITY_COLORS = ["#CF1325", "#E86B10", "#F5A623", "#4A90D9", "#9E9E9E"];
const INK = "#1F1F1F";
const MUTED = "#7A7A7A";

export interface ChartDatum {
  name: string;
  value: number;
}

export function SeverityDoughnut({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart width={400} height={300}>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} stroke="#FFFFFF">
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={SEVERITY_COLORS[i % SEVERITY_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

import { Legend } from "recharts";

export function StatusBars({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} dataKey="value">
        <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
        <XAxis dataKey="name" tick={{ fill: MUTED, fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fill: MUTED, fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#1A73E8" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ApplicationBars({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 34)}>
      <BarChart data={data} dataKey="value" layout="vertical" margin={{ left: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
        <XAxis type="number" allowDecimals={false} tick={{ fill: MUTED, fontSize: 12 }} />
        <YAxis type="category" dataKey="name" width={140} tick={{ fill: INK, fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#CF1325" />
      </BarChart>
    </ResponsiveContainer>
  );
}
