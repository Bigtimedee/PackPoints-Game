import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="p-6 text-center">
              <div className="mx-auto p-3 rounded-full bg-destructive/10 w-fit mb-2">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-2xl font-semibold">Something went wrong</h2>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <p className="text-muted-foreground text-center text-sm">
                We're sorry, but something unexpected happened. Please try refreshing the page.
              </p>
              {this.state.error && (
                <div className="bg-muted p-3 rounded-md text-xs font-mono overflow-auto max-h-32">
                  <p className="text-destructive font-semibold" data-testid="text-error-message">
                    {this.state.error.message || "Unknown error"}
                  </p>
                  {this.state.error.stack && (
                    <p className="text-muted-foreground mt-2 whitespace-pre-wrap break-all">
                      {this.state.error.stack.split('\n').slice(0, 5).join('\n')}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button type="button" onClick={this.handleReload} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground min-h-9 px-4 py-2 text-sm font-medium" data-testid="button-reload">
                  <RefreshCw className="h-4 w-4" />
                  Refresh Page
                </button>
                <button type="button" onClick={this.handleGoHome} className="inline-flex items-center justify-center gap-2 rounded-md border min-h-9 px-4 py-2 text-sm font-medium" data-testid="button-go-home">
                  <Home className="h-4 w-4" />
                  Go Home
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
