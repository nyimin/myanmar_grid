import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../components/LoginScreen';
import { createElement } from 'react';

export function withAuth(WrappedComponent) {
  return function AuthenticatedComponent(props) {
    const { user, loading } = useAuth();

    if (loading) {
      return (
        <div className="login-root">
          <div className="login-card">
            <p className="login-subtitle">Loading…</p>
          </div>
        </div>
      );
    }

    if (!user) {
      return <LoginScreen />;
    }

    return createElement(WrappedComponent, props);
  };
}
