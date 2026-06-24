"use client";
import { PRIORITY_LABEL, PRIORITY_COLOR } from "@/lib/status";
import type { Task } from "@/lib/api";

export default function TaskCard({ task }: { task: Task }) {
  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "10px 12px", boxShadow: "var(--shadow-card)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
            color: PRIORITY_COLOR[task.priority] || "var(--text-soft)",
            background: (PRIORITY_COLOR[task.priority] || "#999") + "1a",
          }}
        >
          {PRIORITY_LABEL[task.priority] || task.priority}
        </span>
        {task.due_date && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            ◷ {new Date(task.due_date).toLocaleDateString("pt-BR")}
          </span>
        )}
        {task.is_archived && (
          <span className="muted" style={{ fontSize: 11.5 }}>arquivada</span>
        )}
      </div>
    </div>
  );
}
