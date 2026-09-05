import styles from './ImagePreview.module.css';

export interface ImagePreviewProps {
  url: string;
  fileName?: string;
  onRemove: () => void;
  onReplace: () => void;
}

/** Preview of an accepted source image, with remove/replace — docs/01 image-input foundation. */
export function ImagePreview({ url, fileName, onRemove, onReplace }: ImagePreviewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.frame}>
        <img className={styles.image} src={url} alt={fileName ? `Source image: ${fileName}` : 'Source image'} />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={onReplace}>
          Replace
        </button>
        <button type="button" className={`${styles.action} ${styles.remove}`} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
