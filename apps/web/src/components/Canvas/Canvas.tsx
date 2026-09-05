import type { ReactNode } from 'react';
import { EmptyState } from '../EmptyState/EmptyState.js';
import styles from './Canvas.module.css';

function aspectRatioToCss(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!w || !h) return '2 / 3';
  return `${w} / ${h}`;
}

export interface CanvasProps {
  /** docs/07 Scenario Builder aspect ratio values, e.g. "2:3", "9:16", "16:9". */
  aspectRatio?: string;
  sourceImageUrl?: string | null;
  /** BUILD 13: the most recent generated output — takes priority over sourceImageUrl once it exists (the "photograph" the viewport → photograph tagline promises). */
  outputImageUrl?: string | null;
  children?: ReactNode;
}

/**
 * Central canvas — docs/02 UX rule "Canvas gets priority over secondary
 * analysis panels." Defaults to a portrait frame (2:3); the aspect ratio is
 * a prop, not a layout assumption, so Scenario Builder (BUILD 09) can change
 * it without any shell redesign. Never renders a bundled sample image.
 */
export function Canvas({ aspectRatio = '2:3', sourceImageUrl = null, outputImageUrl = null, children }: CanvasProps) {
  return (
    <main className={styles.root} aria-label="Canvas" data-aspect-ratio={aspectRatio}>
      <div className={styles.frame} style={{ aspectRatio: aspectRatioToCss(aspectRatio) }}>
        {outputImageUrl ? (
          <img className={styles.image} src={outputImageUrl} alt="Generated photograph" />
        ) : sourceImageUrl ? (
          <img className={styles.image} src={sourceImageUrl} alt="Source viewport" />
        ) : (
          (children ?? (
            <EmptyState
              title="No source image yet"
              description="Upload a SketchUp or 3ds Max viewport render to begin."
            />
          ))
        )}
      </div>
    </main>
  );
}
