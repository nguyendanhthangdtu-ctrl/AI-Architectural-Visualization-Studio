/**
 * Observability — docs/03 §11 "metrics (job latency/failure rate, provider
 * error rates...)" (BUILD 18). A concrete metrics/tracing VENDOR is still an
 * explicit open decision (docs/03 §13, "BUILD 02/18" — not fixed here); this
 * is the minimum real, vendor-agnostic step short of that: in-process
 * counters exposed in the standard Prometheus text exposition format (a
 * real, widely-supported wire format any real vendor's scraper can read),
 * not a fake integration with a specific vendor's SDK this project has no
 * account for (CLAUDE.md rule 7).
 */
export interface Metrics {
  increment(name: string, labels?: Record<string, string>): void;
  render(): string;
}

function seriesKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
    .join(',');
  return `${name}{${parts}}`;
}

export function createInMemoryMetrics(): Metrics {
  const counters = new Map<string, number>();

  return {
    increment(name, labels) {
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + 1);
    },
    render() {
      const lines: string[] = [];
      for (const [key, value] of counters) {
        lines.push(`${key} ${value}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}
