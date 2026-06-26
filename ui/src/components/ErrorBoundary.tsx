/**
 * ErrorBoundary — catches render crashes in child components.
 * Without this, any uncaught error in a component tree (like CodeViewer
 * crashing on a specific file) takes down the ENTIRE page (blank screen).
 * With it, only the errored subtree is replaced with a fallback message
 * and a "Retry" button.
 */
import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Called when the user clicks Retry. Reset your state here. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[200px] text-center">
          <p className="text-sm text-red-400 mb-2">
            {this.state.error?.message || "Something went wrong rendering this component."}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
