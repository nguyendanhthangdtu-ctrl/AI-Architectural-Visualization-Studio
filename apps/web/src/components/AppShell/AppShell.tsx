import type { ReactNode } from 'react';
import { Header } from '../Header/Header.js';
import { Navigation } from '../Navigation/Navigation.js';
import styles from './AppShell.module.css';

/**
 * Top-level application shell — docs/02 UX "Workspace": header, navigation,
 * then the routed main content. Reused by every module (BUILD 04+).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <Header />
      <Navigation />
      {children}
    </div>
  );
}
