import { describe, expect, it } from 'vitest';
import { createInMemoryMetrics } from './metrics.js';

describe('createInMemoryMetrics', () => {
  it('counts increments per distinct label set', () => {
    const metrics = createInMemoryMetrics();
    metrics.increment('http_requests_total', { method: 'GET', status: '200' });
    metrics.increment('http_requests_total', { method: 'GET', status: '200' });
    metrics.increment('http_requests_total', { method: 'POST', status: '500' });
    const rendered = metrics.render();
    expect(rendered).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(rendered).toContain('http_requests_total{method="POST",status="500"} 1');
  });

  it('renders a bare counter with no labels', () => {
    const metrics = createInMemoryMetrics();
    metrics.increment('rate_limited_total');
    expect(metrics.render()).toContain('rate_limited_total 1');
  });
});
