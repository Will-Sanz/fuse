import type { GraphNode } from '../../shared/types';
export function FlowGraph({
  nodes,
  selected,
  onSelect,
}: {
  nodes: GraphNode[];
  selected: string[];
  onSelect: (name: string) => void;
}) {
  if (!nodes.length)
    return (
      <div className="empty-inline">
        No named top-level functions were found. Review the full file below.
      </div>
    );
  const width = Math.max(760, nodes.length * 210),
    height = 214;
  const positions = new Map(nodes.map((n, i) => [n.id, 40 + i * 210]));
  return (
    <div className="graph-scroll">
      <div className="graph" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#89969c" />
            </marker>
          </defs>
          {nodes.flatMap((node, i) =>
            node.calls
              .filter((c) => positions.has(c))
              .map((target, j) => {
                const start = positions.get(node.id)! + 80,
                  end = positions.get(target)! + 80;
                const y =
                  64 - ((Math.abs(nodes.findIndex((n) => n.id === target) - i) + j) % 3) * 15;
                return (
                  <path
                    key={`${node.id}-${target}`}
                    d={`M ${start} 88 C ${start} ${y}, ${end} ${y}, ${end} 88`}
                    fill="none"
                    stroke="#a6b2b5"
                    strokeWidth="1.5"
                    markerEnd="url(#arrow)"
                  />
                );
              }),
          )}
        </svg>
        {nodes.map((node) => (
          <button
            key={node.id}
            className={`graph-node ${node.changedBy.length === 2 ? 'overlap' : node.changedBy.length ? 'changed' : ''} ${selected.includes(node.id) ? 'selected' : ''}`}
            style={{ left: positions.get(node.id), top: 90 }}
            onClick={() => onSelect(node.id)}
            aria-label={`Inspect ${node.id}`}
            aria-pressed={selected.includes(node.id)}
          >
            <span className="node-kind">
              {node.changedBy.length === 2
                ? 'SHARED EDIT'
                : node.changedBy.length
                  ? `AGENT ${node.changedBy[0].toUpperCase()}`
                  : 'UNCHANGED'}
            </span>
            <strong>{node.label}</strong>
            <span className="node-line">
              Line {node.line}{' '}
              {node.calls.length
                ? `· calls ${node.calls.length} local function${node.calls.length === 1 ? '' : 's'}`
                : '· no local calls'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
