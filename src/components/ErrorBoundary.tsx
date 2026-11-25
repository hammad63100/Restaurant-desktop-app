import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Rules.md section 3: one broken page must not crash the whole app.
 * React only logs to the console, so the boundary also reports to the console
 * where the main process log (`logs/app.log`) can be checked.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="card w-full max-w-md p-6 text-center">
          <AlertTriangle aria-hidden className="mx-auto mb-3 h-10 w-10 text-secondary" />
          <h1 className="mb-1 text-section-title">Something went wrong</h1>
          <p className="mb-4 text-body text-text-secondary">
            This screen could not be displayed. Your data is safe; reloading usually fixes it.
          </p>
          <Button onClick={this.handleReload}>Reload the screen</Button>
        </div>
      </div>
    );
  }
}
