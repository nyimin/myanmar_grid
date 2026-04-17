import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../components/LoginScreen';

export function withAuth(Component) {
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

    return <Component {...props} />;
  };
}
