import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private reset = () => this.setState({ hasError: false, error: null });

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <div className="error-card">
            <div className="error-emoji">⚠️</div>
            <h2>Something went wrong</h2>
            <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button className="error-retry" onClick={this.reset}>
              Try again
            </button>
          </div>

          <style>{`
            .error-screen {
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }
            .error-card {
              background: #fff;
              border-radius: 20px;
              padding: 40px 32px;
              max-width: 380px;
              width: 100%;
              text-align: center;
              box-shadow: 0 4px 30px rgba(232, 115, 74, 0.08);
            }
            .error-emoji { font-size: 40px; margin-bottom: 12px; }
            .error-card h2 {
              font-size: 20px;
              font-weight: 700;
              color: #2D2D3A;
              margin: 0 0 8px;
            }
            .error-card p {
              font-size: 14px;
              color: #8A8A9A;
              margin: 0 0 24px;
              line-height: 1.5;
              word-break: break-word;
            }
            .error-retry {
              padding: 12px 32px;
              border-radius: 30px;
              border: none;
              background: linear-gradient(135deg, #E8734A, #F09468);
              color: #fff;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
            }
            .error-retry:hover { box-shadow: 0 6px 20px rgba(232, 115, 74, 0.35); }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;