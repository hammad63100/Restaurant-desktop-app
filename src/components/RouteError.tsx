import { AlertTriangle } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from './Button';

/** Rendered by the router when a route fails to load, instead of a blank screen. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'This screen could not be opened. Reloading usually fixes it.';

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="card w-full max-w-md p-6 text-center">
        <AlertTriangle aria-hidden className="mx-auto mb-3 h-10 w-10 text-secondary" />
        <h1 className="mb-1 text-section-title">Something went wrong</h1>
        <p className="mb-4 text-body text-text-secondary">{message}</p>
        <Button onClick={() => window.location.reload()}>Reload the app</Button>
      </div>
    </div>
  );
}
