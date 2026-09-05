import { ROUTES } from '../../routes.js';
import { useRouter } from '../../state/router.js';
import styles from './Navigation.module.css';

/**
 * Architecture/Interior module navigation — docs/01 core modules, docs/02 UX
 * Navigation. Built on BUILD 02's typed route table (routes.ts), excluding
 * the parameterized "project" route which isn't a top-level nav destination.
 */
export function Navigation() {
  const { pathname, navigate } = useRouter();
  const navRoutes = ROUTES.filter((route) => route.name !== 'project');

  return (
    <nav className={styles.root} aria-label="Modules">
      {navRoutes.map((route) => {
        const current = pathname === route.path;
        return (
          <a
            key={route.name}
            href={route.path}
            className={styles.link}
            aria-current={current ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(route.path);
            }}
          >
            {route.label}
          </a>
        );
      })}
    </nav>
  );
}
