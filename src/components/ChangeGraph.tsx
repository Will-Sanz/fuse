import { useId } from 'react';
import type { GraphNode } from '../../shared/types';

export function ChangeGraph({
  nodes,
  changed,
  focus,
  onSelect,
  label,
}: {
  nodes: GraphNode[];
  changed: string[];
  focus: string[];
  onSelect: (id: string) => void;
  label: string;
}) {
  const arrow = useId().replace(/:/g, '');
  // A stable source-order layout makes before/after comparisons possible. Arrows are calls, not time.
  const visible = nodes;
  const height = Math.max(100, visible.length * 66 + 12);
  return (
    <div className="graph-scroll">
      <svg className="change-graph" viewBox={`0 0 285 ${height}`} role="img" aria-label={label}>
        <defs>
          <marker id={arrow} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6" fill="currentColor" />
          </marker>
        </defs>
        {visible.flatMap((node, i) =>
          node.calls.map((to) => {
            const j = visible.findIndex((n) => n.id === to);
            if (j < 0) return null;
            const y1 = i * 66 + 33,
              y2 = j * 66 + 33,
              x = 247 + Math.min(Math.abs(j - i) * 7, 26);
            return (
              <path
                key={`${node.id}-${to}`}
                d={`M235 ${y1} C${x} ${y1},${x} ${y2},237 ${y2}`}
                markerEnd={`url(#${arrow})`}
                className="call-edge"
                fill="none"
              />
            );
          }),
        )}
        {visible.map((node, i) => (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`Inspect ${node.id}`}
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
            className={`graph-node ${changed.includes(node.id) ? 'changed' : ''} ${focus.includes(node.id) ? 'attention' : ''}`}
            transform={`translate(10,${i * 66 + 10})`}
          >
            <rect width="225" height="46" rx="8" />
            <circle cx="17" cy="23" r="3" />
            <text x="29" y="27">
              {node.label.length > 24 ? node.label.slice(0, 22) + '…' : node.label}
            </text>
            <text x="215" y="27" textAnchor="end" className="graph-line">
              {node.line}
            </text>
          </g>
        ))}
        {!nodes.length && (
          <text x="142" y="50" textAnchor="middle" className="graph-empty">
            No named functions
          </text>
        )}
      </svg>
    </div>
  );
}
