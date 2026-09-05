import type { ProjectModule } from '@avs/project-core';
import { ControlPanel } from '../ControlPanel/ControlPanel.js';
import { Canvas } from '../Canvas/Canvas.js';
import { Panel } from '../Panel/Panel.js';
import { ArchitectureFocus } from '../ArchitectureFocus/ArchitectureFocus.js';
import { InteriorFocus } from '../InteriorFocus/InteriorFocus.js';
import { useProjectSessionState } from '../../state/ProjectSessionContext.js';
import styles from './Workspace.module.css';

export interface WorkspaceProps {
  module: ProjectModule;
}

/**
 * Main workspace — docs/02 UX "left/control area, central canvas/preview
 * area, right-side area reserved for contextual tools/inspector." The right
 * side is a collapsible Panel, NOT a permanent wide AI Analysis Panel —
 * closed by default so the canvas keeps priority (docs/02 UX rule).
 *
 * The Inspector's content is module-specific (BUILD 04/05): Architecture
 * gets ArchitectureFocus, Interior gets InteriorFocus — both real domain
 * vocabulary, neither a fabricated analysis result.
 */
export function Workspace({ module }: WorkspaceProps) {
  const state = useProjectSessionState();

  return (
    <div className={styles.root}>
      <ControlPanel module={module} />
      <Canvas
        sourceImageUrl={state.sourceImage?.url ?? null}
        outputImageUrl={state.latestGenerationOutputUrls[0] ?? null}
      />
      <Panel title="Inspector" defaultOpen={false}>
        {module === 'architecture' ? <ArchitectureFocus /> : <InteriorFocus />}
      </Panel>
    </div>
  );
}
