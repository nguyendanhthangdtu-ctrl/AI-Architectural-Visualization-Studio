import { AppShell } from './components/AppShell/AppShell.js';
import { ModuleLanding } from './components/ModuleLanding/ModuleLanding.js';
import { ModuleWorkspace } from './components/ModuleWorkspace/ModuleWorkspace.js';
import { ProjectWorkspacePlaceholder } from './components/ProjectWorkspacePlaceholder/ProjectWorkspacePlaceholder.js';
import { ProjectSessionProvider } from './state/ProjectSessionContext.js';
import { RouterProvider, useRouter } from './state/router.js';

function RoutedContent() {
  const { route } = useRouter();

  switch (route?.name) {
    case 'architecture':
      return <ModuleWorkspace module="architecture" />;
    case 'interior':
      return <ModuleWorkspace module="interior" />;
    case 'project':
      return <ProjectWorkspacePlaceholder />;
    default:
      return <ModuleLanding />;
  }
}

export function App() {
  return (
    <ProjectSessionProvider>
      <RouterProvider>
        <AppShell>
          <RoutedContent />
        </AppShell>
      </RouterProvider>
    </ProjectSessionProvider>
  );
}
