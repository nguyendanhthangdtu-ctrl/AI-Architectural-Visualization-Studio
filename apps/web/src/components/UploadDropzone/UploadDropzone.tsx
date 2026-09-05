import { useId, useRef, useState, type DragEvent } from 'react';
import type { ErrorEnvelope } from '@avs/shared';
import { ErrorState } from '../ErrorState/ErrorState.js';
import styles from './UploadDropzone.module.css';

export type UploadDropzoneStatus = 'empty' | 'loading' | 'error';

export interface UploadDropzoneProps {
  status?: UploadDropzoneStatus;
  error?: ErrorEnvelope;
  disabled?: boolean;
  accept?: string;
  /** Distinguishes this instance's accessible name when more than one dropzone is on screen (e.g. source vs. reference image, BUILD 10). */
  label?: string;
  loadingLabel?: string;
  hint?: string;
  onFilesSelected: (files: FileList) => void;
}

/**
 * Source image upload/drop zone foundation (docs/01 MVP step 2). File
 * selection only hands the FileList to the caller for a local preview
 * (URL.createObjectURL) — no upload endpoint exists yet (BUILD 06 Image
 * Ingestion), so nothing is sent anywhere.
 */
export function UploadDropzone({
  status = 'empty',
  error,
  disabled = false,
  accept = 'image/*',
  label = 'Drop a viewport image, or click to browse',
  loadingLabel = 'Loading source image…',
  hint = 'SketchUp or 3ds Max viewport render — PNG or JPG.',
  onFilesSelected,
}: UploadDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (event.dataTransfer.files.length > 0) onFilesSelected(event.dataTransfer.files);
  };

  return (
    <>
      <div
        className={styles.root}
        data-dragging={dragging}
        data-disabled={disabled}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={`${inputId}-hint`}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <label htmlFor={inputId} className={styles.title}>
          {status === 'loading' ? loadingLabel : label}
        </label>
        <p id={`${inputId}-hint`} className={styles.hint}>
          {hint}
        </p>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.input}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) onFilesSelected(e.target.files);
          }}
        />
      </div>
      {/*
       * BUILD 28 FIX — a real defect found via live browser QA: this
       * previously returned ONLY <ErrorState>, replacing the dropzone/file
       * input entirely on a failed upload (wrong file type, too large,
       * etc.). With no retry button wired here (no onRetry prop passed) and
       * no other path back to a non-error status, the control became a
       * permanent dead end — the only way to attempt another upload was a
       * full page reload. The dropzone now stays rendered (and stays
       * interactive) alongside the error, so picking a different, valid
       * file immediately retries.
       */}
      {status === 'error' && error ? <ErrorState error={error} /> : null}
    </>
  );
}
