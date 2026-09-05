import { useEffect, useRef, useState } from 'react';
import { VIDEO_MOTION_TYPES, type VideoMotionType } from '@avs/project-core';
import type { ErrorEnvelope } from '@avs/shared';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { getVideoStatus, runVideo, type RunVideoParams } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './VideoPanel.module.css';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_DURATION_SECONDS = 6;

type VideoUiStatus = 'idle' | 'submitting' | 'running' | 'succeeded' | 'failed' | 'error';

/**
 * Image → Video — docs/14_VIDEO_SPEC.md (BUILD 16). Turns the most recent
 * generation output into a short video via a real, genuinely asynchronous
 * provider call (Veo's predictLongRunning): "Generate Video" only submits
 * the job (`video.status === 'running'`); this component then polls
 * `GET /projects/:id/videos/:videoId` for real until the provider reports
 * `succeeded`/`failed` — the first UI in this codebase needing real async
 * polling rather than a single request/response round trip.
 */
export function VideoPanel() {
  const state = useProjectSessionState();
  const [motionType, setMotionType] = useState<VideoMotionType>('dolly');
  const [motionDescription, setMotionDescription] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_DURATION_SECONDS);
  const [renderCore, setRenderCore] = useState<RunVideoParams['renderCore']>('Veo');
  const [uiStatus, setUiStatus] = useState<VideoUiStatus>('idle');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<ErrorEnvelope | undefined>(undefined);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const pollOnce = (projectId: string, id: string) => {
    pollTimeoutRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await getVideoStatus(projectId, id);
          if (result.video.status === 'running') {
            pollOnce(projectId, id);
            return;
          }
          if (result.video.status === 'succeeded') {
            setOutputUrl(result.outputAssetUrl);
            setUiStatus('succeeded');
            return;
          }
          setUiStatus('failed');
        } catch (error) {
          setVideoError(toErrorEnvelope(error, 'Something went wrong checking the video status.'));
          setUiStatus('error');
        }
      })();
    }, POLL_INTERVAL_MS);
  };

  const canGenerate = Boolean(
    state.currentProject && state.latestGenerationId && state.latestOutputAssetId && state.scenario && motionDescription.trim(),
  );

  const handleGenerateVideo = async () => {
    if (!state.currentProject || !state.latestGenerationId || !state.latestOutputAssetId || !state.scenario || !motionDescription.trim()) {
      return;
    }

    setUiStatus('submitting');
    setVideoError(undefined);
    setOutputUrl(null);
    try {
      const result = await runVideo(state.currentProject.id, state.latestGenerationId, {
        sourceAssetId: state.latestOutputAssetId,
        promptText: `${motionType}: ${motionDescription}`,
        motionType,
        motionDescription,
        durationSeconds,
        aspectRatio: state.scenario.aspectRatio,
        resolution: state.scenario.generationResolution,
        renderCore,
      });
      setVideoId(result.videoId);
      setUiStatus('running');
      pollOnce(state.currentProject.id, result.videoId);
    } catch (error) {
      setVideoError(toErrorEnvelope(error, 'Something went wrong generating the video.'));
      setUiStatus('error');
    }
  };

  if (!state.latestGenerationId) {
    return (
      <section className={styles.root} aria-labelledby="video-panel-title">
        <h2 id="video-panel-title" className={styles.title}>
          Video
        </h2>
        <EmptyState title="No generated image yet" description="Render an image first, then turn it into a video here." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="video-panel-title">
      <h2 id="video-panel-title" className={styles.title}>
        Video
      </h2>

      <div className={styles.field}>
        <label htmlFor="video-motion-type">Motion</label>
        <select id="video-motion-type" value={motionType} onChange={(e) => setMotionType(e.target.value as VideoMotionType)}>
          {VIDEO_MOTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="video-motion-description">Motion description</label>
        <textarea
          id="video-motion-description"
          className={styles.textarea}
          placeholder="e.g. camera dollies slowly toward the front door"
          value={motionDescription}
          onChange={(e) => setMotionDescription(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="video-duration">Duration (seconds)</label>
        <input
          id="video-duration"
          type="number"
          min={1}
          value={durationSeconds}
          onChange={(e) => setDurationSeconds(Number(e.target.value))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="video-render-core">Render core</label>
        <select id="video-render-core" value={renderCore} onChange={(e) => setRenderCore(e.target.value as RunVideoParams['renderCore'])}>
          <option value="Veo">Veo</option>
          <option value="Sora">Sora</option>
          <option value="Auto">Auto</option>
        </select>
      </div>

      <button
        type="button"
        className={styles.generateButton}
        disabled={!canGenerate || uiStatus === 'submitting' || uiStatus === 'running'}
        onClick={() => void handleGenerateVideo()}
      >
        {uiStatus === 'submitting' ? 'Submitting…' : uiStatus === 'running' ? 'Generating video…' : 'Generate Video'}
      </button>

      {uiStatus === 'running' && videoId ? (
        <EmptyState title="Video generation in progress" description="This runs asynchronously — checking status periodically." />
      ) : null}

      {uiStatus === 'succeeded' && outputUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- generated architectural video has no dialogue/audio track to caption
        <video className={styles.video} src={outputUrl} controls />
      ) : null}

      {uiStatus === 'failed' ? (
        <ErrorState
          error={{ code: 'VIDEO_GENERATION_FAILED', message: 'The video provider reported a failure.', retryable: true }}
          onRetry={() => void handleGenerateVideo()}
        />
      ) : null}

      {uiStatus === 'error' && videoError ? <ErrorState error={videoError} onRetry={() => void handleGenerateVideo()} /> : null}
    </section>
  );
}
